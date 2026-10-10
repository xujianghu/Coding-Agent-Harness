import {
  AgentConfig, AgentAction, ActionResult, ConversationTurn, AgentState,
  LLMProvider, ToolDefinition, LLMMessage, LLMToolCall, AgentCheckpoint,
  TokenUsage, ToolExecutionContext,
} from './types';
import { estimateContextTokens, estimateTokens, limitText, throwIfAborted, waitWithSignal } from './runtime';

function buildSystemPrompt(tools: ToolDefinition[]): string {
  return `你是编码 Agent。使用提供的工具检查和修改仓库。工具返回失败时根据具体报错修复。
无法使用原生工具调用时返回 JSON：{"action":{"type":"工具名称","params":{}}}。
任务完成时返回 {"done":true,"summary":"完成内容"}。独立验收失败后必须继续修复。
可用工具：${tools.map(t => `${t.name}: ${t.description}`).join('\n')}`;
}

export type ParsedResponse =
  | { kind: 'action'; action: AgentAction }
  | { kind: 'done'; summary: string }
  | { kind: 'text'; text: string };

export function parseResponse(content: string, toolCalls?: LLMToolCall[]): ParsedResponse {
  if (toolCalls?.length) {
    const call = toolCalls[0];
    return { kind: 'action', action: { type: call.name as AgentAction['type'], params: call.arguments, ...(call.id ? { toolCallId: call.id } : {}) } };
  }
  const trimmed = content.trim();
  const block = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [block ? block[1].trim() : trimmed];
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const candidate of [...candidates]) {
    let inString = false;
    let escaped = false;
    let repaired = '';
    for (const character of candidate) {
      if (character === '"' && !escaped) inString = !inString;
      repaired += inString && character === '\n' ? '\\n' : inString && character === '\r' ? '\\r' : character;
      escaped = character === '\\' && !escaped;
    }
    if (repaired !== candidate) candidates.push(repaired);
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && parsed.action && typeof parsed.action.type === 'string') {
        return { kind: 'action', action: parsed.action };
      }
      if (parsed?.done === true) return { kind: 'done', summary: typeof parsed.summary === 'string' ? parsed.summary : '' };
    } catch {
      // 无法解析的输出由调用者反馈，禁止猜测并执行损坏的参数。
    }
  }
  return { kind: 'text', text: trimmed };
}

export function validateAction(tools: ToolDefinition[], action: AgentAction): string | undefined {
  const tool = tools.find(t => t.name === action.type);
  if (!tool) return `Unknown tool: ${action.type}`;
  if (!action.params || typeof action.params !== 'object' || Array.isArray(action.params)) return '工具参数必须是对象';
  for (const [name, schema] of Object.entries(tool.parameters)) {
    const value: unknown = action.params[name];
    if (value === undefined) {
      if (schema.required) return `缺少必需参数：${name}`;
      continue;
    }
    const valid = schema.type === 'array' ? Array.isArray(value)
      : schema.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
      : schema.type === 'integer' ? Number.isInteger(value)
      : schema.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : typeof value === schema.type;
    if (!valid) return `参数 ${name} 必须是 ${schema.type}`;
  }
  for (const name of Object.keys(action.params)) if (!Object.hasOwn(tool.parameters, name)) return `未知参数：${name}`;
  return undefined;
}

export async function executeAction(tools: ToolDefinition[], action: AgentAction, context?: ToolExecutionContext): Promise<ActionResult> {
  throwIfAborted(context?.signal);
  const error = validateAction(tools, action);
  if (error) return { success: false, output: '', error };
  try {
    const result = await tools.find(t => t.name === action.type)!.execute(action.params, context);
    // 已知结果交由循环持久化，取消判断在记录结果后进行。
    return result;
  } catch (err) {
    throwIfAborted(context?.signal);
    return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
  }
}

/** 以完整 assistant/tool 组裁剪，避免留下没有调用来源的工具结果。 */
export function trimConversationHistory(messages: LLMMessage[], maxTurns: number, maxContextTokens?: number): LLMMessage[] {
  const base = messages.slice(0, 2);
  const groups: LLMMessage[][] = [];
  for (const message of messages.slice(2)) {
    if (message.role === 'assistant' || groups.length === 0) groups.push([message]);
    else groups[groups.length - 1].push(message);
  }
  while (groups.length > Math.max(0, maxTurns)) groups.shift();
  let trimmed = [...base, ...groups.flat()];
  while (maxContextTokens !== undefined && estimateContextTokens(trimmed) > maxContextTokens && groups.length > 1) {
    groups.shift();
    trimmed = [...base, ...groups.flat()];
  }
  return trimmed;
}

export interface AgentRunResult {
  state: AgentState;
  turns: number;
  summary: string;
  history: ConversationTurn[];
  verified: boolean;
  usage: TokenUsage;
  usageEstimated: boolean;
  stopReason: string;
  checkpoint: AgentCheckpoint;
}

export interface VerificationContext extends ToolExecutionContext {
  task: string;
  summary: string;
  history: ConversationTurn[];
}

export interface AgentCallbacks {
  onAction?: (action: AgentAction, turn: number, context?: ToolExecutionContext) => { allowed: boolean; reason?: string } | void | Promise<{ allowed: boolean; reason?: string } | void>;
  onTurn?: (turn: ConversationTurn) => void;
  onStop?: (reason: string) => void;
  onMessage?: (messages: LLMMessage[]) => void;
  onVerify?: (context: VerificationContext) => ActionResult | Promise<ActionResult>;
  onCheckpoint?: (checkpoint: AgentCheckpoint) => void | Promise<void>;
}

export interface AgentRunOptions {
  checkpoint?: AgentCheckpoint;
  signal?: AbortSignal;
}

export function createAgentLoop(config: AgentConfig, llm: LLMProvider, tools: ToolDefinition[], callbacks: AgentCallbacks) {
  let latest: AgentCheckpoint | undefined;
  let active = false;
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  return {
    exportCheckpoint(): AgentCheckpoint | undefined { return latest ? clone(latest) : undefined; },
    async run(task: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
      if (active) throw new Error('同一个 Agent 循环不能并发运行');
      if (options.checkpoint && (options.checkpoint.version !== 1 || options.checkpoint.task !== task)) throw new Error('检查点版本或任务不匹配');
      if (options.checkpoint?.executionUncertain) throw new Error('检查点中有结果未知的动作，请核对工作区后恢复，禁止自动重放');
      active = true;
      const checkpoint = options.checkpoint ? clone(options.checkpoint) : undefined;
      const controller = new AbortController();
      const forwardAbort = () => controller.abort(options.signal?.reason ?? new Error('操作已取消'));
      options.signal?.addEventListener('abort', forwardAbort, { once: true });
      if (options.signal?.aborted) forwardAbort();
      const started = Date.now();
      const previousElapsed = checkpoint?.elapsedMs ?? 0;
      const timer = setTimeout(() => controller.abort(new Error(`Agent timed out after ${config.agent.timeout}ms`)), Math.max(0, config.agent.timeout - previousElapsed));
      const signal = controller.signal;
      const assertActive = () => {
        if (previousElapsed + Date.now() - started >= config.agent.timeout) {
          controller.abort(new Error(`Agent timed out after ${config.agent.timeout}ms`));
        }
        throwIfAborted(signal);
      };
      const history = checkpoint?.history ?? [{ role: 'user' as const, content: task, timestamp: Date.now() }];
      let messages: LLMMessage[] = checkpoint?.messages ?? [{ role: 'system', content: buildSystemPrompt(tools) }, { role: 'user', content: task }];
      let turns = checkpoint?.turns ?? 0;
      let usage: TokenUsage = checkpoint?.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let usageEstimated = checkpoint?.usageEstimated ?? false;
      let parseAttempts = checkpoint?.parseAttempts ?? 0;
      let state: AgentState = 'running';
      let summary = checkpoint?.summary ?? '';
      let verified = checkpoint?.verified ?? false;
      let stopReason = '';
      let pendingToolCalls = checkpoint?.pendingToolCalls ?? [];
      let executionUncertain: AgentAction | undefined;
      const save = async () => {
        latest = clone({ version: 1, task, messages, history, turns, usage, usageEstimated, parseAttempts, state, summary, verified,
          remainingTokens: config.agent.maxTotalTokens === undefined ? undefined : Math.max(0, config.agent.maxTotalTokens - usage.totalTokens),
          elapsedMs: previousElapsed + Date.now() - started, ...(pendingToolCalls.length ? { pendingToolCalls } : {}), ...(executionUncertain ? { executionUncertain } : {}),
        } satisfies AgentCheckpoint);
        await callbacks.onCheckpoint?.(clone(latest));
      };
      const trim = () => { messages = trimConversationHistory(messages, config.memory.maxConversationTurns, config.memory.maxContextTokens); };
      const runAction = async (action: AgentAction, responseContent: string, native: boolean) => {
        assertActive();
        if (config.agent.maxTotalTokens !== undefined && usage.totalTokens >= config.agent.maxTotalTokens) throw new Error('token budget exhausted');
        const validationError = validateAction(tools, action);
        let result: ActionResult;
        if (validationError) result = { success: false, output: '', error: validationError };
        else {
          const approval = await waitWithSignal(Promise.resolve(callbacks.onAction?.(action, turns, { signal })), signal);
          assertActive();
          if (approval && !approval.allowed) result = { success: false, output: '', error: approval.reason || 'Action blocked' };
          else {
            executionUncertain = action;
            await save();
            assertActive();
            result = await executeAction(tools, action, { signal });
          }
        }
        // 即便此时收到取消，也先持久化已返回的结果，恢复时不能重放已完成动作。
        const maxChars = config.memory.maxToolOutputChars ?? 16000;
        result = { ...result, output: limitText(result.output, maxChars), ...(result.error ? { error: limitText(result.error, maxChars) } : {}) };
        const turn: ConversationTurn = { role: 'assistant', content: responseContent, timestamp: Date.now(), action, result };
        history.push(turn);
        if (native) messages.push({ role: 'tool', content: JSON.stringify(result), toolCallId: action.toolCallId, name: action.type });
        else messages.push({ role: 'user', content: `Action result: ${JSON.stringify(result)}` });
        if (native) pendingToolCalls.shift();
        executionUncertain = undefined;
        callbacks.onTurn?.(turn);
        await save();
        assertActive();
      };
      try {
        if (checkpoint?.state === 'completed') {
          state = checkpoint.state;
          stopReason = verified ? 'verification passed' : 'done signal (unverified)';
        }
        while (state === 'running') {
          assertActive();
          if (pendingToolCalls.length) {
            for (const call of [...pendingToolCalls]) await runAction({ type: call.name as AgentAction['type'], params: call.arguments, toolCallId: call.id }, '', true);
            trim();
            await save();
            continue;
          }
          if (turns >= config.agent.maxTurns) { state = 'stopped'; stopReason = 'maxTurns reached'; break; }
          trim();
          const promptEstimate = estimateContextTokens(messages, tools.map(({ execute: _execute, ...tool }) => tool));
          if (config.memory.maxContextTokens !== undefined && promptEstimate > config.memory.maxContextTokens) {
            state = 'stopped'; stopReason = 'context token budget exceeded'; break;
          }
          const remaining = config.agent.maxTotalTokens === undefined ? Infinity : config.agent.maxTotalTokens - usage.totalTokens - promptEstimate;
          if (remaining <= 0) { state = 'stopped'; stopReason = 'token budget exhausted'; break; }
          callbacks.onMessage?.(clone(messages));
          const response = await waitWithSignal(llm.complete(clone(messages), tools, { signal, maxTokens: Math.max(1, Math.min(config.llm.maxTokens, remaining)), temperature: config.llm.temperature }), signal);
          assertActive();
          turns++;
          const tokens = response.usage ?? { promptTokens: promptEstimate, completionTokens: estimateTokens(response), totalTokens: promptEstimate + estimateTokens(response) };
          usageEstimated ||= !response.usage;
          usage = { promptTokens: usage.promptTokens + tokens.promptTokens, completionTokens: usage.completionTokens + tokens.completionTokens, totalTokens: usage.totalTokens + tokens.totalTokens };
          if (config.agent.maxTotalTokens !== undefined && usage.totalTokens >= config.agent.maxTotalTokens) {
            state = 'stopped'; stopReason = 'token budget exhausted'; break;
          }
          if (!response.content?.trim() && !response.toolCalls?.length) { state = 'error'; stopReason = 'empty response'; break; }
          if (response.toolCalls?.length) {
            parseAttempts = 0;
            pendingToolCalls = response.toolCalls.map((call, index) => ({ ...call, id: call.id || `call_${turns}_${index}` }));
            messages.push({ role: 'assistant', content: response.content, toolCalls: clone(pendingToolCalls) });
            // 每个执行结果与剩余调用一起持久化，恢复时不重放已执行动作。
            for (const call of [...pendingToolCalls]) await runAction({ type: call.name as AgentAction['type'], params: call.arguments, toolCallId: call.id }, response.content, true);
            trim();
            await save();
            continue;
          }
          const parsed = parseResponse(response.content);
          messages.push({ role: 'assistant', content: response.content });
          if (parsed.kind === 'text') {
            parseAttempts++;
            if (parseAttempts > 1) { state = 'error'; stopReason = 'unparseable response'; break; }
            messages.push({ role: 'user', content: 'Your response was not in the expected JSON format. Please respond with valid JSON.' });
            await save();
            continue;
          }
          parseAttempts = 0;
          if (parsed.kind === 'done') {
            summary = parsed.summary;
            if (!callbacks.onVerify) { state = 'completed'; stopReason = 'done signal (unverified)'; break; }
            const validation = await callbacks.onVerify({ task, summary, history: clone(history), signal });
            assertActive();
            verified = validation.success;
            if (verified) { state = 'completed'; stopReason = 'verification passed'; break; }
            messages.push({ role: 'user', content: `独立验收失败，请根据报错继续修复：${limitText(JSON.stringify(validation), config.memory.maxToolOutputChars ?? 16000)}` });
            await save();
            continue;
          }
          await runAction(parsed.action, response.content, false);
          trim();
          await save();
        }
        callbacks.onStop?.(stopReason);
        await save();
        return { state, turns, summary, history, verified, usage, usageEstimated, stopReason, checkpoint: clone(latest!) };
      } catch (error) {
        state = signal.aborted ? 'stopped' : 'error';
        stopReason = error instanceof Error ? error.message : String(error);
        callbacks.onStop?.(stopReason);
        await save();
        throw error;
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', forwardAbort);
        active = false;
      }
    },
  };
}

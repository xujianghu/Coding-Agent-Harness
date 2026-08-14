import {
  AgentConfig,
  AgentAction,
  ActionResult,
  ConversationTurn,
  AgentState,
  LLMProvider,
  ToolDefinition,
} from './types';

function buildSystemPrompt(tools: ToolDefinition[]): string {
  const toolList = tools
    .map((t) => {
      const params = Object.entries(t.parameters)
        .map(([k, v]) => `    "${k}": ${v.type} // ${v.description}${v.required ? ' (required)' : ''}`)
        .join('\n');
      return `  ${t.name}: ${t.description}\n  parameters:\n${params}`;
    })
    .join('\n\n');

  return `You are a coding agent. Respond ONLY with JSON in one of these formats:

1. To perform an action:
\`\`\`json
{"action": {"type": "<tool_name>", "params": { ... }}}
\`\`\`

2. To signal completion:
\`\`\`json
{"done": true, "summary": "<what was accomplished>"}
\`\`\`

Available tools:
${toolList}`;
}

function buildInitialMessages(task: string, systemPrompt: string): Array<{ role: string; content: string }> {
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: task },
  ];
}

function checkStopCondition(turns: number, maxTurns: number): boolean {
  return turns >= maxTurns;
}

function appendTurnMessages(
  messages: Array<{ role: string; content: string }>,
  response: string,
  result: { success: boolean; output?: string; error?: string }
): void {
  messages.push({ role: 'assistant', content: response });
  messages.push({
    role: 'user',
    content: `Action result: ${JSON.stringify(result)}`,
  });
}

export type ParsedResponse =
  | { kind: 'action'; action: AgentAction }
  | { kind: 'done'; summary: string }
  | { kind: 'text'; text: string };

export function parseResponse(
  content: string,
  toolCalls?: Array<{ name: string; arguments: Record<string, string> }>,
): ParsedResponse {
  if (toolCalls && toolCalls.length > 0) {
    const tc = toolCalls[0];
    return { kind: 'action', action: { type: tc.name as AgentAction['type'], params: tc.arguments } };
  }

  const trimmed = content.trim();
  if (!trimmed) return { kind: 'text', text: '' };

  let jsonStr = trimmed;

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed.action && parsed.action.type && parsed.action.params) {
      return { kind: 'action', action: parsed.action };
    }
    if (parsed.done) {
      return { kind: 'done', summary: parsed.summary || '' };
    }
    return { kind: 'text', text: trimmed };
  } catch {
    // 整体 JSON.parse 失败，可能是「文本说明 + JSON action」混合输出。
    // 尝试提取内容中内嵌的 JSON 对象（从首个 { 到最后一个 }）。
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const candidate = trimmed.slice(firstBrace, lastBrace + 1);

      const parseCandidate = (s: string): ParsedResponse | null => {
        try {
          const parsed = JSON.parse(s);
          if (parsed.action && parsed.action.type && parsed.action.params) {
            return { kind: 'action', action: parsed.action };
          }
          if (parsed.done) {
            return { kind: 'done', summary: parsed.summary || '' };
          }
          return null;
        } catch {
          return null;
        }
      };

      const direct = parseCandidate(candidate);
      if (direct) return direct;

      // LLM 常在多行字符串字段（如 content）里放真正的换行而非 \n 转义，导致 JSON 无效。
      // 尝试把裸换行修复为 \n 转义后再解析一次。
      const repaired = parseCandidate(candidate.replace(/\r?\n/g, '\\n'));
      if (repaired) return repaired;
    }
    return { kind: 'text', text: trimmed };
  }
}

export function executeAction(tools: ToolDefinition[], action: AgentAction): Promise<ActionResult> {
  const tool = tools.find((t) => t.name === action.type);
  if (!tool) {
    return Promise.resolve({
      success: false,
      output: '',
      error: `Unknown tool: ${action.type}`,
    });
  }
  // 捕获工具执行异常，避免单个工具抛错导致整个进程崩溃。
  return tool.execute(action.params).catch((err) => ({
    success: false,
    output: '',
    error: err instanceof Error ? err.message : String(err),
  }));
}

export function trimConversationHistory(
  messages: Array<{ role: string; content: string }>,
  maxTurns: number
): Array<{ role: string; content: string }> {
  const maxMessages = maxTurns * 2 + 2;
  if (messages.length <= maxMessages) {
    return messages;
  }
  return [...messages.slice(0, 2), ...messages.slice(-(maxTurns * 2))];
}

export interface AgentRunResult {
  state: AgentState;
  turns: number;
  summary: string;
  history: ConversationTurn[];
}

export interface AgentCallbacks {
  onAction?: (action: AgentAction, turn: number) => { allowed: boolean; reason?: string } | void | Promise<{ allowed: boolean; reason?: string } | void>;
  onTurn?: (turn: ConversationTurn) => void;
  onStop?: (reason: string) => void;
  onMessage?: (messages: Array<{ role: string; content: string }>) => void;
}

export function createAgentLoop(
  config: AgentConfig,
  llm: LLMProvider,
  tools: ToolDefinition[],
  callbacks: AgentCallbacks,
) {
  return {
    async run(task: string): Promise<AgentRunResult> {
      const timeout = config.agent.timeout;
      const runPromise = (async () => {
        const history: ConversationTurn[] = [];
        const systemPrompt = buildSystemPrompt(tools);
        let messages = buildInitialMessages(task, systemPrompt);

        history.push({
          role: 'user',
          content: task,
          timestamp: Date.now(),
        });

        let turns = 0;
        let summary = '';
        let state: AgentState = 'running';
        const maxTurns = config.agent.maxTurns;
        let parseAttempts = 0;

        while (!checkStopCondition(turns, maxTurns)) {
          callbacks.onMessage?.(messages);
          const response = await llm.complete(messages, tools);
          turns++;

          if ((!response.content || response.content.trim() === '') && (!response.toolCalls || response.toolCalls.length === 0)) {
            state = 'completed';
            callbacks.onStop?.('empty response');
            break;
          }

          const parsed = parseResponse(response.content, response.toolCalls);

          if (parsed.kind === 'text') {
            if (parseAttempts === 0) {
              parseAttempts++;
              messages.push({ role: 'user', content: 'Your response was not in the expected JSON format. Please respond with valid JSON.' });
              continue;
            }
            state = 'completed';
            callbacks.onStop?.('unparseable response');
            break;
          }

          if (parsed.kind === 'done') {
            summary = parsed.summary;
            state = 'completed';
            callbacks.onStop?.('done signal');
            break;
          }

          if (parsed.kind === 'action') {
            const action = parsed.action;

            const approval = await callbacks.onAction?.(action, turns);
            if (approval && !approval.allowed) {
              const blockedResult: ActionResult = {
                success: false,
                output: '',
                error: approval.reason || 'Action blocked',
              };

              const turn: ConversationTurn = {
                role: 'assistant',
                content: response.content,
                timestamp: Date.now(),
                action,
                result: blockedResult,
              };

              history.push(turn);
              callbacks.onTurn?.(turn);

              messages.push({ role: 'assistant', content: response.content });
              messages.push({
                role: 'user',
                content: `Action blocked: ${approval.reason || 'not allowed'}`,
              });
              messages = trimConversationHistory(messages, config.memory.maxConversationTurns);
              continue;
            }

            const result = await executeAction(tools, action);

            const turn: ConversationTurn = {
              role: 'assistant',
              content: response.content,
              timestamp: Date.now(),
              action,
              result,
            };

            history.push(turn);
            callbacks.onTurn?.(turn);

            appendTurnMessages(messages, response.content, result);
            messages = trimConversationHistory(messages, config.memory.maxConversationTurns);
          }
        }

        if (state === 'running') {
          state = 'stopped';
          callbacks.onStop?.('maxTurns reached');
        }

        return { state, turns, summary, history };
      })();

      const result = await Promise.race([
        runPromise,
        new Promise<AgentRunResult>((_, reject) => {
          const timer = setTimeout(() => reject(new Error(`Agent timed out after ${timeout}ms`)), timeout);
          runPromise.finally(() => clearTimeout(timer));
        }),
      ]);
      return result;
    },
  };
}
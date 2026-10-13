import { randomUUID } from 'crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';
import { validateConfig, DefaultConfig } from '../config/loader';
import { workspaceConfiguration } from '../config/initialize';
import { createAgentLoop } from '../core/loop';
import { validateContextMessages } from '../core/conversation-context';
import { throwIfAborted } from '../core/runtime';
import type { AgentAction, AgentCheckpoint, AgentConfig, LLMMessage, LLMProvider, ToolExecutionContext } from '../core/types';
import { createGuardrailEngine } from '../governance/guardrail';
import { createHITL } from '../governance/hitl';
import { createGovernancePipeline } from '../governance/pipeline';
import { createSandbox } from '../governance/sandbox';
import { loadGuardrailRules } from '../governance/load-rules';
import type { GuardrailRule } from '../governance/rules';
import { createLLMProvider } from '../llm/factory';
import { createCredentialManager } from '../credential/manager';
import { createWorkspaceTools } from '../tools/workspace';
import { createCommandExecutor } from '../tools/executor';
import { assertSessionUnchanged, loadSession, saveSession, sessionConfigHash, type StoredSession } from '../cli/checkpoint';
import { createRunTrace, traceProvider } from '../cli/trace';
import { listEvaluationReports, readBounded, readTrace, saveConversation, saveRun, statePath, VALID_ID, type StoredConversation } from './storage';
import type { WebApproval, WebConversation, WebConversationDetail, WebRun, WebRunInput, WebWorkspace } from './types';
import { previewWorkspace, workspaceChanges } from './changes';

export class WebApiError extends Error {
  constructor(message: string, public status = 400, public code = 'INVALID_REQUEST') { super(message); }
}

interface ActiveRun {
  id: string; controller: AbortController; promise: Promise<void>;
  approval?: { id: string; resolve: (approved: boolean) => void };
}

type ManagedRun = WebRun & { source: 'web' | 'cli'; provider: AgentConfig['llm']['provider'] | 'mock' | 'unknown' };

function demoConfig(): AgentConfig {
  const config = structuredClone(DefaultConfig);
  config.agent = { maxTurns: 12, timeout: 300000, maxTotalTokens: 100000 };
  config.execution = { mode: 'local', timeout: 10000 };
  config.governance.sandbox = { allowedPaths: ['./'], allowedCommands: ['node'] };
  return config;
}

const DEMO_RULES: GuardrailRule[] = [{ name: '演示测试需要人工审批', type: 'command', pattern: '^node --test', action: 'approve', severity: 'medium' }];
const DEMO_VERIFIER = 'node --test amount.test.cjs';

function demoProvider(checkpoint?: AgentCheckpoint, followup?: string[]): LLMProvider {
  let turn = checkpoint?.turns ?? 0;
  const actions: AgentAction[] = followup ? [
    { type: 'read_file', params: { path: 'amount.js' } },
    { type: 'write_file', params: { path: 'notes.md', content: '# 会话追加说明\n\n此文件来自固定响应机制演示，不代表模型理解了需求。\n\n' + followup.map((content, index) => `${index + 1}. ${content}`).join('\n') + '\n' } },
  ] : [
    { type: 'write_file', params: { path: 'amount.js', content: 'module.exports = (price, quantity) => price + quantity;\n' } },
    { type: 'read_file', params: { path: 'amount.js' } },
    { type: 'apply_patch', params: { path: 'amount.js', old_text: 'price + quantity', new_text: 'price * quantity' } },
  ];
  return { name: 'mock', async complete() {
    const action = actions[turn++];
    return action ? { content: '', toolCalls: [{ id: `demo_${turn}`, name: action.type, arguments: action.params }] }
      : { content: JSON.stringify({ done: true, summary: followup
        ? '机制演示：读取上一轮金额函数，在同一工作区记录追加需求，并再次申请执行测试。固定响应不代表真实模型能力。'
        : '机制演示：已创建并读取金额计算函数，使用补丁修复乘法，并申请执行测试。固定脚本不代表真实模型能力。' }) };
  } };
}

function validInput(input: unknown): asserts input is WebRunInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new WebApiError('请求必须是对象');
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some(key => !['task', 'verify', 'mock', 'execution'].includes(key))) throw new WebApiError('包含未知任务参数');
  if (typeof record.task !== 'string' || !record.task.trim() || record.task.length > 16000) throw new WebApiError('任务必须包含 1 到 16000 个字符');
  if (record.verify !== undefined && (typeof record.verify !== 'string' || record.verify.length > 4000)) throw new WebApiError('验收命令无效');
  if (record.mock !== undefined && typeof record.mock !== 'boolean') throw new WebApiError('mock 必须是布尔值');
  if (record.execution !== undefined && !['local', 'docker'].includes(String(record.execution))) throw new WebApiError('执行模式无效');
}

export function createRunManager(options: { workspace: string; configPath?: string; projectId?: string }) {
  const workspace = realpathSync(resolve(options.workspace));
  const configPath = options.configPath ? (isAbsolute(options.configPath) ? options.configPath : resolve(workspace, options.configPath)) : join(workspace, '.harness', 'config.yaml');
  const runs = new Map<string, ManagedRun>();
  const conversations = new Map<string, StoredConversation>();
  const subscribers = new Map<string, Set<(run: WebRun) => void>>();
  let active: ActiveRun | undefined;
  let closed = false;
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

  function services(execution?: 'local' | 'docker') {
    const { config, rules, rulesPath } = workspaceConfiguration(workspace, configPath);
    if (execution) config.execution = { ...config.execution, mode: execution };
    validateConfig(config);
    if (!existsSync(rulesPath)) throw new WebApiError('缺少护栏文件，请先在工作区运行 harness init', 409, 'WORKSPACE_NOT_INITIALIZED');
    return { config, rules, rulesPath };
  }

  function getWorkspace(): WebWorkspace {
    const { config, rules, initialized } = workspaceConfiguration(workspace, configPath);
    return { workspace, projectId: options.projectId, initialized, config: { llm: { provider: config.llm.provider, model: config.llm.model, maxTokens: config.llm.maxTokens, temperature: config.llm.temperature },
      agent: config.agent, memory: config.memory, governance: { rulesCount: rules.length, ...config.governance.sandbox } },
      execution: config.execution, tools: createWorkspaceTools(config, workspace).map(({ name, description }) => ({ name, description })) };
  }

  function checkpointFor(run: WebRun): StoredSession {
    const path = statePath(run.workspace, 'sessions', run.id + '.json');
    if (!existsSync(path)) throw new WebApiError('此任务没有可恢复的检查点，请启动新任务', 409, 'NO_CHECKPOINT');
    readBounded(path, 8 * 1024 * 1024);
    return loadSession(run.workspace, run.id);
  }

  function recentFiles(directory: 'web-runs' | 'sessions' | 'web-conversations'): string[] {
    const path = statePath(workspace, directory);
    if (!existsSync(path)) return [];
    return readdirSync(path).filter(name => /^[a-zA-Z0-9_-]{1,100}\.json$/.test(name)).flatMap(file => {
      try {
        const stat = lstatSync(statePath(workspace, directory, file));
        return stat.isFile() ? [{ file, modified: stat.mtimeMs }] : [];
      } catch { return []; }
    }).sort((a, b) => b.modified - a.modified || a.file.localeCompare(b.file)).slice(0, 100).map(item => item.file);
  }

  function hydrateConversations(id?: string): void {
    const files = id ? [id + '.json'] : recentFiles('web-conversations');
    for (const file of files) {
      const conversationId = file.slice(0, -5);
      if (!VALID_ID.test(conversationId) || conversations.has(conversationId)) continue;
      try {
        // 100 轮中文消息的 UTF-8 元数据仍须在重启后完整恢复。
        const item = JSON.parse(readBounded(statePath(workspace, 'web-conversations', file), 16 * 1024 * 1024)) as StoredConversation;
        const expected = item.mock === true ? statePath(workspace, 'web-demo', conversationId) : workspace;
        if (item.id !== conversationId || item.workspace !== expected || typeof item.mock !== 'boolean'
          || !['local', 'docker'].includes(item.execution) || (item.mock && item.execution !== 'local')
          || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200
          || typeof item.configHash !== 'string' || !/^[a-f0-9]{64}$/.test(item.configHash)
          || !Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt)
          || (item.verifier !== undefined && (typeof item.verifier !== 'string' || item.verifier.length > 4000))
          || !Array.isArray(item.runIds) || item.runIds.length > 100 || item.runIds.some(runId => typeof runId !== 'string' || !VALID_ID.test(runId))
          || new Set(item.runIds).size !== item.runIds.length || !Array.isArray(item.messages) || item.messages.length > 200
          || item.messages.some(message => !message || !VALID_ID.test(message.id) || !['user', 'assistant'].includes(message.role)
            || typeof message.content !== 'string' || message.content.length > 32000 || !Number.isFinite(message.createdAt) || !item.runIds.includes(message.runId))) continue;
        // 重新根据服务工作区计算路径，持久化元数据不能选择任意宿主目录。
        conversations.set(item.id, { ...item, workspace: expected });
      } catch { /* 损坏或不可信的会话元数据不参与文件访问或执行。 */ }
    }
  }

  function hydrate(requestedId?: string): void {
    hydrateConversations();
    const directory = statePath(workspace, 'web-runs');
    if (existsSync(directory)) for (const file of requestedId ? [requestedId + '.json'] : recentFiles('web-runs')) {
      const id = file.slice(0, -5);
      if (runs.has(id)) continue;
      try {
        const run = JSON.parse(readBounded(statePath(workspace, 'web-runs', file))) as ManagedRun;
        run.source ??= 'web';
        run.provider ??= run.mock ? 'mock' : 'unknown';
        if (run.conversationId) hydrateConversations(run.conversationId);
        const conversation = run.conversationId ? conversations.get(run.conversationId) : undefined;
        if (run.conversationId && (!conversation || run.source !== 'web' || !conversation.runIds.includes(id) || conversation.mock !== run.mock
          || conversation.verifier !== run.verifier || conversation.execution !== run.execution?.mode)) continue;
        const expectedWorkspace = conversation?.workspace ?? (run.mock && run.source === 'web' ? statePath(workspace, 'web-demo', id) : workspace);
        if (run.id !== id || run.workspace !== expectedWorkspace || typeof run.task !== 'string' || typeof run.mock !== 'boolean') continue;
        if (['planned', 'running', 'awaiting_approval'].includes(run.status)) { run.status = 'stopped'; run.stopReason = '服务重启，任务已停止，请检查后恢复'; }
        run.events = readTrace(workspace, id);
        run.pendingApproval = undefined;
        // 提供商初始化等早期失败可能尚未产生检查点，历史与轨迹仍应保留。
        run.resumable = false;
        if (existsSync(statePath(run.workspace, 'sessions', run.id + '.json'))) {
          const checkpoint = checkpointFor(run).checkpoint;
          run.resumable = checkpoint.state !== 'completed' && !checkpoint.verified && !checkpoint.executionUncertain
            && !(run.source === 'cli' && (run.mock || run.provider === 'unknown'));
        }
        runs.set(id, run);
      } catch { /* 损坏的历史元数据不参与恢复。 */ }
    }
    const sessions = statePath(workspace, 'sessions');
    if (!existsSync(sessions)) return;
    for (const file of requestedId ? [requestedId + '.json'] : recentFiles('sessions')) {
      const id = file.slice(0, -5);
      if (runs.has(id)) continue;
      try {
        readBounded(statePath(workspace, 'sessions', file), 8 * 1024 * 1024);
        const session = loadSession(workspace, id);
        const checkpoint = session.checkpoint;
        const events = readTrace(workspace, id);
        const origin = [...events].reverse().find(event => ['started', 'resumed'].includes(event.type)
          && event.data && typeof event.data === 'object' && typeof (event.data as Record<string, unknown>).provider === 'string');
        const recordedProvider = (origin?.data as Record<string, unknown> | undefined)?.provider;
        const provider: ManagedRun['provider'] = ['mock', 'openai', 'anthropic', 'gemini'].includes(String(recordedProvider))
          ? recordedProvider as ManagedRun['provider'] : 'unknown';
        const mock = provider === 'mock';
        runs.set(id, { id, workspace, task: checkpoint.task, mock, source: 'cli', provider,
          status: checkpoint.state === 'completed' ? 'completed' : checkpoint.state === 'error' ? 'error' : 'stopped', verified: checkpoint.verified,
          summary: checkpoint.summary, stopReason: '从 CLI 会话检查点载入', turns: checkpoint.turns, usage: checkpoint.usage, usageEstimated: checkpoint.usageEstimated,
          startedAt: session.updatedAt - checkpoint.elapsedMs, finishedAt: session.updatedAt, verifier: session.verifier,
          events, changes: [], resumable: !mock && provider !== 'unknown' && checkpoint.state !== 'completed' && !checkpoint.verified && !checkpoint.executionUncertain });
      } catch { /* 只展示通过格式与工作区校验的检查点。 */ }
    }
  }

  function getRun(id: string): WebRun {
    if (!VALID_ID.test(id)) throw new WebApiError('任务 ID 无效');
    hydrate(id);
    const run = runs.get(id);
    if (!run) throw new WebApiError('任务不存在', 404, 'NOT_FOUND');
    const conversation = run.conversationId ? conversations.get(run.conversationId) : undefined;
    return copy({ ...run, resumable: run.resumable && (!conversation || conversation.runIds.at(-1) === id) });
  }

  function conversationById(id: string): StoredConversation {
    if (!VALID_ID.test(id)) throw new WebApiError('会话 ID 无效');
    hydrateConversations(id);
    const conversation = conversations.get(id);
    if (!conversation) throw new WebApiError('会话不存在', 404, 'NOT_FOUND');
    return conversation;
  }

  function previousContext(conversation: StoredConversation): LLMMessage[] | undefined {
    const following: LLMMessage[] = [];
    for (const id of [...conversation.runIds].reverse()) {
      const run = getRun(id);
      if (!existsSync(statePath(run.workspace, 'sessions', run.id + '.json'))) {
        // 只有在尚未进入动作阶段时，才可把启动失败当普通对话继续。
        if (run.events.some(item => ['policy', 'tool_result', 'workspace_changes', 'verification'].includes(item.type))) {
          throw new WebApiError('上一轮进入动作阶段但缺少检查点，请先检查工作区并创建新会话', 409, 'UNSAFE_CONTEXT');
        }
        const messages = conversation.messages.filter(message => message.runId === id).map(message => ({ role: message.role, content: message.content }));
        following.unshift(...messages);
        continue;
      }
      const checkpoint = checkpointFor(run).checkpoint;
      if (checkpoint.executionUncertain || checkpoint.pendingToolCalls?.length) throw new WebApiError('上一轮存在结果未知或未完成的工具调用，请先检查并安全恢复原任务', 409, 'UNSAFE_CONTEXT');
      try { return validateContextMessages([...checkpoint.messages, ...following]); }
      catch (error) { throw new WebApiError(error instanceof Error ? error.message : '上一轮工具调用与结果不完整', 409, 'UNSAFE_CONTEXT'); }
    }
    return following.length ? validateContextMessages(following) : undefined;
  }

  function conversationView(conversation: StoredConversation): WebConversation {
    const { configHash: _configHash, ...view } = conversation;
    let blockedReason: string | undefined;
    if (closed) blockedReason = '服务正在关闭';
    else if (active) blockedReason = active.id && conversation.runIds.includes(active.id) ? '本轮正在执行，请等待或取消后继续' : '其他任务正在执行，请先等待或取消';
    else if (conversation.runIds.length >= 100) blockedReason = '会话已达到 100 轮上限，请创建新会话';
    else {
      try { previousContext(conversation); }
      catch (error) { blockedReason = error instanceof Error ? error.message : '上下文无法安全继续'; }
    }
    return copy({ ...view, canSend: !blockedReason, blockedReason });
  }

  function getConversation(id: string): WebConversationDetail {
    const conversation = conversationById(id);
    return { ...conversationView(conversation), runs: conversation.runIds.map(getRun) };
  }

  function streamSnapshot(run: WebRun): WebRun {
    const snapshot = copy(run);
    let bytes = 0;
    snapshot.events = [...snapshot.events].reverse().filter(item => {
      bytes += JSON.stringify(item).length;
      return bytes <= 256 * 1024;
    }).reverse();
    return snapshot;
  }

  function publish(run: WebRun): void {
    const listeners = subscribers.get(run.id);
    if (!listeners?.size) return;
    const snapshot = streamSnapshot(run);
    for (const listener of listeners) {
      try { listener(snapshot); } catch { listeners.delete(listener); }
    }
  }

  function event(run: WebRun, type: string, data: unknown): void {
    const encoded = JSON.stringify(data);
    const limited = encoded && encoded.length > 65536 ? { truncated: true, preview: encoded.slice(0, 65536) } : data;
    const item = { sequence: (run.events.at(-1)?.sequence ?? 0) + 1, timestamp: Date.now(), type, data: limited };
    run.events.push(item);
    if (run.events.length > 250) run.events.shift();
    createRunTrace(statePath(workspace, 'runs', run.id + '.jsonl'), run.id).event(type, { ...limited as object, sequence: item.sequence });
    publish(run);
  }

  async function approval(run: WebRun, action: AgentAction, reason: string, signal?: AbortSignal): Promise<boolean> {
    throwIfAborted(signal);
    const current = active;
    if (!current || current.id !== run.id) throw new Error('任务已失效');
    const pending: WebApproval = { approvalId: randomUUID(), action, reason, requestedAt: Date.now() };
    run.pendingApproval = pending;
    run.status = 'awaiting_approval';
    event(run, 'approval_requested', pending);
    saveRun(workspace, run);
    return new Promise<boolean>((resolveApproval, reject) => {
      const cleanup = () => { signal?.removeEventListener('abort', abort); current.approval = undefined; run.pendingApproval = undefined; };
      const abort = () => { cleanup(); reject(signal?.reason ?? new Error('任务已取消')); };
      current.approval = { id: pending.approvalId, resolve(approved) {
        cleanup(); run.status = 'running'; event(run, 'approval_resolved', { approvalId: pending.approvalId, approved }); resolveApproval(approved);
      } };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }

  async function execute(run: WebRun, config: AgentConfig, rules: GuardrailRule[], rulesPath?: string, previous?: StoredSession, contextMessages?: LLMMessage[]): Promise<void> {
    const current = active!;
    const guardrail = createGuardrailEngine(rules);
    const hitl = createHITL();
    const pipeline = createGovernancePipeline(guardrail, hitl, createSandbox(config.governance.sandbox.allowedPaths, config.governance.sandbox.allowedCommands, run.workspace));
    const configHash = sessionConfigHash(config, rules);
    let latest = previous?.checkpoint;
    const before: Map<string, string | null> = previewWorkspace(run.workspace);
    for (const change of run.changes) before.set(change.path, change.before);
    const refreshChanges = () => {
      const next = workspaceChanges(before, previewWorkspace(run.workspace));
      if (JSON.stringify(next) !== JSON.stringify(run.changes)) {
        run.changes = next;
        event(run, 'workspace_changes', { paths: next.map(change => change.path), previewLimit: 200 });
      }
    };
    const tools = createWorkspaceTools(config, run.workspace).map(tool => ({ ...tool, async execute(params: Record<string, string>, context?: ToolExecutionContext) {
      const result = await tool.execute(params, context);
      if (['write_file', 'apply_patch', 'delete_file', 'shell_exec', 'run_test', 'run_lint'].includes(tool.name)) refreshChanges();
      return result;
    } }));
    const authorize = async (action: AgentAction, context?: ToolExecutionContext) => {
      throwIfAborted(context?.signal);
      // 审批前后读取当前策略，人工授权不能覆盖已经新增的硬性拦截。
      if (rulesPath) guardrail.replaceRules(loadGuardrailRules(rulesPath));
      let result = pipeline.process(action);
      event(run, 'policy', { action, result });
      if (result.requiresApproval) {
        const approved = await approval(run, action, result.reason ?? '此操作需要人工审批', context?.signal);
        if (!approved) { hitl.reject('用户拒绝'); return { allowed: false, reason: '用户拒绝审批' }; }
        throwIfAborted(context?.signal);
        hitl.approve();
        if (rulesPath) guardrail.replaceRules(loadGuardrailRules(rulesPath));
        result = pipeline.process(action, true);
        event(run, 'policy_recheck', { action, result });
      }
      return { allowed: result.allowed, reason: result.reason };
    };
    try {
      run.status = 'running';
      event(run, previous ? 'resumed' : 'started', { task: run.task, mock: run.mock, execution: config.execution, workspace: run.workspace });
      saveRun(workspace, run);
      const conversation = run.conversationId ? conversations.get(run.conversationId) : undefined;
      const followup = conversation && conversation.runIds.indexOf(run.id) > 0
        ? conversation.messages.filter(message => message.role === 'user').map(message => message.content) : undefined;
      const provider = run.mock ? demoProvider(previous?.checkpoint, followup) : await createLLMProvider(config.llm,
        createCredentialManager(statePath(workspace, 'credentials'), process.env.HARNESS_MASTER_PASSWORD));
      throwIfAborted(current.controller.signal);
      const loop = createAgentLoop(config, traceProvider(provider, { event: (type, data) => event(run, type, data) }), tools, {
        onAction: (action, _turn, context) => authorize(action, context),
        onTurn(turn) { event(run, 'tool_result', turn); },
        onStop(reason) { run.stopReason = reason; },
        async onCheckpoint(checkpoint) {
          latest = checkpoint; run.turns = checkpoint.turns; run.summary = checkpoint.summary;
          run.usage = checkpoint.usage; run.usageEstimated = checkpoint.usageEstimated; run.verified = checkpoint.verified;
          run.resumable = !checkpoint.verified && checkpoint.state !== 'completed' && !checkpoint.executionUncertain;
          statePath(run.workspace, 'sessions', run.id + '.json');
          saveSession(run.workspace, configHash, checkpoint, run.id, run.verifier);
          saveRun(workspace, run);
          publish(run);
        },
        ...(run.verifier ? { async onVerify(context: ToolExecutionContext) {
          const action: AgentAction = { type: 'run_test', params: { command: run.verifier! } };
          const permission = await authorize(action, context);
          const result = permission.allowed ? await createCommandExecutor({ mode: config.execution?.mode ?? 'docker', workspaceRoot: run.workspace,
            dockerImage: config.execution?.image, timeoutMs: config.execution?.timeout }).execute(run.verifier!, context)
            : { success: false, output: '', error: permission.reason };
          event(run, 'verification', result);
          refreshChanges();
          return result;
        } } : {}),
      });
      const result = await loop.run(run.task, { checkpoint: previous?.checkpoint, contextMessages, signal: current.controller.signal });
      run.status = result.state === 'completed' ? 'completed' : result.state === 'error' ? 'error' : 'stopped';
      run.verified = result.verified; run.summary = result.summary; run.stopReason = result.stopReason;
    } catch (error) {
      run.status = current.controller.signal.aborted ? 'cancelled' : latest?.state === 'stopped' ? 'stopped' : 'error';
      run.stopReason = error instanceof Error ? error.message : String(error);
      event(run, 'run_error', { message: run.stopReason });
    } finally {
      refreshChanges();
      run.finishedAt = Date.now(); run.pendingApproval = undefined;
      if (latest) run.resumable = latest.state !== 'completed' && !latest.verified && !latest.executionUncertain;
      else run.resumable = false;
      event(run, 'finished', { status: run.status, verified: run.verified, stopReason: run.stopReason });
      saveRun(workspace, run);
      finishConversation(run);
      if (active === current) active = undefined;
    }
  }

  function ensureAvailable(): void {
    if (closed) throw new WebApiError('服务正在关闭', 503, 'CLOSING');
    if (active) throw new WebApiError('已有任务执行中，请先等待或取消', 409, 'RUN_ACTIVE');
  }
  function finishConversation(run: WebRun): void {
    const conversation = run.conversationId ? conversations.get(run.conversationId) : undefined;
    if (!conversation) return;
    const prior = conversation.messages.find(message => message.role === 'assistant' && message.runId === run.id);
    const content = (run.summary || run.stopReason || '本轮已结束').slice(0, 32000);
    if (prior) prior.content = content;
    else conversation.messages.push({ id: randomUUID(), role: 'assistant', content, createdAt: run.finishedAt ?? Date.now(), runId: run.id });
    conversation.updatedAt = Date.now();
    saveConversation(workspace, conversation);
  }

  function launch(run: WebRun, config: AgentConfig, rules: GuardrailRule[], rulesPath?: string, previous?: StoredSession, contextMessages?: LLMMessage[]): void {
    active = { id: run.id, controller: new AbortController(), promise: Promise.resolve() };
    // 下一次事件循环启动，HTTP 调用先获得任务 ID。
    const reservation = active;
    reservation.promise = new Promise<void>(resolveTask => setImmediate(resolveTask)).then(() => execute(run, config, rules, rulesPath, previous, contextMessages));
    // 磁盘故障也记录为终止，避免未处理 Promise 让进程退出。
    reservation.promise = reservation.promise.catch(error => {
      run.status = 'error'; run.stopReason = error instanceof Error ? error.message : String(error); run.finishedAt = Date.now();
      if (active === reservation) active = undefined;
      publish(run);
    });
  }

  function initializeDemo(runWorkspace: string): void {
    mkdirSync(runWorkspace, { recursive: true });
    writeFileSync(join(runWorkspace, 'amount.test.cjs'), "const test = require('node:test');\nconst assert = require('node:assert/strict');\ntest('金额为单价乘以数量', () => assert.equal(require('./amount.js')(12, 3), 36));\n");
  }

  function createConversation(input: unknown): WebConversation {
    if (closed) throw new WebApiError('服务正在关闭', 503, 'CLOSING');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new WebApiError('请求必须是对象');
    const record = input as Record<string, unknown>;
    if (Object.keys(record).some(key => !['title', 'mock', 'execution', 'verify'].includes(key))) throw new WebApiError('包含未知会话参数');
    if (record.title !== undefined && (typeof record.title !== 'string' || record.title.length > 200)) throw new WebApiError('会话标题最多 200 个字符');
    validInput({ mock: record.mock, execution: record.execution, verify: record.verify, task: '新会话' });
    const mock = record.mock !== false;
    if (mock && record.execution !== undefined && record.execution !== 'local') throw new WebApiError('机制演示使用固定 local 模式');
    if (mock && typeof record.verify === 'string' && record.verify.trim()) throw new WebApiError('机制演示使用固定验收命令');
    const setup = mock ? { config: demoConfig(), rules: DEMO_RULES } : services(record.execution as 'local' | 'docker' | undefined);
    const id = randomUUID();
    const runWorkspace = mock ? statePath(workspace, 'web-demo', id) : workspace;
    if (mock) initializeDemo(runWorkspace);
    const conversation: StoredConversation = { id, title: typeof record.title === 'string' && record.title.trim() ? record.title.trim() : '新会话',
      createdAt: Date.now(), updatedAt: Date.now(), workspace: runWorkspace, mock,
      execution: setup.config.execution?.mode ?? 'docker', verifier: mock ? DEMO_VERIFIER : (record.verify as string | undefined)?.trim() || undefined,
      runIds: [], messages: [], canSend: true, configHash: sessionConfigHash(setup.config, setup.rules) };
    conversations.set(id, conversation);
    saveConversation(workspace, conversation);
    return conversationView(conversation);
  }

  function sendMessage(id: string, input: unknown): { conversation: WebConversation; run: WebRun } {
    ensureAvailable();
    const conversation = conversationById(id);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'content')) throw new WebApiError('消息只接受 content 参数，会话模式保持固定');
    const content = (input as Record<string, unknown>).content;
    if (typeof content !== 'string' || !content.trim() || content.length > 16000) throw new WebApiError('消息必须包含 1 到 16000 个字符');
    if (conversation.runIds.length >= 100) throw new WebApiError('会话已达到 100 轮上限，请创建新会话', 409, 'CONVERSATION_LIMIT');
    const contextMessages = previousContext(conversation);
    const setup = conversation.mock ? { config: demoConfig(), rules: DEMO_RULES, rulesPath: undefined } : services(conversation.execution);
    if (sessionConfigHash(setup.config, setup.rules) !== conversation.configHash) throw new WebApiError('配置或护栏已改变，请创建新会话以明确采用新配置', 409, 'CONFIG_CHANGED');
    const runId = randomUUID();
    const run: ManagedRun = { id: runId, conversationId: id, task: content.trim(), mock: conversation.mock,
      source: 'web', provider: conversation.mock ? 'mock' : setup.config.llm.provider, workspace: conversation.workspace,
      status: 'planned', verified: false, summary: '', stopReason: '', turns: 0,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, usageEstimated: false, startedAt: Date.now(),
      events: [], changes: [], verifier: conversation.verifier, execution: setup.config.execution, resumable: false };
    conversation.runIds.push(runId);
    conversation.messages.push({ id: randomUUID(), role: 'user', content: run.task, createdAt: Date.now(), runId });
    if (conversation.title === '新会话') conversation.title = run.task.slice(0, 60);
    conversation.updatedAt = Date.now();
    saveConversation(workspace, conversation);
    runs.set(runId, run); saveRun(workspace, run);
    launch(run, setup.config, setup.rules, setup.rulesPath, undefined, contextMessages);
    return { conversation: conversationView(conversation), run: copy(run) };
  }

  function start(input: unknown): WebRun {
    validInput(input); ensureAvailable();
    const id = randomUUID();
    const mock = input.mock === true;
    const setup = mock ? { config: demoConfig(), rules: DEMO_RULES, rulesPath: undefined } : services(input.execution);
    const runWorkspace = mock ? statePath(workspace, 'web-demo', id) : workspace;
    if (mock) {
      if (input.verify?.trim()) throw new WebApiError('演示使用固定验收命令，请清空验收输入');
      initializeDemo(runWorkspace);
    }
    const run: ManagedRun = { id, task: input.task.trim(), mock, source: 'web', provider: mock ? 'mock' : setup.config.llm.provider,
      workspace: runWorkspace, status: 'planned', verified: false, summary: '', stopReason: '',
      turns: 0, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, usageEstimated: false, startedAt: Date.now(),
      events: [], changes: [], verifier: mock ? DEMO_VERIFIER : input.verify?.trim() || undefined, execution: setup.config.execution, resumable: false };
    runs.set(id, run); saveRun(workspace, run); launch(run, setup.config, setup.rules, setup.rulesPath);
    return copy(run);
  }

  function resume(id: string): WebRun {
    ensureAvailable(); getRun(id);
    const run = runs.get(id)!;
    if (run.conversationId && conversationById(run.conversationId).runIds.at(-1) !== id) throw new WebApiError('此会话已经开始新一轮，不能恢复旧轮以分叉上下文', 409, 'STALE_CONVERSATION_RUN');
    if (run.source === 'cli' && (run.mock || run.provider === 'unknown')) throw new WebApiError('此 CLI 会话使用 mock 或来源未知，请使用原 CLI 模式恢复；工作台不会切换到真实模型', 409, 'CLI_MODE_REQUIRED');
    const session = checkpointFor(run);
    const setup = run.mock ? { config: demoConfig(), rules: DEMO_RULES, rulesPath: undefined } : services(run.execution?.mode);
    try { assertSessionUnchanged(session, run.workspace, sessionConfigHash(setup.config, setup.rules)); }
    catch (error) { throw new WebApiError(error instanceof Error ? error.message : String(error), 409, 'UNSAFE_RESUME'); }
    if (session.checkpoint.executionUncertain) throw new WebApiError('动作结果未知，请检查工作区后启动新任务', 409, 'UNSAFE_RESUME');
    if (session.checkpoint.elapsedMs >= setup.config.agent.timeout || session.checkpoint.turns >= setup.config.agent.maxTurns ||
      (setup.config.agent.maxTotalTokens !== undefined && session.checkpoint.usage.totalTokens >= setup.config.agent.maxTotalTokens)) throw new WebApiError('会话预算已耗尽，请启动新任务', 409, 'BUDGET_EXHAUSTED');
    run.status = 'planned'; run.finishedAt = undefined; run.stopReason = ''; run.resumable = false;
    launch(run, setup.config, setup.rules, setup.rulesPath, session);
    return copy(run);
  }

  return {
    workspace, getWorkspace, getRun, start, resume, getConversation, createConversation, sendMessage,
    hasActiveRun() { return active !== undefined; },
    listConversations() { hydrateConversations(); return [...conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100).map(conversationView); },
    fileWorkspace(conversationId?: string) { return conversationId ? conversationById(conversationId).workspace : workspace; },
    subscribe(id: string, listener: (run: WebRun) => void): () => void {
      const run = getRun(id);
      const listeners = subscribers.get(id) ?? new Set<(run: WebRun) => void>();
      listeners.add(listener); subscribers.set(id, listeners);
      listener(streamSnapshot(run));
      return () => { listeners.delete(listener); if (!listeners.size) subscribers.delete(id); };
    },
    list() { hydrate(); return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 100).map(run => ({ ...getRun(run.id), events: [] })); },
    evaluations() { return listEvaluationReports(workspace); },
    async cancel(id: string) {
      getRun(id);
      if (active?.id !== id) throw new WebApiError('任务当前未执行', 409, 'RUN_NOT_ACTIVE');
      const current = active; current.controller.abort(new Error('用户取消任务'));
      await current.promise;
      return getRun(id);
    },
    approve(id: string, approvalId: string, approved: boolean) {
      getRun(id);
      if (active?.id !== id || active.approval?.id !== approvalId) throw new WebApiError('审批已失效或与任务不匹配', 409, 'APPROVAL_EXPIRED');
      active.approval.resolve(approved);
      return getRun(id);
    },
    async close() { closed = true; const current = active; if (current) { current.controller.abort(new Error('服务关闭，任务已取消')); await current.promise; } subscribers.clear(); },
  };
}

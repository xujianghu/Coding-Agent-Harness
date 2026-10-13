export type RunStatus = 'planned' | 'running' | 'awaiting_approval' | 'completed' | 'error' | 'cancelled' | 'stopped';

export interface RunEvent {
  sequence: number;
  timestamp: number;
  type: string;
  data: unknown;
}

export interface PendingApproval {
  id?: string;
  approvalId?: string;
  action: { type: string; params: Record<string, unknown> };
  reason?: string;
  reasons?: string[];
}

export interface Run {
  id: string;
  conversationId?: string;
  task: string;
  status: RunStatus;
  verified: boolean;
  summary?: string;
  stopReason?: string;
  turns: number;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; promptTokens?: number; completionTokens?: number };
  usageEstimated?: boolean;
  startedAt: number;
  finishedAt?: number;
  events?: RunEvent[];
  pendingApproval?: PendingApproval;
  changes?: { path: string; before: string | null; after: string | null }[];
  mock: boolean;
  source?: 'web' | 'cli';
  provider?: 'mock' | 'openai' | 'anthropic' | 'gemini' | 'unknown';
  workspace: string;
  resumable: boolean;
  execution?: { mode?: 'docker' | 'local'; image?: string; timeout?: number };
}

export interface WorkspaceInfo {
  projectId: string;
  initialized: boolean;
  workspace: string;
  config: {
    llm?: { provider?: string; model?: string; apiKeyConfigured?: boolean };
    agent?: { maxTurns?: number; maxTotalTokens?: number; timeout?: number };
    execution?: { mode?: string; image?: string; timeout?: number };
    memory?: { maxContextTokens?: number; maxToolOutputChars?: number };
    [key: string]: unknown;
  };
  tools: Array<string | { name: string; description?: string }>;
  execution?: unknown;
}

export interface Evaluation {
  id: string;
  createdAt: number;
  kind?: string;
  modes?: string[];
  summary?: { attempts: number; passed: number; modelAttempts: number; mockAttempts: number; modelPassed: number; mockPassed: number };
  report?: string;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  runId: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  workspace: string;
  mock: boolean;
  execution: 'local' | 'docker';
  verifier?: string;
  runIds: string[];
  messages: ConversationMessage[];
  canSend: boolean;
  blockedReason?: string;
}

export interface ConversationDetail extends Conversation { runs: Run[] }
export interface NewConversationInput { title?: string; mock: boolean; execution: 'local' | 'docker'; verify?: string }
export interface FileEntry { name: string; path: string; kind: 'file' | 'directory'; size?: number }
export interface FileListing { path: string; entries: FileEntry[]; truncated: boolean }
export interface FileContent { path: string; content: string; size: number; sha256: string }

export interface Project { id: string; name: string; path: string; initialized: boolean; lastOpenedAt: number }
export interface ProjectListing { activeProjectId: string; projects: Project[]; canSwitch: boolean; blockedReason?: string }
export interface DirectoryListing { path: string; parent: string | null; entries: { name: string; path: string }[]; roots: { name: string; path: string }[]; truncated: boolean }

let activeProjectId: string | null = null;
let projectGeneration = 0;
export function bindProject(id: string | null) { activeProjectId = id; projectGeneration += 1; }
export const getProjectGeneration = () => projectGeneration;
export class RequestError extends Error {
  constructor(message: string, public readonly code?: string) { super(message); }
}
export const staleRequest = (cause: unknown) => cause instanceof RequestError && cause.code === 'STALE_PROJECT' || cause instanceof DOMException && cause.name === 'AbortError';

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const generation = projectGeneration;
  const projectId = activeProjectId;
  const unscoped = path === '/workspace' || path === '/projects' || path.startsWith('/projects/directories');
  if (!unscoped && !projectId) throw new RequestError('请先读取当前项目。', 'STALE_PROJECT');
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (projectId) headers.set('X-Harness-Project', projectId);
  const response = await fetch(`/api${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  if (generation !== projectGeneration || init.signal?.aborted) throw new RequestError('项目已切换，旧请求已作废。', 'STALE_PROJECT');
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(response.ok ? '服务返回了无法读取的内容。' : `请求失败（${response.status}）。`);
  }
  if (!response.ok) {
    const error = data as { error?: string | { message?: string; code?: string }; message?: string; code?: string };
    const code = typeof error.error === 'object' ? error.error?.code ?? error.code : error.code;
    if (code === 'PROJECT_REQUIRED' || code === 'PROJECT_CHANGED') window.dispatchEvent(new CustomEvent('harness-project-changed'));
    throw new RequestError(typeof error.error === 'string' ? error.error : error.error?.message ?? error.message ?? `请求失败（${response.status}）。`, code);
  }
  return data as T;
}

export const isActive = (status: RunStatus) => ['planned', 'running', 'awaiting_approval'].includes(status);

export const runModeText = (run: Run) => run.provider === 'unknown' ? '来源未知' : run.mock ? run.source === 'cli' ? '离线机制自检' : '机制演示' : '真实模型';

export const statusText: Record<RunStatus, string> = {
  planned: '准备执行',
  running: '执行中',
  awaiting_approval: '等待审批',
  completed: '已完成',
  error: '执行失败',
  cancelled: '已取消',
  stopped: '已停止',
};

export const timeLabel = (value?: number) => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
export const shortId = (id: string) => id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-5)}` : id;
export const formatNumber = (value?: number) => value === undefined ? '—' : value.toLocaleString('zh-CN');

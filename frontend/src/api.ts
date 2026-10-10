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

export interface NewRunInput {
  task: string;
  verify?: string;
  mock: boolean;
  execution: 'docker' | 'local';
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(response.ok ? '服务返回了无法读取的内容。' : `请求失败（${response.status}）。`);
  }
  if (!response.ok) {
    const error = data as { error?: string | { message?: string }; message?: string };
    throw new Error(typeof error.error === 'string' ? error.error : error.error?.message ?? error.message ?? `请求失败（${response.status}）。`);
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

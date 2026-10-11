export interface AgentAction {
  type: 'read_file' | 'write_file' | 'delete_file' | 'shell_exec' | 'run_test' | 'run_lint' | 'search_files' | 'search_code' | 'read_file_lines' | 'apply_patch';
  params: Record<string, string>;
  toolCallId?: string;
}

export interface ActionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
}

export interface GuardrailResult {
  allowed: boolean;
  reason?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval?: boolean;
}

export interface PipelineResult {
  allowed: boolean;
  reason?: string;
  requiresApproval?: boolean;
  pipelineStages: string[];
}

export interface ConversationTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  action?: AgentAction;
  result?: ActionResult;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required: boolean }>;
  execute: (params: Record<string, string>, context?: ToolExecutionContext) => Promise<ActionResult>;
}

export interface ToolExecutionContext {
  signal?: AbortSignal;
}

export interface LLMToolCall {
  id?: string;
  name: string;
  arguments: Record<string, string>;
  /** 保留供应商要求回传的工具调用元数据。 */
  metadata?: Record<string, unknown>;
}

export interface LLMMessage {
  role: string;
  content: string;
  toolCalls?: LLMToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface LLMCompletionOptions {
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AgentCheckpoint {
  version: 1;
  task: string;
  messages: LLMMessage[];
  /** 当前任务消息在裁剪后上下文中的位置，旧检查点可以缺省。 */
  taskMessageIndex?: number;
  history: ConversationTurn[];
  turns: number;
  usage: TokenUsage;
  usageEstimated: boolean;
  parseAttempts: number;
  state: AgentState;
  summary: string;
  verified: boolean;
  remainingTokens?: number;
  elapsedMs: number;
  /** 未完成的原生调用按序恢复，已完成动作不会再次执行。 */
  pendingToolCalls?: LLMToolCall[];
  /** 动作已开始但结果尚未落盘，恢复时必须核对工作区，不能自动重放。 */
  executionUncertain?: AgentAction;
}

export interface AgentConfig {
  llm: {
    provider: 'openai' | 'anthropic' | 'gemini';
    model: string;
    maxTokens: number;
    temperature: number;
    /** 可选：自定义 API 端点。用于接入 OpenAI 兼容服务（如 DeepSeek：https://api.deepseek.com）。 */
    baseUrl?: string;
  };
  agent: {
    maxTurns: number;
    timeout: number;
    maxTotalTokens?: number;
  };
  execution?: {
    mode: 'local' | 'docker';
    image?: string;
    timeout?: number;
  };
  governance: {
    rulesFile: string;
    sandbox: {
      allowedPaths: string[];
      allowedCommands: string[];
    };
  };
  memory: {
    storagePath: string;
    maxConversationTurns: number;
    maxContextTokens?: number;
    maxToolOutputChars?: number;
  };
}

export interface LLMResponse {
  content: string;
  toolCalls?: LLMToolCall[];
  usage?: TokenUsage;
}

export interface LLMProvider {
  name: string;
  complete: (messages: LLMMessage[], tools?: ToolDefinition[], options?: LLMCompletionOptions) => Promise<LLMResponse>;
  completeStream?: (messages: LLMMessage[], onToken: (token: string) => void, options?: LLMCompletionOptions) => Promise<LLMResponse>;
}

export type AgentState = 'idle' | 'running' | 'waiting_approval' | 'completed' | 'error' | 'stopped';

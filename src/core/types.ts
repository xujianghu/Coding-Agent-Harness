export interface AgentAction {
  type: 'read_file' | 'write_file' | 'delete_file' | 'shell_exec' | 'run_test' | 'run_lint';
  params: Record<string, string>;
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
  role: 'user' | 'assistant' | 'system' | 'feedback';
  content: string;
  timestamp: number;
  action?: AgentAction;
  result?: ActionResult;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required: boolean }>;
  execute: (params: Record<string, string>) => Promise<ActionResult>;
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
  };
}

export interface LLMResponse {
  content: string;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, string>;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMProvider {
  name: string;
  complete: (messages: Array<{ role: string; content: string }>, tools?: ToolDefinition[]) => Promise<LLMResponse>;
  completeStream?: (messages: Array<{ role: string; content: string }>, onToken: (token: string) => void) => Promise<LLMResponse>;
}

export type AgentState = 'idle' | 'running' | 'waiting_approval' | 'completed' | 'error' | 'stopped';
import type { AgentAction, AgentConfig, TokenUsage } from '../core/types';

export type WebRunStatus = 'planned' | 'running' | 'awaiting_approval' | 'completed' | 'error' | 'cancelled' | 'stopped';
export interface WebEvent { sequence: number; timestamp: number; type: string; data: unknown }
export interface WebApproval { approvalId: string; action: AgentAction; reason: string; requestedAt: number }
export interface WebChange { path: string; before: string | null; after: string | null }
export interface WebRun {
  id: string; task: string; status: WebRunStatus; mock: boolean; workspace: string;
  verified: boolean; summary: string; stopReason: string; turns: number; usage: TokenUsage; usageEstimated: boolean;
  startedAt: number; finishedAt?: number; events: WebEvent[]; pendingApproval?: WebApproval; changes: WebChange[];
  verifier?: string; execution?: AgentConfig['execution']; resumable: boolean;
  source?: 'web' | 'cli'; provider?: AgentConfig['llm']['provider'] | 'mock' | 'unknown';
}
export interface WebRunInput { task: string; verify?: string; mock?: boolean; execution?: 'local' | 'docker' }
export interface WebWorkspace {
  workspace: string;
  config: { llm: Omit<AgentConfig['llm'], 'baseUrl'>; agent: AgentConfig['agent']; memory: AgentConfig['memory']; governance: { rulesCount: number; allowedPaths: string[]; allowedCommands: string[] } };
  tools: { name: string; description: string }[];
  execution: AgentConfig['execution'];
}
export interface WebEvaluationReport {
  id: string; createdAt: number; kind: string; modes: string[];
  summary: { attempts: number; passed: number; modelAttempts: number; mockAttempts: number; modelPassed: number; mockPassed: number };
  report: string;
}

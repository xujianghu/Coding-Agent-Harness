import type { AgentConfig, TokenUsage } from '../core/types';

export type EvaluationMode = 'full' | 'baseline' | 'no-feedback';

export interface EvaluationTask {
  id: string;
  title: string;
  tags: string[];
  prompt: string;
  fixture: string;
  acceptance: string;
  mockSolution: string;
  allowedChanges: string[];
  publicTestCommand: string;
}

export interface EvaluationManifest {
  version: 1;
  description: string;
  tasks: EvaluationTask[];
}

export interface LoadedManifest {
  data: EvaluationManifest;
  root: string;
  hash: string;
}

export interface GradeResult {
  passed: boolean;
  violations: string[];
  output: string;
  error?: string;
  exitCode?: number;
}

export interface EvaluationRecord {
  schemaVersion: 1;
  runId: string;
  taskId: string;
  mode: EvaluationMode;
  repetition: number;
  startedAt: string;
  kind: 'model-evaluation' | 'mock-mechanism-check';
  success: boolean;
  state: string;
  stopReason: string;
  error?: string;
  turns: number;
  toolCalls: number;
  elapsedMs: number;
  usageEstimated: boolean;
  usageUnavailable: boolean;
  realUsage: TokenUsage | null;
  estimatedUsage: TokenUsage | null;
  cost: null;
  grade: GradeResult;
  manifestHash: string;
  harnessCommit: string | null;
  harnessDirty: boolean;
  harnessSourceHash: string;
  model: AgentConfig['llm'];
  budget: AgentConfig['agent'];
  execution: { mode: 'local' | 'docker'; image?: string };
  artifacts: { diff: string; trace: string; candidate: string };
}

export interface EvaluationOptions {
  manifestPath: string;
  outputDir: string;
  config: AgentConfig;
  modes: EvaluationMode[];
  repetitions: number;
  mock: boolean;
  taskIds?: string[];
  credentialPath?: string;
  signal?: AbortSignal;
}

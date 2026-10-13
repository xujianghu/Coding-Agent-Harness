import { AgentAction, PipelineResult } from '../core/types';
import { GuardrailEngine } from './guardrail';
import { HITLStateMachine } from './hitl';
import { Sandbox } from './sandbox';

export interface GovernancePipeline {
  process(action: AgentAction, approvalGranted?: boolean): PipelineResult;
}

export function createGovernancePipeline(
  guardrail: GuardrailEngine,
  hitl: HITLStateMachine,
  sandbox: Sandbox
): GovernancePipeline {
  return {
    process(action: AgentAction, approvalGranted = false): PipelineResult {
      const stages: string[] = [];
      if (!action || typeof action.params !== 'object' || action.params === null) {
        return { allowed: false, reason: 'Invalid action parameters', pipelineStages: ['precheck'] };
      }
      let requiresApproval = false;
      let approvalReason: string | undefined;
      if (['shell_exec', 'run_test', 'run_lint'].includes(action.type)) {
        stages.push('guardrail');
        const policy = guardrail.evaluate(action);
        // 人工审批不能解除硬性拦截；先检查所有硬边界，再提出审批。
        if (!policy.allowed && !policy.requiresApproval) {
          return { allowed: false, reason: policy.reason, pipelineStages: stages };
        }
        stages.push('sandbox');
        const boundary = sandbox.checkCommand(action.params.command);
        if (!boundary.allowed) return { allowed: false, reason: boundary.reason, pipelineStages: stages };
        requiresApproval = Boolean(policy.requiresApproval);
        approvalReason = policy.reason;
      } else if (['read_file', 'write_file', 'delete_file', 'search_files', 'search_code', 'read_file_lines', 'apply_patch'].includes(action.type)) {
        stages.push('sandbox');
        const defaultSearchPath = ['search_files', 'search_code'].includes(action.type) ? '.' : undefined;
        const boundary = sandbox.checkPath(action.params.path ?? defaultSearchPath as string);
        if (!boundary.allowed) return { allowed: false, reason: boundary.reason, pipelineStages: stages };
        stages.push('guardrail');
        const policy = guardrail.evaluate({ ...action, params: { ...action.params, path: boundary.normalizedPath ?? action.params.path ?? '.' } });
        if (!policy.allowed && !policy.requiresApproval) return { allowed: false, reason: policy.reason, pipelineStages: stages };
        requiresApproval = Boolean(policy.requiresApproval) || action.type === 'delete_file';
        approvalReason = policy.reason ?? (requiresApproval ? `About to delete file: ${action.params.path}` : undefined);
      } else {
        return { allowed: false, reason: `Unknown action: ${action.type}`, pipelineStages: ['precheck'] };
      }
      if (requiresApproval && !approvalGranted) {
        hitl.requestApproval(action);
        return { allowed: false, requiresApproval: true, reason: approvalReason, pipelineStages: [...stages, 'hitl'] };
      }
      return { allowed: true, pipelineStages: [...stages, ...(requiresApproval ? ['hitl'] : []), 'audit'] };
    },
  };
}

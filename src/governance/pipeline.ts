import { AgentAction, GuardrailResult, PipelineResult } from '../core/types';
import { GuardrailEngine } from './guardrail';
import { HITLStateMachine } from './hitl';
import { Sandbox } from './sandbox';

export interface GovernancePipeline {
  process(action: AgentAction): PipelineResult;
}

export function createGovernancePipeline(
  guardrail: GuardrailEngine,
  hitl: HITLStateMachine,
  sandbox: Sandbox
): GovernancePipeline {
  return {
    process(action: AgentAction): PipelineResult {
      switch (action.type) {
        case 'shell_exec': {
          const guardrailResult = guardrail.evaluate(action);
          if (!guardrailResult.allowed) {
            return {
              allowed: false,
              reason: guardrailResult.reason,
              requiresApproval: guardrailResult.requiresApproval,
              pipelineStages: ['guardrail'],
            };
          }

          const sandboxResult = sandbox.checkCommand(action.params.command);
          if (!sandboxResult.allowed) {
            return {
              allowed: false,
              reason: sandboxResult.reason,
              pipelineStages: ['guardrail', 'sandbox'],
            };
          }

          if (guardrailResult.requiresApproval) {
            hitl.requestApproval(action);
            return {
              allowed: false,
              requiresApproval: true,
              pipelineStages: ['guardrail', 'sandbox', 'hitl'],
            };
          }

          return {
            allowed: true,
            pipelineStages: ['guardrail', 'sandbox', 'audit'],
          };
        }

        case 'write_file':
        case 'read_file': {
          const sandboxResult = sandbox.checkPath(action.params.path);
          if (!sandboxResult.allowed) {
            return {
              allowed: false,
              reason: sandboxResult.reason,
              pipelineStages: ['sandbox'],
            };
          }
          return {
            allowed: true,
            pipelineStages: ['sandbox', 'audit'],
          };
        }

        case 'delete_file': {
          const sandboxResult = sandbox.checkPath(action.params.path);
          if (!sandboxResult.allowed) {
            return {
              allowed: false,
              reason: sandboxResult.reason,
              pipelineStages: ['sandbox'],
            };
          }
          // 删除是不可逆操作，参考 Claude Code 默认询问用户确认。
          return {
            allowed: false,
            requiresApproval: true,
            reason: `About to delete file: ${action.params.path}`,
            pipelineStages: ['sandbox', 'hitl'],
          };
        }

        case 'run_test':
        case 'run_lint': {
          const sandboxResult = sandbox.checkCommand(action.params.command);
          if (!sandboxResult.allowed) {
            return {
              allowed: false,
              reason: sandboxResult.reason,
              pipelineStages: ['sandbox'],
            };
          }
          return {
            allowed: true,
            pipelineStages: ['sandbox', 'audit'],
          };
        }

        default:
          return { allowed: true, pipelineStages: ['precheck'] };
      }
    },
  };
}
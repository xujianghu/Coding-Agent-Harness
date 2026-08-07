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
      if (action.type !== 'shell_exec') {
        return { allowed: true, pipelineStages: ['precheck'] };
      }

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
        pipelineStages: ['guardrail', 'sandbox'],
      };
    },
  };
}
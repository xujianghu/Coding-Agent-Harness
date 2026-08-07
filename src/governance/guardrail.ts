import { GuardrailRule } from './rules';
import { AgentAction, GuardrailResult } from '../core/types';

export interface GuardrailEngine {
  evaluate(action: AgentAction): GuardrailResult;
  addRule(rule: GuardrailRule): void;
  getRules(): GuardrailRule[];
}

export function createGuardrailEngine(rules: GuardrailRule[]): GuardrailEngine {
  const ruleList: GuardrailRule[] = [...rules];

  return {
    evaluate(action: AgentAction): GuardrailResult {
      if (action.type !== 'shell_exec') {
        return { allowed: true };
      }

      const command = action.params.command;
      if (!command) {
        return { allowed: true };
      }

      for (const rule of ruleList) {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(command)) {
          if (rule.action === 'block') {
            return {
              allowed: false,
              reason: `Blocked by rule "${rule.name}": ${command}`,
              severity: rule.severity,
            };
          }
          return {
            allowed: false,
            requiresApproval: true,
            reason: `Requires approval by rule "${rule.name}": ${command}`,
            severity: rule.severity,
          };
        }
      }

      return { allowed: true };
    },

    addRule(rule: GuardrailRule): void {
      ruleList.push(rule);
    },

    getRules(): GuardrailRule[] {
      return [...ruleList];
    },
  };
}
import { GuardrailRule } from './rules';
import { AgentAction, GuardrailResult } from '../core/types';

export interface GuardrailEngine {
  evaluate(action: AgentAction): GuardrailResult;
  addRule(rule: GuardrailRule): void;
  getRules(): GuardrailRule[];
  replaceRules(rules: GuardrailRule[]): void;
}

export function createGuardrailEngine(rules: GuardrailRule[]): GuardrailEngine {
  const ruleList: GuardrailRule[] = [...rules];

  return {
    evaluate(action: AgentAction): GuardrailResult {
      const isCommand = ['shell_exec', 'run_test', 'run_lint'].includes(action.type);
      const isFile = ['read_file', 'write_file', 'delete_file', 'search_files', 'search_code', 'read_file_lines', 'apply_patch'].includes(action.type);
      if (!isCommand && !isFile) {
        return { allowed: true };
      }

      const rawSubject = isCommand ? action.params.command : action.params.path ?? '.';
      if (typeof rawSubject !== 'string' || !rawSubject.trim()) return { allowed: false, reason: 'Command or path is required' };
      const subject = isCommand ? rawSubject : rawSubject.replace(/\\/g, '/');

      let approval: GuardrailResult | undefined;
      for (const rule of ruleList) {
        // 未声明类型的历史规则仍只匹配命令；文件规则显式声明 type: file。
        if (isCommand ? rule.type && rule.type !== 'command' : rule.type !== 'file') continue;
        if (!rule.pattern) {
          // 跳过无 pattern 的规则（如 type: sandbox），避免 new RegExp(undefined) 变成空正则误匹配所有命令。
          continue;
        }
        let regex: RegExp;
        try {
          regex = new RegExp(rule.pattern, 'i');
        } catch {
          return { allowed: false, reason: `Invalid guardrail pattern: ${rule.name}` };
        }
        if (regex.test(subject)) {
          if (rule.action === 'block') {
            return {
              allowed: false,
              reason: `Blocked by rule "${rule.name}": ${subject}`,
              severity: rule.severity,
            };
          }
          approval = {
            allowed: false,
            requiresApproval: true,
            reason: `Requires approval by rule "${rule.name}": ${subject}`,
            severity: rule.severity,
          };
        }
      }

      return approval ?? { allowed: true };
    },

    addRule(rule: GuardrailRule): void {
      ruleList.push(rule);
    },

    getRules(): GuardrailRule[] {
      return [...ruleList];
    },

    replaceRules(rules: GuardrailRule[]): void {
      ruleList.length = 0;
      ruleList.push(...rules);
    },
  };
}

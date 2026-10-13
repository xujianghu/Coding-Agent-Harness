import { describe, it, expect } from 'vitest';
import { createGuardrailEngine } from '../../src/governance/guardrail';
import { GuardrailRule } from '../../src/governance/rules';
import { AgentAction } from '../../src/core/types';

describe('GuardrailEngine', () => {
  const rules: GuardrailRule[] = [
    {
      name: 'block-rm-rf',
      pattern: 'rm\\s+-rf\\s+/',
      severity: 'critical',
      action: 'block',
    },
    {
      name: 'block-force-push',
      pattern: 'git\\s+push\\s+--force',
      severity: 'high',
      action: 'block',
    },
    {
      name: 'approve-sudo',
      pattern: 'sudo',
      severity: 'high',
      action: 'approve',
    },
  ];

  it('应跳过无 pattern 的规则，避免空正则误匹配所有命令', () => {
    const sandboxRule = {
      name: '沙箱路径限制',
      type: 'sandbox',
      severity: 'high',
      action: 'block',
    } as unknown as GuardrailRule;

    const engine = createGuardrailEngine([sandboxRule]);
    const result = engine.evaluate({ type: 'shell_exec', params: { command: 'ls -la' } });

    expect(result.allowed).toBe(true);
  });

  it('should block rm -rf / command', () => {
    const engine = createGuardrailEngine(rules);
    const action: AgentAction = {
      type: 'shell_exec',
      params: { command: 'rm -rf /' },
    };
    const result = engine.evaluate(action);
    expect(result.allowed).toBe(false);
    expect(result.severity).toBe('critical');
    expect(result.requiresApproval).toBeUndefined();
  });

  it('should block git push --force', () => {
    const engine = createGuardrailEngine(rules);
    const action: AgentAction = {
      type: 'shell_exec',
      params: { command: 'git push --force origin main' },
    };
    const result = engine.evaluate(action);
    expect(result.allowed).toBe(false);
    expect(result.severity).toBe('high');
  });

  it('should require approval for sudo commands', () => {
    const engine = createGuardrailEngine(rules);
    const action: AgentAction = {
      type: 'shell_exec',
      params: { command: 'sudo apt-get install nginx' },
    };
    const result = engine.evaluate(action);
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.severity).toBe('high');
  });

  it('should allow safe commands like npm test', () => {
    const engine = createGuardrailEngine(rules);
    const action: AgentAction = {
      type: 'shell_exec',
      params: { command: 'npm test' },
    };
    const result = engine.evaluate(action);
    expect(result.allowed).toBe(true);
  });

  it('should allow non-shell_exec actions', () => {
    const engine = createGuardrailEngine(rules);
    const action: AgentAction = {
      type: 'read_file',
      params: { path: 'src/index.ts' },
    };
    const result = engine.evaluate(action);
    expect(result.allowed).toBe(true);
  });

  it.each(['run_test', 'run_lint'] as const)('%s 不能通过改换工具名绕过护栏', (type) => {
    const engine = createGuardrailEngine(rules);
    expect(engine.evaluate({ type, params: { command: 'git push --force' } }).allowed).toBe(false);
    expect(engine.evaluate({ type, params: { command: 'sudo npm test' } }).requiresApproval).toBe(true);
  });

  it('审批规则先匹配时仍继续检查后续硬拦截', () => {
    const engine = createGuardrailEngine([
      { name: 'approve-all', pattern: 'git', action: 'approve', severity: 'low' },
      { name: 'block-force', pattern: '--force', action: 'block', severity: 'critical' },
    ]);
    const result = engine.evaluate({ type: 'run_test', params: { command: 'git push --force' } });
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).not.toBe(true);
  });

  it('非法规则表达式按拒绝执行处理', () => {
    const engine = createGuardrailEngine([{ name: 'bad', pattern: '[', action: 'block', severity: 'high' }]);
    expect(engine.evaluate({ type: 'shell_exec', params: { command: 'npm test' } }).allowed).toBe(false);
  });
});

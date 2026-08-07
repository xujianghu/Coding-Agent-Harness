import { describe, it, expect } from 'vitest';
import { createGovernancePipeline } from '../../src/governance/pipeline';
import { createGuardrailEngine } from '../../src/governance/guardrail';
import { createHITL } from '../../src/governance/hitl';
import { createSandbox } from '../../src/governance/sandbox';
import { GuardrailRule } from '../../src/governance/rules';
import { AgentAction } from '../../src/core/types';

describe('GovernancePipeline', () => {
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
  ];
  const allowedCommands = ['npm', 'node', 'git', 'ls', 'cat'];

  it('应该允许正常命令（如 npm test）通过所有层', () => {
    const guardrail = createGuardrailEngine(rules);
    const hitl = createHITL();
    const sandbox = createSandbox(['/workspace'], allowedCommands);
    const pipeline = createGovernancePipeline(guardrail, hitl, sandbox);

    const action: AgentAction = {
      type: 'shell_exec',
      params: { command: 'npm test' },
    };

    const result = pipeline.process(action);
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBeUndefined();
    expect(result.pipelineStages).toContain('guardrail');
    expect(result.pipelineStages).toContain('sandbox');
  });

  it('应该在护栏层拦截危险命令（如 rm -rf /）', () => {
    const guardrail = createGuardrailEngine(rules);
    const hitl = createHITL();
    const sandbox = createSandbox(['/workspace'], allowedCommands);
    const pipeline = createGovernancePipeline(guardrail, hitl, sandbox);

    const action: AgentAction = {
      type: 'shell_exec',
      params: { command: 'rm -rf /' },
    };

    const result = pipeline.process(action);
    expect(result.allowed).toBe(false);
    expect(result.pipelineStages).toContain('guardrail');
    expect(result.pipelineStages).not.toContain('sandbox');
  });

  it('非 shell 动作（如 read_file）仅预检即放行', () => {
    const guardrail = createGuardrailEngine(rules);
    const hitl = createHITL();
    const sandbox = createSandbox(['/workspace'], allowedCommands);
    const pipeline = createGovernancePipeline(guardrail, hitl, sandbox);

    const action: AgentAction = {
      type: 'read_file',
      params: { path: 'src/index.ts' },
    };

    const result = pipeline.process(action);
    expect(result.allowed).toBe(true);
    expect(result.pipelineStages).toEqual(['precheck']);
    expect(result.requiresApproval).toBeUndefined();
  });
});
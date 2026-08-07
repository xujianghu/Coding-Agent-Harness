import { describe, it, expect } from 'vitest';
import { createGovernancePipeline } from '../../src/governance/pipeline';
import { createGuardrailEngine } from '../../src/governance/guardrail';
import { createHITL } from '../../src/governance/hitl';
import { createSandbox } from '../../src/governance/sandbox';
import { GuardrailRule } from '../../src/governance/rules';
import { AgentAction } from '../../src/core/types';

describe('GovernancePipeline', () => {
  const workspacePath = process.cwd();
  const rules: GuardrailRule[] = [
    { name: 'block-rm-rf', pattern: 'rm\\s+-rf\\s+/', severity: 'critical', action: 'block' },
    { name: 'block-force-push', pattern: 'git\\s+push\\s+--force', severity: 'high', action: 'block' },
  ];
  const allowedCommands = ['npm', 'node', 'git', 'ls', 'cat'];
  const allowedPaths = [workspacePath];

  it('shell_exec 危险命令（rm -rf /）→ 被护栏拦截，allowed=false', () => {
    const guardrail = createGuardrailEngine(rules);
    const hitl = createHITL();
    const sandbox = createSandbox(allowedPaths, allowedCommands);
    const pipeline = createGovernancePipeline(guardrail, hitl, sandbox);

    const action: AgentAction = { type: 'shell_exec', params: { command: 'rm -rf /' } };
    const result = pipeline.process(action);
    expect(result.allowed).toBe(false);
    expect(result.pipelineStages).toContain('guardrail');
    expect(result.pipelineStages).not.toContain('sandbox');
  });

  it('shell_exec 安全命令（npm test）→ 通过所有层，allowed=true', () => {
    const guardrail = createGuardrailEngine(rules);
    const hitl = createHITL();
    const sandbox = createSandbox(allowedPaths, allowedCommands);
    const pipeline = createGovernancePipeline(guardrail, hitl, sandbox);

    const action: AgentAction = { type: 'shell_exec', params: { command: 'npm test' } };
    const result = pipeline.process(action);
    expect(result.allowed).toBe(true);
    expect(result.pipelineStages).toContain('guardrail');
    expect(result.pipelineStages).toContain('sandbox');
    expect(result.pipelineStages).toContain('audit');
  });

  it('write_file 安全路径（./src/test.ts）→ 通过沙箱，allowed=true', () => {
    const guardrail = createGuardrailEngine(rules);
    const hitl = createHITL();
    const sandbox = createSandbox(allowedPaths, allowedCommands);
    const pipeline = createGovernancePipeline(guardrail, hitl, sandbox);

    const action: AgentAction = { type: 'write_file', params: { path: './src/test.ts' } };
    const result = pipeline.process(action);
    expect(result.allowed).toBe(true);
    expect(result.pipelineStages).toContain('sandbox');
    expect(result.pipelineStages).toContain('audit');
  });

  it('write_file 越界路径（/etc/passwd）→ 被沙箱拦截，allowed=false', () => {
    const guardrail = createGuardrailEngine(rules);
    const hitl = createHITL();
    const sandbox = createSandbox(allowedPaths, allowedCommands);
    const pipeline = createGovernancePipeline(guardrail, hitl, sandbox);

    const action: AgentAction = { type: 'write_file', params: { path: '/etc/passwd' } };
    const result = pipeline.process(action);
    expect(result.allowed).toBe(false);
    expect(result.pipelineStages).toContain('sandbox');
  });

  it('read_file 越界路径 → 被沙箱拦截', () => {
    const guardrail = createGuardrailEngine(rules);
    const hitl = createHITL();
    const sandbox = createSandbox(allowedPaths, allowedCommands);
    const pipeline = createGovernancePipeline(guardrail, hitl, sandbox);

    const action: AgentAction = { type: 'read_file', params: { path: '/etc/shadow' } };
    const result = pipeline.process(action);
    expect(result.allowed).toBe(false);
    expect(result.pipelineStages).toContain('sandbox');
  });

  it('run_test 白名单命令（npm test）→ allowed=true', () => {
    const guardrail = createGuardrailEngine(rules);
    const hitl = createHITL();
    const sandbox = createSandbox(allowedPaths, allowedCommands);
    const pipeline = createGovernancePipeline(guardrail, hitl, sandbox);

    const action: AgentAction = { type: 'run_test', params: { command: 'npm test' } };
    const result = pipeline.process(action);
    expect(result.allowed).toBe(true);
    expect(result.pipelineStages).toContain('sandbox');
    expect(result.pipelineStages).toContain('audit');
  });

  it('run_test 非白名单命令（rm -rf /）→ 被沙箱拦截', () => {
    const guardrail = createGuardrailEngine(rules);
    const hitl = createHITL();
    const sandbox = createSandbox(allowedPaths, allowedCommands);
    const pipeline = createGovernancePipeline(guardrail, hitl, sandbox);

    const action: AgentAction = { type: 'run_test', params: { command: 'rm -rf /' } };
    const result = pipeline.process(action);
    expect(result.allowed).toBe(false);
    expect(result.pipelineStages).toContain('sandbox');
  });
});
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createGovernancePipeline } from '../../src/governance/pipeline';
import { createGuardrailEngine } from '../../src/governance/guardrail';
import { createHITL } from '../../src/governance/hitl';
import { createSandbox } from '../../src/governance/sandbox';
import type { AgentAction } from '../../src/core/types';
import type { GuardrailRule } from '../../src/governance/rules';

let workspace: string;
beforeEach(() => { workspace = mkdtempSync(join(tmpdir(), 'harness-pipeline-')); });
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

const rules: GuardrailRule[] = [
  { name: 'approve-push', pattern: 'git\\s+push', severity: 'high', action: 'approve' },
  { name: 'block-force-push', pattern: 'git\\s+push\\s+--force', severity: 'critical', action: 'block' },
];

function setup(allowedCommands = ['npm', 'node', 'git']) {
  const guardrail = createGuardrailEngine(rules);
  const hitl = createHITL();
  const pipeline = createGovernancePipeline(guardrail, hitl, createSandbox(['.'], allowedCommands, workspace));
  return { pipeline, guardrail, hitl };
}

describe('GovernancePipeline', () => {
  it('文件路径别名和绝对路径匹配同一规范化策略', () => {
    const { pipeline, guardrail } = setup();
    guardrail.addRule({ name: 'protect-src', type: 'file', pattern: '^src/protected/', severity: 'high', action: 'block' });
    for (const path of ['src/protected/a.ts', './src/protected/a.ts', 'src/tmp/../protected/a.ts', join(workspace, 'src', 'protected', 'a.ts')]) {
      expect(pipeline.process({ type: 'write_file', params: { path, content: 'bad' } }, true).allowed).toBe(false);
    }
  });
  it('文件工具同样匹配文件策略，审批不能解除文件硬拦截', () => {
    const { pipeline, guardrail } = setup();
    guardrail.addRule({ name: 'approve-lock', type: 'file', pattern: 'package-lock', severity: 'medium', action: 'approve' });
    const action: AgentAction = { type: 'apply_patch', params: { path: 'package-lock.json', old_text: 'a', new_text: 'b' } };
    expect(pipeline.process(action).requiresApproval).toBe(true);
    expect(pipeline.process(action, true).allowed).toBe(true);
    guardrail.addRule({ name: 'block-lock', type: 'file', pattern: 'package-lock', severity: 'high', action: 'block' });
    expect(pipeline.process(action, true).allowed).toBe(false);
  });

  it('转义引号不能隐藏未授权的命令段', () => {
    const { pipeline } = setup(['node']);
    expect(pipeline.process({ type: 'shell_exec', params: { command: String.raw`node \"; echo BYPASS; node \"` } }).allowed).toBe(false);
  });
  it.each(['shell_exec', 'run_test', 'run_lint'] as const)('%s 使用完整护栏与命令边界，审批不能解除硬拦截', (type) => {
    const { pipeline } = setup();
    expect(pipeline.process({ type, params: { command: 'npm test' } }).allowed).toBe(true);
    expect(pipeline.process({ type, params: { command: 'git push --force' } }, true).allowed).toBe(false);
    const approval = pipeline.process({ type, params: { command: 'git push origin main' } });
    expect(approval.requiresApproval).toBe(true);
    expect(approval.pipelineStages).toEqual(['guardrail', 'sandbox', 'hitl']);
    expect(pipeline.process({ type, params: { command: 'git push origin main' } }, true).allowed).toBe(true);
    expect(pipeline.process({ type, params: { command: 'curl example.com' } }, true).allowed).toBe(false);
  });

  it('需要审批的命令不满足白名单时不能获得可解除的审批结果', () => {
    const { pipeline, hitl } = setup(['npm']);
    const result = pipeline.process({ type: 'run_test', params: { command: 'git push origin main' } });
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).not.toBe(true);
    expect(hitl.getState()).toBe('idle');
    expect(pipeline.process({ type: 'run_test', params: { command: 'git push origin main' } }, true).allowed).toBe(false);
  });

  it('批准后重检最新规则', () => {
    const { pipeline, guardrail } = setup();
    const action: AgentAction = { type: 'shell_exec', params: { command: 'git push origin main' } };
    expect(pipeline.process(action).requiresApproval).toBe(true);
    guardrail.addRule({ name: 'now-block', pattern: 'git push', severity: 'critical', action: 'block' });
    expect(pipeline.process(action, true).allowed).toBe(false);
  });

  it('删除审批后仍然检查路径，符号链接变化不能绕过', () => {
    const { pipeline } = setup();
    const action: AgentAction = { type: 'delete_file', params: { path: 'src/test.ts' } };
    expect(pipeline.process(action).requiresApproval).toBe(true);
    expect(pipeline.process(action, true).allowed).toBe(true);
    mkdirSync(join(workspace, '.harness'));
    symlinkSync(join(workspace, '.harness'), join(workspace, 'src'), 'junction');
    expect(pipeline.process(action, true).allowed).toBe(false);
  });

  it.each(['read_file', 'write_file', 'delete_file', 'search_files', 'search_code', 'read_file_lines', 'apply_patch'])('%s 遵循统一路径边界', (type) => {
    const { pipeline } = setup();
    expect(pipeline.process({ type, params: { path: '../outside/file' } } as AgentAction, true).allowed).toBe(false);
    expect(pipeline.process({ type, params: { path: '.env' } } as AgentAction, true).allowed).toBe(false);
    expect(pipeline.process({ type, params: { path: 'src/index.ts' } } as AgentAction, true).allowed).toBe(true);
  });

  it('搜索缺省路径是工作区，未知动作与缺省文件路径拒绝执行', () => {
    const { pipeline } = setup();
    expect(pipeline.process({ type: 'search_code', params: { query: 'hello' } } as AgentAction).allowed).toBe(true);
    expect(pipeline.process({ type: 'read_file', params: {} }).allowed).toBe(false);
    expect(pipeline.process({ type: 'unregistered', params: {} } as unknown as AgentAction).allowed).toBe(false);
  });
});

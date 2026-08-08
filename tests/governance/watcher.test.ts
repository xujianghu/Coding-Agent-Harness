import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createGuardrailEngine } from '../../src/governance/guardrail';
import { createGuardrailWatcher } from '../../src/governance/watcher';
import { GuardrailRule } from '../../src/governance/rules';
import { AgentAction } from '../../src/core/types';
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const initialRules: GuardrailRule[] = [
  {
    name: 'block-rm-rf',
    pattern: 'rm\\s+-rf\\s+/',
    severity: 'critical',
    action: 'block',
  },
  {
    name: 'approve-sudo',
    pattern: 'sudo',
    severity: 'high',
    action: 'approve',
  },
];

const updatedRulesYaml = `rules:
  - name: block-rm-rf
    pattern: "rm\\\\s+-rf\\\\s+/"
    severity: critical
    action: block
  - name: block-force-push
    pattern: "git\\\\s+push\\\\s+--force"
    severity: high
    action: block
`;

const invalidYaml = `rules:
  - name: broken
    pattern: "["
    severity: critical
    action: block
  - this is broken
`;

describe('createGuardrailWatcher', () => {
  let testDir: string;
  let rulesPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `guardrail-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    rulesPath = join(testDir, 'guardrails.yaml');
    writeFileSync(
      rulesPath,
      `rules:\n  - name: block-rm-rf\n    pattern: "rm\\\\s+-rf\\\\s+/"\n    severity: critical\n    action: block\n  - name: approve-sudo\n    pattern: "sudo"\n    severity: high\n    action: approve\n`,
      'utf-8',
    );
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should start and stop watcher', () => {
    const engine = createGuardrailEngine(initialRules);
    const watcher = createGuardrailWatcher(rulesPath, engine);
    watcher.start();
    expect(watcher).toHaveProperty('start');
    expect(watcher).toHaveProperty('stop');
    watcher.stop();
  });

  it('should reload rules when file changes', async () => {
    const engine = createGuardrailEngine(initialRules);
    const reloadedRules: GuardrailRule[][] = [];

    const watcher = createGuardrailWatcher(rulesPath, engine, (rules) => {
      reloadedRules.push(rules);
    });

    watcher.start();

    // 修改文件触发 reload
    writeFileSync(rulesPath, updatedRulesYaml, 'utf-8');
    await sleep(500);

    // 验证 reload 回调被调用
    expect(reloadedRules.length).toBeGreaterThanOrEqual(1);

    const lastRules = reloadedRules[reloadedRules.length - 1];
    expect(lastRules.length).toBe(2);
    expect(lastRules[1].name).toBe('block-force-push');

    watcher.stop();
  });

  it('should update engine rules after file change', async () => {
    const engine = createGuardrailEngine(initialRules);
    const watcher = createGuardrailWatcher(rulesPath, engine);

    watcher.start();

    // 修改文件
    writeFileSync(rulesPath, updatedRulesYaml, 'utf-8');
    await sleep(500);

    const rules = engine.getRules();
    expect(rules.length).toBe(2);
    expect(rules[1].name).toBe('block-force-push');

    // 新规则应该生效：block-force-push 应该拦截
    const action: AgentAction = {
      type: 'shell_exec',
      params: { command: 'git push --force origin main' },
    };
    const result = engine.evaluate(action);
    expect(result.allowed).toBe(false);

    watcher.stop();
  });

  it('should keep old rules when file contains invalid YAML', async () => {
    const engine = createGuardrailEngine(initialRules);
    const watcher = createGuardrailWatcher(rulesPath, engine);

    watcher.start();

    // 写入无效 YAML
    writeFileSync(rulesPath, invalidYaml, 'utf-8');
    await sleep(500);

    // 旧规则应该保持不变
    const rules = engine.getRules();
    expect(rules.length).toBe(2);

    watcher.stop();
  });

  it('should handle file not found gracefully', () => {
    const engine = createGuardrailEngine(initialRules);
    const watcher = createGuardrailWatcher(join(testDir, 'nonexistent.yaml'), engine);
    watcher.start();
    // 不应该抛出异常
    watcher.stop();
  });

  it('should call onReload callback with new rules', async () => {
    const engine = createGuardrailEngine(initialRules);
    const callbackResults: GuardrailRule[][] = [];

    const watcher = createGuardrailWatcher(rulesPath, engine, (rules) => {
      callbackResults.push(rules);
    });

    watcher.start();

    writeFileSync(rulesPath, updatedRulesYaml, 'utf-8');
    await sleep(500);

    expect(callbackResults.length).toBeGreaterThanOrEqual(1);
    const rules = callbackResults[callbackResults.length - 1];
    expect(rules).toHaveLength(2);
    expect(rules[1].name).toBe('block-force-push');

    watcher.stop();
  });
});
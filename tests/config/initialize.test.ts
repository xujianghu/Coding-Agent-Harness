import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { initializeWorkspace } from '../../src/config/initialize';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('CLI 共享初始化', () => {
  it('保留创建新工作区的行为，重复初始化不覆盖已有配置', () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-init-test-'));
    directories.push(root);
    const workspace = join(root, 'new', 'project');
    expect(existsSync(workspace)).toBe(false);
    expect(initializeWorkspace(workspace)).toEqual(['config.yaml', 'guardrails.yaml']);
    const configPath = join(workspace, '.harness', 'config.yaml');
    const rulesPath = join(workspace, '.harness', 'guardrails.yaml');
    const originalRules = readFileSync(rulesPath, 'utf8');
    writeFileSync(configPath, '# 用户自定义配置\nllm:\n  provider: openai\n  model: custom-model\n');
    expect(initializeWorkspace(workspace)).toEqual([]);
    expect(readFileSync(configPath, 'utf8')).toContain('custom-model');
    expect(readFileSync(rulesPath, 'utf8')).toBe(originalRules);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { assertSessionUnchanged, loadSession, saveSession, sessionConfigHash } from '../../src/cli/checkpoint';
import { AgentCheckpoint } from '../../src/core/types';
import { DefaultConfig } from '../../src/config/loader';

describe('持久化恢复边界', () => {
  let root: string;
  const checkpoint: AgentCheckpoint = { version: 1, task: '修复', messages: [{ role: 'user', content: '修复' }], history: [], turns: 2, usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 }, usageEstimated: false, parseAttempts: 0, state: 'stopped', summary: '', verified: false, elapsedMs: 100 };
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'harness-session-')); writeFileSync(join(root, 'code.js'), 'broken'); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  it('持久化后保留原任务、调用量和消息', () => {
    const hash = sessionConfigHash(DefaultConfig, []);
    saveSession(root, hash, checkpoint, 'run-1');
    const restored = loadSession(root, 'run-1');
    expect(restored.checkpoint).toEqual(checkpoint);
    expect(() => assertSessionUnchanged(restored, root, hash)).not.toThrow();
    expect(readFileSync(join(root, '.harness', 'sessions', 'run-1.json'), 'utf8')).not.toContain('apiKey');
  });
  it('用户修改文件后拒绝复用旧执行状态', () => {
    const session = saveSession(root, 'config', checkpoint, 'run-1');
    writeFileSync(join(root, 'code.js'), 'changed');
    expect(() => assertSessionUnchanged(session, root, 'config')).toThrow('工作区');
  });
  it('配置和规则变化后拒绝恢复', () => {
    const session = saveSession(root, 'old', checkpoint, 'run-1');
    expect(() => assertSessionUnchanged(session, root, 'new')).toThrow('配置');
  });
  it('拒绝会话 ID 路径穿越与已结束任务', () => {
    expect(() => saveSession(root, 'config', checkpoint, '../outside')).toThrow('会话 ID');
    const session = saveSession(root, 'config', { ...checkpoint, state: 'completed' }, 'finished');
    expect(() => assertSessionUnchanged(session, root, 'config')).toThrow('已结束');
  });
  it.each(['../outside', 'different'])('JSON 内部 ID 无法改变轨迹路径：%s', runId => {
    const session = saveSession(root, 'config', checkpoint, 'run-1');
    writeFileSync(join(root, '.harness', 'sessions', 'run-1.json'), JSON.stringify({ ...session, runId }));
    expect(() => loadSession(root, 'run-1')).toThrow('ID');
  });
  it.each([-1, null, '3', 0])('无效累计用量不能重置恢复预算：%j', totalTokens => {
    const session = saveSession(root, 'config', checkpoint, 'run-1');
    writeFileSync(join(root, '.harness', 'sessions', 'run-1.json'), JSON.stringify({ ...session, checkpoint: { ...checkpoint, usage: { ...checkpoint.usage, totalTokens } } }));
    expect(() => loadSession(root, 'run-1')).toThrow('用量');
  });
});

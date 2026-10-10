import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { get } from 'http';
import { startWebServer } from '../../src/web/server';
import type { WebRun } from '../../src/web/types';
import * as providerFactory from '../../src/llm/factory';
import { DefaultConfig } from '../../src/config/loader';
import { saveSession, sessionConfigHash } from '../../src/cli/checkpoint';
import { createRunTrace } from '../../src/cli/trace';
import type { AgentCheckpoint } from '../../src/core/types';

const resources: { workspace: string; server: Awaited<ReturnType<typeof startWebServer>> }[] = [];

afterEach(async () => {
  const cleanup = resources.splice(0);
  for (const resource of cleanup) await resource.server.close();
  for (const workspace of new Set(cleanup.map(resource => resource.workspace))) rmSync(workspace, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function setup() {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-web-test-'));
  const staticDir = join(workspace, 'ui');
  mkdirSync(staticDir);
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>工作台测试</title>');
  writeFileSync(join(staticDir, 'app.js'), 'console.log("工作台");');
  const server = await startWebServer({ workspace, port: 0, staticDir });
  resources.push({ workspace, server });
  return { workspace, server };
}

async function request(url: string, path: string, body?: unknown) {
  return fetch(url + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function waitRun(url: string, id: string, test: (run: WebRun) => boolean): Promise<WebRun> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const response = await request(url, '/api/runs/' + id);
    const run = await response.json() as WebRun;
    if (test(run)) return run;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('任务没有到达预期状态');
}

describe('本地工作台 HTTP 安全', () => {
  it('限制监听地址，并拒绝恶意 Host、跨站 Origin 和跨站 Fetch', async () => {
    const { workspace, server } = await setup();
    await expect(startWebServer({ workspace, host: '0.0.0.0', port: 0 })).rejects.toThrow('只能监听');
    const hostStatus = await new Promise<number | undefined>((resolveStatus, reject) => {
      const request = get(server.url + '/api/workspace', { headers: { Host: 'evil.example:4173' } }, response => {
        response.resume(); resolveStatus(response.statusCode);
      });
      request.once('error', reject);
    });
    expect(hostStatus).toBe(403);
    expect((await fetch(server.url + '/api/workspace', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await fetch(server.url + '/api/workspace', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    const response = await fetch(server.url + '/api/workspace', { headers: { origin: server.url } });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(JSON.stringify(await response.json())).not.toMatch(/apiKey|masterPassword|credentials/);
  });

  it('限制写请求格式、大小和参数，静态页面采用同源 CSP', async () => {
    const { server } = await setup();
    expect((await fetch(server.url + '/api/runs', { method: 'POST', body: '{}' })).status).toBe(415);
    expect((await request(server.url, '/api/runs', { task: 'x'.repeat(70000) })).status).toBe(413);
    expect((await request(server.url, '/api/runs', { task: 'test', workspace: '../' })).status).toBe(400);
    expect((await fetch(server.url + '/%2e%2e%5csecret.txt')).status).toBe(400);
    expect((await fetch(server.url + '/assets/missing.js')).status).toBe(404);
    const page = await fetch(server.url + '/runs/example');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('工作台测试');
  });
});

describe('工作台真实机制演示', () => {
  it('CLI mock 与来源未知会话保留来源，工作台禁止将其恢复为真实模型', async () => {
    const { workspace, server } = await setup();
    const checkpoint: AgentCheckpoint = { version: 1, task: 'CLI 历史任务', messages: [{ role: 'user', content: 'CLI 历史任务' }], history: [],
      turns: 1, usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 }, usageEstimated: true, parseAttempts: 0, state: 'stopped', summary: '', verified: false, elapsedMs: 100 };
    const hash = sessionConfigHash(DefaultConfig, []);
    for (const id of ['cli-mock', 'cli-unknown', 'cli-real']) saveSession(workspace, hash, checkpoint, id);
    createRunTrace(join(workspace, '.harness', 'runs', 'cli-mock.jsonl'), 'cli-mock').event('started', { provider: 'mock' });
    createRunTrace(join(workspace, '.harness', 'runs', 'cli-real.jsonl'), 'cli-real').event('started', { provider: 'openai' });
    const provider = vi.spyOn(providerFactory, 'createLLMProvider').mockRejectedValue(new Error('恢复不应初始化真实提供商'));
    const mock = await (await request(server.url, '/api/runs/cli-mock')).json() as WebRun;
    expect(mock).toMatchObject({ source: 'cli', provider: 'mock', mock: true, resumable: false });
    const unknown = await (await request(server.url, '/api/runs/cli-unknown')).json() as WebRun;
    expect(unknown).toMatchObject({ source: 'cli', provider: 'unknown', resumable: false });
    const real = await (await request(server.url, '/api/runs/cli-real')).json() as WebRun;
    expect(real).toMatchObject({ source: 'cli', provider: 'openai', mock: false, resumable: true });
    for (const id of ['cli-mock', 'cli-unknown']) {
      const response = await request(server.url, `/api/runs/${id}/resume`, {});
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('CLI_MODE_REQUIRED');
    }
    expect(provider).not.toHaveBeenCalled();
  });

  it.each(['web-runs', 'sessions'] as const)('%s 超过 100 条后按修改时间保留最新任务，不按文件名丢弃', async directory => {
    const { workspace, server } = await setup();
    mkdirSync(join(workspace, '.harness', directory), { recursive: true });
    const oldTime = new Date('2020-01-01T00:00:00Z');
    const latestTime = new Date('2030-01-01T00:00:00Z');
    const checkpoint: AgentCheckpoint = { version: 1, task: '历史任务', messages: [{ role: 'user', content: '历史任务' }], history: [], turns: 0,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, usageEstimated: false, parseAttempts: 0, state: 'error', summary: '', verified: false, elapsedMs: 0 };
    const ids = [...Array.from({ length: 100 }, (_, index) => 'zzz-old-' + String(index).padStart(3, '0')), 'aaa-newest'];
    for (const id of ids) {
      const latest = id === 'aaa-newest';
      if (directory === 'sessions') saveSession(workspace, 'hash', checkpoint, id);
      else writeFileSync(join(workspace, '.harness', directory, id + '.json'), JSON.stringify({ id, workspace, mock: false, source: 'web', provider: 'openai', task: id,
        status: 'error', verified: false, summary: '', stopReason: '初始化失败', turns: 0, usage: checkpoint.usage, usageEstimated: false,
        startedAt: latest ? latestTime.getTime() : oldTime.getTime(), events: [], changes: [], resumable: false }));
      const path = join(workspace, '.harness', directory, id + '.json');
      utimesSync(path, latest ? latestTime : oldTime, latest ? latestTime : oldTime);
    }
    const response = await request(server.url, '/api/runs/aaa-newest');
    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe('aaa-newest');
    const list = await (await request(server.url, '/api/runs')).json();
    expect(list.runs).toHaveLength(100);
    expect(list.runs.some((run: WebRun) => run.id === 'aaa-newest')).toBe(true);
  });

  it('提供商初始化失败且未产生检查点时，重启后仍保留失败历史与轨迹', async () => {
    const { workspace, server } = await setup();
    mkdirSync(join(workspace, '.harness'), { recursive: true });
    writeFileSync(join(workspace, '.harness', 'guardrails.yaml'), 'rules: []\n');
    const provider = vi.spyOn(providerFactory, 'createLLMProvider').mockRejectedValue(new Error('模拟提供商尚未配置密钥'));
    const created = await request(server.url, '/api/runs', { task: '初始化失败的任务', execution: 'local' });
    expect(created.status).toBe(201);
    const run = await created.json() as WebRun;
    const failed = await waitRun(server.url, run.id, item => item.status === 'error');
    expect(provider).toHaveBeenCalledOnce();
    expect(failed.resumable).toBe(false);
    expect(failed.turns).toBe(0);
    await server.close();
    const restarted = await startWebServer({ workspace, port: 0 });
    resources.push({ workspace, server: restarted });
    const listed = await (await request(restarted.url, '/api/runs')).json();
    expect(listed.runs.some((item: WebRun) => item.id === run.id && item.status === 'error')).toBe(true);
    const historyResponse = await request(restarted.url, '/api/runs/' + run.id);
    expect(historyResponse.status).toBe(200);
    const history = await historyResponse.json() as WebRun;
    expect(history.stopReason).toBe('模拟提供商尚未配置密钥');
    expect(history.resumable).toBe(false);
    expect(history.events.some(event => event.type === 'run_error')).toBe(true);
    const resumed = await request(restarted.url, `/api/runs/${run.id}/resume`, {});
    expect(resumed.status).toBe(409);
    expect((await resumed.json()).error.code).toBe('NO_CHECKPOINT');
  });

  it('真实写入和补丁，人工批准验收后完成，并可读取持久化历史', async () => {
    const { workspace, server } = await setup();
    const created = await request(server.url, '/api/runs', { task: '修复金额计算函数', mock: true });
    expect(created.status).toBe(201);
    const run = await created.json() as WebRun;
    const waiting = await waitRun(server.url, run.id, item => item.status === 'awaiting_approval');
    expect(waiting.pendingApproval?.action.type).toBe('run_test');
    expect(waiting.usageEstimated).toBe(true);
    expect(waiting.changes).toContainEqual({ path: 'amount.js', before: null, after: 'module.exports = (price, quantity) => price * quantity;\n' });
    expect(readFileSync(join(waiting.workspace, 'amount.js'), 'utf8')).toContain('price * quantity');
    expect(waiting.workspace).not.toBe(workspace);
    expect((await request(server.url, '/api/runs', { task: 'second', mock: true })).status).toBe(409);
    expect((await request(server.url, `/api/runs/${run.id}/approve`, { approvalId: 'stale', approved: true })).status).toBe(409);
    expect((await request(server.url, `/api/runs/${run.id}/approve`, { approvalId: waiting.pendingApproval!.approvalId, approved: true })).status).toBe(200);
    const completed = await waitRun(server.url, run.id, item => item.status === 'completed');
    expect(completed.verified).toBe(true);
    expect(completed.events.some(event => event.type === 'verification')).toBe(true);
    await server.close();
    const restarted = await startWebServer({ workspace, port: 0 });
    resources.push({ workspace, server: restarted });
    const history = await (await request(restarted.url, '/api/runs/' + run.id)).json() as WebRun;
    expect(history.verified).toBe(true);
    expect(history.events.at(-1)?.type).toBe('finished');
    expect(history.events.map(event => event.sequence)).toEqual(completed.events.map(event => event.sequence));
    expect((await request(restarted.url, `/api/runs/${run.id}/resume`, {})).status).toBe(409);
  });

  it('取消审批后安全恢复，拒绝工作区已发生变化的恢复', async () => {
    const { server } = await setup();
    const run = await (await request(server.url, '/api/runs', { task: '修复金额', mock: true })).json() as WebRun;
    await waitRun(server.url, run.id, item => item.status === 'awaiting_approval');
    const cancelledResponse = await request(server.url, `/api/runs/${run.id}/cancel`, {});
    const cancelled = await cancelledResponse.json() as WebRun;
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.resumable).toBe(true);
    expect(cancelled.pendingApproval).toBeUndefined();
    expect((await request(server.url, `/api/runs/${run.id}/resume`, {})).status).toBe(202);
    const waiting = await waitRun(server.url, run.id, item => item.status === 'awaiting_approval');
    expect(waiting.changes.filter(change => change.path === 'amount.js')).toHaveLength(1);
    await request(server.url, `/api/runs/${run.id}/cancel`, {});
    writeFileSync(join(waiting.workspace, 'amount.js'), 'module.exports = () => 0;\n');
    const unsafe = await request(server.url, `/api/runs/${run.id}/resume`, {});
    expect(unsafe.status).toBe(409);
    expect((await unsafe.json()).error.message).toContain('工作区');
  });

  it('关闭服务会取消等待中的审批，保留可恢复会话', async () => {
    const { workspace, server } = await setup();
    const run = await (await request(server.url, '/api/runs', { task: '修复金额', mock: true })).json() as WebRun;
    await waitRun(server.url, run.id, item => item.status === 'awaiting_approval');
    await server.close();
    const restarted = await startWebServer({ workspace, port: 0 });
    resources.push({ workspace, server: restarted });
    const history = await (await request(restarted.url, '/api/runs/' + run.id)).json() as WebRun;
    expect(history.status).toBe('cancelled');
    expect(history.resumable).toBe(true);
  });
});

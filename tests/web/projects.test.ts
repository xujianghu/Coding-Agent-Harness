import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, linkSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { request as httpRequest } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import { startWebServer } from '../../src/web/server';
import type { WebProject, WebWorkspace } from '../../src/web/types';
import * as providerFactory from '../../src/llm/factory';

const resources: { root: string; server: Awaited<ReturnType<typeof startWebServer>> }[] = [];
afterEach(async () => {
  const cleanup = resources.splice(0);
  for (const resource of cleanup) await resource.server.close();
  for (const root of new Set(cleanup.map(resource => resource.root))) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'harness-project-test-'));
  const first = join(root, 'first'); const second = join(root, 'second');
  mkdirSync(first); mkdirSync(second);
  writeFileSync(join(first, 'first.java'), 'class First {}\n');
  writeFileSync(join(second, 'second.java'), 'class Second {}\n');
  const server = await startWebServer({ workspace: first, port: 0 });
  resources.push({ root, server });
  const workspace = await (await fetch(server.url + '/api/workspace')).json() as WebWorkspace;
  return { root, first, second, server, projectId: workspace.projectId! };
}
const api = (url: string, route: string, projectId?: string, body?: unknown) => fetch(url + route, {
  ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}),
  headers: { ...(projectId ? { 'X-Harness-Project': projectId } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
});

describe('本地项目选择', () => {
  it('未初始化项目可以打开、列目录与读取源码，选择不会写入目标或调用模型', async () => {
    const { root, second, server, projectId } = await setup();
    const provider = vi.spyOn(providerFactory, 'createLLMProvider');
    const response = await api(server.url, '/api/projects/open', projectId, { path: second });
    expect(response.status).toBe(200);
    const opened = await response.json() as { project: WebProject; workspace: WebWorkspace };
    expect(opened.project).toMatchObject({ name: 'second', path: second, initialized: false });
    expect(opened.workspace).toMatchObject({ projectId: opened.project.id, initialized: false, workspace: second });
    const directory = await (await api(server.url, '/api/files', opened.project.id)).json();
    expect(directory.entries).toContainEqual(expect.objectContaining({ name: 'second.java' }));
    expect(await (await api(server.url, '/api/file?path=second.java', opened.project.id)).json()).toMatchObject({ content: 'class Second {}\n' });
    expect(existsSync(join(second, '.harness'))).toBe(false);
    const folders = await (await api(server.url, '/api/projects/directories?path=' + encodeURIComponent(root), opened.project.id)).json();
    expect(folders.entries.map((entry: { name: string }) => entry.name)).toEqual(['first', 'second']);
    expect(provider).not.toHaveBeenCalled();
  });

  it('显式初始化仅创建缺失配置，重复操作保护已有配置与凭据', async () => {
    const { second, server, projectId } = await setup();
    const opened = await (await api(server.url, '/api/projects/open', projectId, { path: second, initialize: true })).json();
    expect(opened.workspace.initialized).toBe(true);
    const config = readFileSync(join(second, '.harness', 'config.yaml'), 'utf8');
    mkdirSync(join(second, '.harness', 'credentials'));
    writeFileSync(join(second, '.harness', 'credentials', 'preserved'), 'existing credential');
    expect((await api(server.url, '/api/projects/open', opened.project.id, { path: second, initialize: true })).status).toBe(200);
    expect(readFileSync(join(second, '.harness', 'config.yaml'), 'utf8')).toBe(config);
    expect(readFileSync(join(second, '.harness', 'credentials', 'preserved'), 'utf8')).toBe('existing credential');
  });

  it('拒绝相对、缺失、文件、敏感和链接目录，失败保留当前项目', async () => {
    const { root, first, second, server, projectId } = await setup();
    mkdirSync(join(second, '.ssh'));
    const linked = join(root, 'linked'); symlinkSync(second, linked, process.platform === 'win32' ? 'junction' : 'dir');
    for (const path of ['relative', join(root, 'missing'), join(first, 'first.java'), join(second, '.ssh'), linked]) {
      expect((await api(server.url, '/api/projects/open', projectId, { path })).status).toBeGreaterThanOrEqual(400);
    }
    expect((await api(server.url, '/api/projects/open', projectId, { path: second, extra: true })).status).toBe(400);
    expect(await (await fetch(server.url + '/api/workspace')).json()).toMatchObject({ workspace: first, projectId });
  });

  it('活跃任务包括启动占位和等待审批时拒绝切换', async () => {
    const { second, server, projectId } = await setup();
    const run = await (await api(server.url, '/api/runs', projectId, { task: '项目切换审批测试', mock: true })).json();
    expect((await api(server.url, '/api/projects/open', projectId, { path: second })).status).toBe(409);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const current = await (await api(server.url, '/api/runs/' + run.id, projectId)).json();
      if (current.status === 'awaiting_approval') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const response = await api(server.url, '/api/projects/open', projectId, { path: second });
    expect((await response.json()).error.code).toBe('RUN_ACTIVE');
    expect((await api(server.url, '/api/runs/' + run.id + '/cancel', projectId, {})).status).toBe(200);
    expect((await api(server.url, '/api/projects/open', projectId, { path: second })).status).toBe(200);
  });

  it('切换后拒绝旧标签页、缺失项目与读取请求，历史随项目返回', async () => {
    const { first, second, server, projectId } = await setup();
    const conversation = await (await api(server.url, '/api/conversations', projectId, {})).json();
    const opened = await (await api(server.url, '/api/projects/open', projectId, { path: second })).json();
    expect((await api(server.url, '/api/conversations', projectId, {})).status).toBe(409);
    expect((await api(server.url, '/api/conversations', undefined, {})).status).toBe(409);
    expect((await api(server.url, '/api/files', projectId)).status).toBe(409);
    expect((await api(server.url, '/api/conversations', opened.project.id)).status).toBe(200);
    expect(await (await api(server.url, '/api/conversations', opened.project.id)).json()).toEqual({ conversations: [] });
    await api(server.url, '/api/projects/open', opened.project.id, { path: first });
    expect(await (await api(server.url, '/api/conversations', projectId)).json()).toMatchObject({ conversations: [expect.objectContaining({ id: conversation.id })] });
  });

  it('请求体读取期间发生切换时重新校验项目，不把旧 POST 写到新项目', async () => {
    const { second, server, projectId } = await setup();
    const body = JSON.stringify({ title: '旧项目延迟请求' });
    let finishBody!: () => void;
    const delayed = new Promise<number | undefined>((resolveStatus, reject) => {
      const request = httpRequest(server.url + '/api/conversations', { method: 'POST', headers: {
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'X-Harness-Project': projectId,
      } }, response => { response.resume(); resolveStatus(response.statusCode); });
      request.on('error', reject); request.write(body.slice(0, 5)); finishBody = () => request.end(body.slice(5));
    });
    await new Promise(resolve => setTimeout(resolve, 30));
    const opened = await (await api(server.url, '/api/projects/open', projectId, { path: second })).json();
    finishBody();
    expect(await delayed).toBe(409);
    expect(await (await api(server.url, '/api/conversations', opened.project.id)).json()).toEqual({ conversations: [] });
  });

  it('recent 持久化到启动工作区，重启仍尊重启动参数，跨站限制保持', async () => {
    const { root, first, second, server, projectId } = await setup();
    await api(server.url, '/api/projects/open', projectId, { path: second });
    await server.close();
    const restarted = await startWebServer({ workspace: first, port: 0 }); resources.push({ root, server: restarted });
    const projects = await (await fetch(restarted.url + '/api/projects')).json();
    expect(projects.activeProjectId).toBe(projectId);
    expect(projects.projects.map((project: WebProject) => project.path)).toContain(second);
    expect((await fetch(restarted.url + '/api/projects/open', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ path: second }) })).status).toBe(403);
  });

  it('初始化拒绝 .harness 目录链接和配置硬链接，保留原项目与链接目标', async () => {
    const { root, first, second, server, projectId } = await setup();
    const outside = join(root, 'outside'); mkdirSync(outside);
    writeFileSync(join(outside, 'config.yaml'), 'llm:\n  model: preserved\n');
    const marker = readFileSync(join(outside, 'config.yaml'), 'utf8');
    symlinkSync(outside, join(second, '.harness'), process.platform === 'win32' ? 'junction' : 'dir');
    expect((await api(server.url, '/api/projects/open', projectId, { path: second, initialize: true })).status).toBe(409);
    rmSync(join(second, '.harness'), { recursive: true }); mkdirSync(join(second, '.harness'));
    linkSync(join(outside, 'config.yaml'), join(second, '.harness', 'config.yaml'));
    expect((await api(server.url, '/api/projects/open', projectId, { path: second, initialize: true })).status).toBe(409);
    expect(readFileSync(join(outside, 'config.yaml'), 'utf8')).toBe(marker);
    expect(existsSync(join(outside, 'guardrails.yaml'))).toBe(false);
    expect(await (await fetch(server.url + '/api/workspace')).json()).toMatchObject({ workspace: first, projectId });
  });

  it('打开配置无效的项目不会替换现有管理器，自定义护栏地址不会被初始化写入', async () => {
    const { root, first, second, server, projectId } = await setup();
    mkdirSync(join(second, '.harness'));
    const configPath = join(second, '.harness', 'config.yaml');
    writeFileSync(configPath, 'llm:\n  provider: invalid\n');
    expect((await api(server.url, '/api/projects/open', projectId, { path: second })).status).toBe(409);
    expect(await (await fetch(server.url + '/api/workspace')).json()).toMatchObject({ workspace: first });
    const customRules = join(root, 'do-not-create.yaml');
    writeFileSync(configPath, JSON.stringify({ governance: { rulesFile: customRules } }));
    const opened = await (await api(server.url, '/api/projects/open', projectId, { path: second, initialize: true })).json();
    expect(opened.workspace.initialized).toBe(false);
    expect(existsSync(customRules)).toBe(false);
    expect(readFileSync(configPath, 'utf8')).toBe(JSON.stringify({ governance: { rulesFile: customRules } }));
  });

  it('启动配置覆盖仅绑定启动项目，切换后使用目标自己的配置', async () => {
    const { root, first, second, server } = await setup();
    await server.close();
    mkdirSync(join(first, '.harness'));
    writeFileSync(join(first, '.harness', 'guardrails.yaml'), 'rules: []\n');
    const override = join(root, 'override.yaml'); writeFileSync(override, 'llm:\n  model: startup-only\n');
    mkdirSync(join(second, '.harness'));
    writeFileSync(join(second, '.harness', 'config.yaml'), 'llm:\n  model: second-project\n');
    writeFileSync(join(second, '.harness', 'guardrails.yaml'), 'rules: []\n');
    const restarted = await startWebServer({ workspace: first, configPath: override, port: 0 }); resources.push({ root, server: restarted });
    const initial = await (await fetch(restarted.url + '/api/workspace')).json();
    expect(initial.config.llm.model).toBe('startup-only');
    const opened = await (await api(restarted.url, '/api/projects/open', initial.projectId, { path: second })).json();
    expect(opened.workspace.config.llm.model).toBe('second-project');
    const returned = await (await api(restarted.url, '/api/projects/open', opened.project.id, { path: first })).json();
    expect(returned.workspace.config.llm.model).toBe('startup-only');
  });

  it('切换结束旧项目 SSE，旧项目实时连接不能订阅新项目运行', async () => {
    const { second, server, projectId } = await setup();
    const run = await (await api(server.url, '/api/runs', projectId, { task: '实时连接项目绑定', mock: true })).json();
    await api(server.url, '/api/runs/' + run.id + '/cancel', projectId, {});
    const response = await fetch(server.url + '/api/runs/' + run.id + '/events?projectId=' + projectId);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader(); expect((await reader.read()).done).toBe(false);
    const opened = await (await api(server.url, '/api/projects/open', projectId, { path: second })).json();
    expect((await reader.read()).done).toBe(true);
    expect((await fetch(server.url + '/api/runs/' + run.id + '/events?projectId=' + projectId)).status).toBe(409);
    expect((await fetch(server.url + '/api/runs/' + run.id + '/events?projectId=' + opened.project.id)).status).toBe(404);
  });

  it('最近项目最多保留 20 个，目录选择隐藏内部状态且拒绝未知或重复参数', async () => {
    const { root, server, projectId } = await setup();
    let active = projectId;
    for (let index = 0; index < 21; index++) {
      const path = join(root, 'project-' + index); mkdirSync(path);
      const opened = await (await api(server.url, '/api/projects/open', active, { path })).json(); active = opened.project.id;
    }
    const projects = await (await fetch(server.url + '/api/projects')).json();
    expect(projects.projects).toHaveLength(20); expect(projects.activeProjectId).toBe(active);
    expect(projects.projects).toContainEqual(expect.objectContaining({ id: active }));
    mkdirSync(join(root, '.aws')); mkdirSync(join(root, '.harness'));
    const folders = await (await api(server.url, '/api/projects/directories?path=' + encodeURIComponent(root), active)).json();
    expect(folders.entries.map((entry: { name: string }) => entry.name)).not.toContain('.aws');
    expect(folders.entries.map((entry: { name: string }) => entry.name)).not.toContain('.harness');
    expect((await fetch(server.url + '/api/projects?unknown=1')).status).toBe(400);
    expect((await api(server.url, '/api/projects/directories?path=' + encodeURIComponent(root) + '&path=' + encodeURIComponent(root), active)).status).toBe(400);
    expect((await api(server.url, '/api/projects/open?unknown=1', active, { path: root })).status).toBe(400);
  });
});

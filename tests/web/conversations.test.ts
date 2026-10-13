import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, linkSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { startWebServer } from '../../src/web/server';
import { DefaultConfig } from '../../src/config/loader';
import { loadSession, saveSession } from '../../src/cli/checkpoint';
import * as providerFactory from '../../src/llm/factory';
import type { LLMMessage } from '../../src/core/types';
import type { WebConversation, WebConversationDetail, WebRun } from '../../src/web/types';

const resources: { workspace: string; server: Awaited<ReturnType<typeof startWebServer>> }[] = [];
afterEach(async () => {
  const cleanup = resources.splice(0);
  for (const resource of cleanup) await resource.server.close();
  for (const workspace of new Set(cleanup.map(resource => resource.workspace))) rmSync(workspace, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function setup() {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-conversation-test-'));
  const server = await startWebServer({ workspace, port: 0 });
  resources.push({ workspace, server });
  return { workspace, server };
}
const request = (url: string, path: string, body?: unknown) => fetch(url + path, body === undefined ? {} : {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
async function waitRun(url: string, id: string, status: WebRun['status']): Promise<WebRun> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const run = await (await request(url, '/api/runs/' + id)).json() as WebRun;
    if (run.status === status) return run;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('任务没有到达预期状态 ' + status);
}
async function approveDemo(url: string, run: WebRun): Promise<WebRun> {
  const waiting = await waitRun(url, run.id, 'awaiting_approval');
  expect((await request(url, `/api/runs/${run.id}/approve`, { approvalId: waiting.pendingApproval!.approvalId, approved: true })).status).toBe(200);
  return waitRun(url, run.id, 'completed');
}

describe('连续编码会话', () => {
  it('默认演示创建不调用模型，两轮共享文件、继承完整上下文，重启保留消息与运行历史', async () => {
    const { workspace, server } = await setup();
    const provider = vi.spyOn(providerFactory, 'createLLMProvider');
    const created = await request(server.url, '/api/conversations', {});
    expect(created.status).toBe(201);
    const conversation = await created.json() as WebConversation;
    expect(conversation).toMatchObject({ mock: true, execution: 'local', runIds: [], messages: [], canSend: true });
    expect(provider).not.toHaveBeenCalled();
    expect(existsSync(join(conversation.workspace, 'amount.js'))).toBe(false);
    const first = await (await request(server.url, `/api/conversations/${conversation.id}/messages`, { content: '修复金额计算' })).json() as { conversation: WebConversation; run: WebRun };
    expect(first.run.conversationId).toBe(conversation.id);
    expect(first.conversation.canSend).toBe(false);
    expect((await request(server.url, `/api/conversations/${conversation.id}/messages`, { content: '不能排队' })).status).toBe(409);
    const completedFirst = await approveDemo(server.url, first.run);
    expect(completedFirst.verified).toBe(true);
    const existing = readFileSync(join(conversation.workspace, 'amount.js'), 'utf8') + '// 用户保留的中文注释\n';
    writeFileSync(join(conversation.workspace, 'amount.js'), existing);
    const second = await (await request(server.url, `/api/conversations/${conversation.id}/messages`, { content: '记录追加需求，保留函数' })).json() as { run: WebRun };
    const completedSecond = await approveDemo(server.url, second.run);
    expect(completedSecond.workspace).toBe(completedFirst.workspace);
    expect(completedSecond.turns).toBe(3);
    expect(completedSecond.verified).toBe(true);
    expect(readFileSync(join(conversation.workspace, 'amount.js'), 'utf8')).toBe(existing);
    expect(readFileSync(join(conversation.workspace, 'notes.md'), 'utf8')).toContain('记录追加需求，保留函数');
    const checkpoint = loadSession(conversation.workspace, second.run.id).checkpoint;
    expect(checkpoint.messages.filter(message => message.role === 'system')).toHaveLength(1);
    expect(checkpoint.messages.filter(message => message.role === 'user').map(message => message.content)).toEqual(['修复金额计算', '记录追加需求，保留函数']);
    expect(checkpoint.messages.some(message => message.role === 'tool')).toBe(true);
    await server.close();
    const restarted = await startWebServer({ workspace, port: 0 });
    resources.push({ workspace, server: restarted });
    const detail = await (await request(restarted.url, '/api/conversations/' + conversation.id)).json() as WebConversationDetail;
    expect(detail).toMatchObject({ id: conversation.id, workspace: conversation.workspace, canSend: true });
    expect(detail.runIds).toEqual([first.run.id, second.run.id]);
    expect(detail.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(detail.runs.every(run => run.verified)).toBe(true);
    const listing = await (await request(restarted.url, '/api/conversations')).json();
    expect(listing.conversations[0].id).toBe(conversation.id);
  });

  it('真实提供商每轮继承上轮消息且重置预算，配置与执行模式固定', async () => {
    const { workspace, server } = await setup();
    mkdirSync(join(workspace, '.harness'), { recursive: true });
    const config = structuredClone(DefaultConfig);
    config.agent.maxTurns = 1;
    config.agent.maxTotalTokens = 10000;
    config.execution = { mode: 'local', timeout: 10000 };
    writeFileSync(join(workspace, '.harness', 'config.yaml'), JSON.stringify(config));
    writeFileSync(join(workspace, '.harness', 'guardrails.yaml'), 'rules: []\n');
    const inputs: LLMMessage[][] = [];
    const provider = vi.spyOn(providerFactory, 'createLLMProvider').mockResolvedValue({ name: 'test-model', async complete(messages) {
      inputs.push(structuredClone(messages));
      return { content: JSON.stringify({ done: true, summary: '测试模型结束本轮' }), usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 } };
    } });
    const conversation = await (await request(server.url, '/api/conversations', { mock: false, execution: 'local' })).json() as WebConversation;
    expect(provider).not.toHaveBeenCalled();
    for (const content of ['第一轮需求', '第二轮需求']) {
      const response = await request(server.url, `/api/conversations/${conversation.id}/messages`, { content });
      expect(response.status).toBe(201);
      const { run } = await response.json() as { run: WebRun };
      const completed = await waitRun(server.url, run.id, 'completed');
      expect(completed.turns).toBe(1);
      expect(completed.usage.totalTokens).toBe(3);
    }
    expect(inputs).toHaveLength(2);
    expect(inputs[1].filter(message => message.role === 'user').map(message => message.content)).toEqual(['第一轮需求', '第二轮需求']);
    expect(inputs[1].some(message => message.role === 'assistant' && message.content.includes('测试模型结束本轮'))).toBe(true);
    expect((await request(server.url, `/api/conversations/${conversation.id}/messages`, { content: '切换', mock: true })).status).toBe(400);
    expect((await request(server.url, '/api/conversations', { mock: true, execution: 'docker' })).status).toBe(400);
    config.llm.temperature = 0.2;
    writeFileSync(join(workspace, '.harness', 'config.yaml'), JSON.stringify(config));
    const changed = await request(server.url, `/api/conversations/${conversation.id}/messages`, { content: '使用改变后的配置' });
    expect(changed.status).toBe(409);
    expect((await changed.json()).error.code).toBe('CONFIG_CHANGED');
  });

  it.each(['pending', 'uncertain', 'unpaired'] as const)('拒绝 %s 检查点进入下一轮，并明确禁用继续输入', async unsafe => {
    const { server } = await setup();
    const conversation = await (await request(server.url, '/api/conversations', {})).json() as WebConversation;
    const { run } = await (await request(server.url, `/api/conversations/${conversation.id}/messages`, { content: '修复金额' })).json() as { run: WebRun };
    await approveDemo(server.url, run);
    const session = loadSession(conversation.workspace, run.id);
    if (unsafe === 'pending') session.checkpoint.pendingToolCalls = [{ id: 'pending', name: 'write_file', arguments: { path: 'unknown.txt', content: 'x' } }];
    if (unsafe === 'uncertain') session.checkpoint.executionUncertain = { type: 'write_file', params: { path: 'unknown.txt', content: 'x' } };
    if (unsafe === 'unpaired') session.checkpoint.messages.push({ role: 'assistant', content: '', toolCalls: [{ id: 'missing-result', name: 'read_file', arguments: { path: 'amount.js' } }] });
    saveSession(conversation.workspace, session.configHash, session.checkpoint, run.id, session.verifier);
    const detail = await (await request(server.url, '/api/conversations/' + conversation.id)).json() as WebConversation;
    expect(detail.canSend).toBe(false);
    expect(detail.blockedReason).toBeTruthy();
    const blocked = await request(server.url, `/api/conversations/${conversation.id}/messages`, { content: '禁止绕过未知副作用' });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe('UNSAFE_CONTEXT');
  });

  it.each([false, true])('提供商启动失败仍继承失败需求，已有成功轮：%s', async priorSuccess => {
    const { workspace, server } = await setup();
    mkdirSync(join(workspace, '.harness'), { recursive: true });
    writeFileSync(join(workspace, '.harness', 'guardrails.yaml'), 'rules: []\n');
    const inputs: LLMMessage[][] = [];
    const successfulProvider = { name: 'test-model', async complete(messages: LLMMessage[]) {
      inputs.push(messages);
      return { content: JSON.stringify({ done: true, summary: '重试完成' }) };
    } };
    const provider = vi.spyOn(providerFactory, 'createLLMProvider').mockResolvedValue(successfulProvider);
    const conversation = await (await request(server.url, '/api/conversations', { mock: false, execution: 'local' })).json() as WebConversation;
    if (priorSuccess) {
      const first = await (await request(server.url, `/api/conversations/${conversation.id}/messages`, { content: '已成功需求' })).json() as { run: WebRun };
      await waitRun(server.url, first.run.id, 'completed');
    }
    provider.mockRejectedValueOnce(new Error('测试凭据不可用'));
    const { run } = await (await request(server.url, `/api/conversations/${conversation.id}/messages`, { content: '首次需求' })).json() as { run: WebRun };
    await waitRun(server.url, run.id, 'error');
    const detail = await (await request(server.url, '/api/conversations/' + conversation.id)).json() as WebConversationDetail;
    expect(detail.canSend).toBe(true);
    expect(detail.messages.at(-1)?.content).toBe('测试凭据不可用');
    const retry = await (await request(server.url, `/api/conversations/${conversation.id}/messages`, { content: '再次尝试' })).json() as { run: WebRun };
    await waitRun(server.url, retry.run.id, 'completed');
    expect(inputs.at(-1)?.filter(message => message.role === 'user').map(message => message.content)).toEqual(priorSuccess ? ['已成功需求', '首次需求', '再次尝试'] : ['首次需求', '再次尝试']);
    expect(inputs.at(-1)?.some(message => message.role === 'assistant' && message.content === '测试凭据不可用')).toBe(true);
  });

  it('新一轮开始后禁止恢复旧轮，避免会话上下文分叉', async () => {
    const { server } = await setup();
    const conversation = await (await request(server.url, '/api/conversations', {})).json() as WebConversation;
    const first = await (await request(server.url, `/api/conversations/${conversation.id}/messages`, { content: '修复金额' })).json() as { run: WebRun };
    await waitRun(server.url, first.run.id, 'awaiting_approval');
    await request(server.url, `/api/runs/${first.run.id}/cancel`, {});
    const second = await (await request(server.url, `/api/conversations/${conversation.id}/messages`, { content: '追加说明' })).json() as { run: WebRun };
    await approveDemo(server.url, second.run);
    const older = await (await request(server.url, '/api/runs/' + first.run.id)).json() as WebRun;
    expect(older.resumable).toBe(false);
    const resumed = await request(server.url, `/api/runs/${first.run.id}/resume`, {});
    expect(resumed.status).toBe(409);
    expect((await resumed.json()).error.code).toBe('STALE_CONVERSATION_RUN');
  });
});

describe('安全文件浏览', () => {
  it('只读浏览 UTF-8、校验大小与编码，并隐藏状态、凭据和链接', async () => {
    const { workspace, server } = await setup();
    mkdirSync(join(workspace, 'src'));
    writeFileSync(join(workspace, 'src', 'main.ts'), '// 中文源码\nconst value = 1;\n');
    writeFileSync(join(workspace, '.env.production'), 'secret');
    writeFileSync(join(workspace, '.environment'), 'secret');
    writeFileSync(join(workspace, 'credentials.json'), 'secret');
    writeFileSync(join(workspace, 'binary.bin'), Buffer.from([0, 1, 2]));
    writeFileSync(join(workspace, 'invalid.txt'), Buffer.from([0xff, 0xfe]));
    writeFileSync(join(workspace, 'huge.txt'), 'x'.repeat(256 * 1024 + 1));
    linkSync(join(workspace, 'src', 'main.ts'), join(workspace, 'hardlink.ts'));
    symlinkSync(join(workspace, 'src'), join(workspace, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const listing = await (await request(server.url, '/api/files')).json();
    const names = listing.entries.map((item: { name: string }) => item.name);
    expect(names).toContain('src');
    for (const name of ['.env.production', '.environment', 'credentials.json', 'hardlink.ts', 'linked']) expect(names).not.toContain(name);
    // 创建硬链接后的源文件本身也不再满足安全读取限制。
    expect((await request(server.url, '/api/file?path=src/main.ts')).status).toBe(403);
    writeFileSync(join(workspace, 'src', 'other.ts'), '// 可读取的中文源码\n');
    const file = await (await request(server.url, '/api/file?path=src/other.ts')).json();
    expect(file.content).toBe('// 可读取的中文源码\n');
    expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(file.size).toBe(Buffer.byteLength(file.content));
    for (const path of ['../outside.txt', '.env.production', '.harness/config.yaml', 'linked/other.ts', 'hardlink.ts']) {
      expect((await request(server.url, '/api/file?path=' + encodeURIComponent(path))).status).toBe(403);
    }
    expect((await request(server.url, '/api/file?path=binary.bin')).status).toBe(415);
    expect((await request(server.url, '/api/file?path=invalid.txt')).status).toBe(415);
    expect((await request(server.url, '/api/file?path=huge.txt')).status).toBe(413);
    expect((await request(server.url, '/api/file?path=missing.txt')).status).toBe(404);
  });

  it('演示文件来自会话工作区，篡改持久元数据不能选择其他目录', async () => {
    const { workspace, server } = await setup();
    const conversation = await (await request(server.url, '/api/conversations', {})).json() as WebConversation;
    const file = await (await request(server.url, `/api/file?conversationId=${conversation.id}&path=amount.test.cjs`)).json();
    expect(file.content).toContain('金额为单价乘以数量');
    await server.close();
    const metadataPath = join(workspace, '.harness', 'web-conversations', conversation.id + '.json');
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    metadata.workspace = tmpdir();
    writeFileSync(metadataPath, JSON.stringify(metadata));
    const restarted = await startWebServer({ workspace, port: 0 });
    resources.push({ workspace, server: restarted });
    expect((await request(restarted.url, `/api/files?conversationId=${conversation.id}`)).status).toBe(404);
    expect((await request(restarted.url, '/api/files?workspace=' + encodeURIComponent(tmpdir()))).status).toBe(400);
  });
});

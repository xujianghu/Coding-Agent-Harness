import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { startWebServer } from '../../src/web/server';
import type { WebRun } from '../../src/web/types';

const resources: { workspace: string; server: Awaited<ReturnType<typeof startWebServer>> }[] = [];
afterEach(async () => {
  for (const { workspace, server } of resources.splice(0)) { await server.close(); rmSync(workspace, { recursive: true, force: true }); }
});

async function setup() {
  const workspace = mkdtempSync(join(tmpdir(), 'harness-events-test-'));
  const server = await startWebServer({ workspace, port: 0 });
  resources.push({ workspace, server });
  const response = await fetch(server.url + '/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: '演示 SSE 审批', mock: true }) });
  return { server, run: await response.json() as WebRun };
}
const post = (url: string, path: string, body: unknown) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function timeout<T>(promise: Promise<T>, milliseconds = 5000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('实时流等待超时')), milliseconds); })]);
  } finally { if (timer) clearTimeout(timer); }
}
function snapshots(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const queue: WebRun[] = [];
  let text = '';
  return {
    reader,
    async until(predicate: (run: WebRun) => boolean): Promise<WebRun> {
      while (true) {
        while (queue.length) { const run = queue.shift()!; if (predicate(run)) return run; }
        const chunk = await timeout(reader.read());
        if (chunk.done) throw new Error('实时流已提前结束');
        text += decoder.decode(chunk.value, { stream: true });
        const frames = text.split('\n\n'); text = frames.pop()!;
        for (const frame of frames) {
          if (!frame.startsWith('event: run\n')) continue;
          const data = frame.split('\n').find(line => line.startsWith('data: '));
          if (data) queue.push(JSON.parse(data.slice(6)) as WebRun);
        }
      }
    },
  };
}

describe('运行事件 SSE', () => {
  it('初始快照、审批与取消终态连续更新，重连得到当前完整快照', async () => {
    const { server, run } = await setup();
    const response = await fetch(server.url + `/api/runs/${run.id}/events`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const stream = snapshots(response);
    const initial = await stream.until(item => item.id === run.id);
    expect(initial.id).toBe(run.id);
    const waiting = initial.status === 'awaiting_approval' && initial.pendingApproval ? initial
      : await stream.until(item => item.status === 'awaiting_approval' && !!item.pendingApproval);
    expect(waiting.pendingApproval?.action.type).toBe('run_test');
    expect(waiting.events.some(event => event.type === 'tool_result')).toBe(true);
    expect((await post(server.url, `/api/runs/${run.id}/cancel`, {})).status).toBe(200);
    const cancelled = await stream.until(item => item.status === 'cancelled' && !!item.finishedAt);
    expect(cancelled.pendingApproval).toBeUndefined();
    expect(cancelled.resumable).toBe(true);
    await stream.reader.cancel();
    const reopened = snapshots(await fetch(server.url + `/api/runs/${run.id}/events`));
    expect((await reopened.until(item => item.status === 'cancelled')).id).toBe(run.id);
    await reopened.reader.cancel();
  });

  it('批准后提供已验收终态，关闭服务会终结打开的 SSE 连接', async () => {
    const { server, run } = await setup();
    const stream = snapshots(await fetch(server.url + `/api/runs/${run.id}/events`));
    const waiting = await stream.until(item => item.status === 'awaiting_approval' && !!item.pendingApproval);
    await post(server.url, `/api/runs/${run.id}/approve`, { approvalId: waiting.pendingApproval!.approvalId, approved: true });
    const completed = await stream.until(item => item.status === 'completed');
    expect(completed.verified).toBe(true);
    expect(completed.events.some(event => event.type === 'verification')).toBe(true);
    const closing = timeout(server.close(), 3000);
    // 清空已经到达客户端的快照后，连接应正常结束或因服务断开而关闭。
    await closing;
    let done = false;
    try {
      while (!done) done = (await timeout(stream.reader.read(), 3000)).done;
    } catch (error) {
      if (error instanceof Error && error.message === '实时流等待超时') throw error;
      done = true;
    }
    expect(done).toBe(true);
  });

  it('限制同时实时连接数，断开后释放订阅名额', async () => {
    const { server, run } = await setup();
    const responses: Response[] = [];
    try {
      for (let index = 0; index < 64; index++) {
        const response = await fetch(server.url + `/api/runs/${run.id}/events`);
        expect(response.status).toBe(200); responses.push(response);
      }
      expect((await fetch(server.url + `/api/runs/${run.id}/events`)).status).toBe(429);
      await Promise.all(responses.map(response => response.body!.cancel()));
      responses.length = 0;
      // 断开通知要经过一个网络事件循环，等待明确的再次连接成功结果。
      let reopened: Response | undefined;
      const deadline = Date.now() + 2000;
      do {
        if (reopened) await reopened.body?.cancel();
        reopened = await fetch(server.url + `/api/runs/${run.id}/events`);
      } while (reopened.status !== 200 && Date.now() < deadline);
      expect(reopened.status).toBe(200);
      await reopened.body!.cancel();
    } finally { await Promise.all(responses.map(response => response.body!.cancel().catch(() => undefined))); }
  });
});

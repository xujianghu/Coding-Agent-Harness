import { spawn } from 'child_process';
import { StringDecoder } from 'string_decoder';
import { decodeValue, encodeValue, ValueGraph } from './rpc-codec';

export interface InvocationResult {
  value: unknown;
  argsAfter: unknown[];
  attempts: number[];
}

export interface CandidateRpc {
  invoke(module: string, name: string, args: unknown[]): Promise<InvocationResult>;
  call(module: string, name: string, args: unknown[]): Promise<unknown>;
  retry(module: string, steps: Array<{ error?: string; value?: unknown }>, maxAttempts: number): Promise<InvocationResult>;
  assertHealthy(): void;
  close(): Promise<void>;
}

interface Response {
  type: string;
  id: string;
  ok: boolean;
  data?: ValueGraph;
  error?: { name: string; message: string; attempts: number[] };
}

export function createCandidateRpc(executable: string, args: string[], options: {
  workspace: string; mock: boolean; timeoutMs: number; containerName: string; signal?: AbortSignal;
}): CandidateRpc {
  const child = spawn(executable, args, { cwd: options.workspace, windowsHide: true, detached: process.platform !== 'win32',
    ...(options.mock ? { env: { CANDIDATE_ROOT: options.workspace, SystemRoot: process.env.SystemRoot } } : {}) });
  const pending = new Map<string, { resolve(value: InvocationResult): void; reject(error: Error): void }>();
  let failure: Error | undefined;
  let sequence = 0;
  let closing = false;
  let cleanup: Promise<void> | undefined;
  let stdout = '';
  let outputBytes = 0;
  let stderr = '';
  const decoder = new StringDecoder('utf8');
  let childClosed = false;
  const closed = new Promise<void>(done => { child.once('close', () => { childClosed = true; done(); }); });
  const removeContainer = (): Promise<void> => new Promise(done => {
    const remover = spawn('docker', ['rm', '--force', options.containerName], { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => remover.kill(), 5000);
    remover.once('error', () => { clearTimeout(timer); done(); });
    remover.once('close', () => { clearTimeout(timer); done(); });
  });
  const terminateChild = (): Promise<void> => new Promise(done => {
    if (!child.pid || childClosed) { child.kill(); done(); return; }
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.once('error', () => { child.kill(); done(); });
      killer.once('close', () => done());
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      done();
    }
  });
  const close = async (): Promise<void> => {
    if (cleanup) return cleanup;
    closing = true;
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
    cleanup = (async () => {
      if (!options.mock) await removeContainer();
      await terminateChild();
      await closed;
    })();
    return cleanup;
  };
  const fail = (error: Error): void => {
    if (!failure) failure = error;
    for (const request of pending.values()) request.reject(failure);
    pending.clear();
    void close();
  };
  const abort = () => fail(new Error('候选执行已取消'));
  const timeout = setTimeout(() => fail(new Error('候选执行超时')), options.timeoutMs);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  child.once('error', error => fail(error));
  child.once('close', (code, signal) => {
    if (!closing) fail(new Error(`候选进程提前退出：${code ?? signal ?? 'unknown'}${stderr ? `；${stderr}` : ''}`));
  });
  child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(0, 8192); });
  child.stdout.on('data', (chunk: Buffer) => {
    outputBytes += chunk.length;
    if (outputBytes > 1024 * 1024) { fail(new Error('候选 RPC 输出超出上限')); return; }
    stdout += decoder.write(chunk);
    let position: number;
    while ((position = stdout.indexOf('\n')) >= 0) {
      const line = stdout.slice(0, position); stdout = stdout.slice(position + 1);
      try {
        const response = JSON.parse(line) as Response;
        if (response.type !== 'rpc-result' || typeof response.id !== 'string' || !pending.has(response.id) || typeof response.ok !== 'boolean') throw new Error('候选返回未请求、重复或无效的 RPC 响应');
        const request = pending.get(response.id)!;
        if (response.ok) {
          const decoded = decodeValue(response.data!) as InvocationResult;
          if (!decoded || !Array.isArray(decoded.argsAfter) || !Array.isArray(decoded.attempts)) throw new Error('候选 RPC 返回无效的数据结构');
          pending.delete(response.id); request.resolve(decoded);
        } else {
          const remote = response.error;
          if (!remote || typeof remote.name !== 'string' || typeof remote.message !== 'string' || !Array.isArray(remote.attempts)) throw new Error('候选 RPC 返回无效异常');
          const constructors: Record<string, typeof Error> = { Error, TypeError, RangeError, SyntaxError, ReferenceError };
          const constructor = Object.prototype.hasOwnProperty.call(constructors, remote.name) ? constructors[remote.name] : Error;
          const error = new constructor(remote.message);
          Object.defineProperty(error, 'attempts', { value: remote.attempts });
          pending.delete(response.id); request.reject(error);
        }
      } catch (error) { fail(new Error(`候选 RPC 协议错误：${error instanceof Error ? error.message : String(error)}`)); }
    }
  });
  const request = (method: string, module: string, name: string, args: unknown[]): Promise<InvocationResult> => {
    if (failure) return Promise.reject(failure);
    if (closing || childClosed) return Promise.reject(new Error('候选 RPC 已关闭'));
    if (++sequence > 1000) return Promise.reject(new Error('候选 RPC 调用次数超出上限'));
    const id = `request-${sequence}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const payload = JSON.stringify({ id, method, module, name, args: encodeValue(args) });
      child.stdin.write(payload + '\n', error => { if (error) fail(error); });
    });
  };
  child.stdin.on('error', error => fail(error));
  return {
    invoke: (module, name, args) => request('call', module, name, args),
    call: async (module, name, args) => (await request('call', module, name, args)).value,
    retry: (module, steps, maxAttempts) => request('retry', module, 'retry', [steps, maxAttempts]),
    assertHealthy: () => { if (failure) throw failure; },
    close,
  };
}

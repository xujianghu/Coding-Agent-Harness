import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, isAbsolute, join, resolve } from 'path';
import type { GradeResult } from './types';
import { changes } from './artifacts';
import { snapshotFiles } from './manifest';
import { createCandidateRpc, CandidateRpc } from './rpc-client';
import { candidateRpcSource } from './rpc-source';

export interface GradeOptions {
  workspace: string;
  acceptance: string;
  baseline: Map<string, Buffer>;
  allowedChanges: string[];
  mock: boolean;
  image: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export function assertDockerAvailable(image: string): void {
  try {
    execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 15000, stdio: 'pipe' });
    execFileSync('docker', ['image', 'inspect', image], { timeout: 15000, stdio: 'pipe' });
  } catch {
    throw new Error('真实评测要求可用 Docker 及本地镜像 ' + image + '。请先启动 Docker 并手动拉取镜像；不会回退为宿主执行。--mock 仅用于离线机制自检。');
  }
}

/** 候选容器只挂源码与 RPC 服务，隐藏断言由可信父进程持有。 */
export function buildGradeArguments(workspace: string, rpcDirectory: string, image: string, name: string): string[] {
  if (!isAbsolute(workspace) || !isAbsolute(rpcDirectory)) throw new Error('验收挂载必须使用绝对路径');
  if ([workspace, rpcDirectory].some(value => /[,\r\n]/.test(value))) throw new Error('挂载路径包含不支持的字符');
  return ['run', '--rm', '--interactive', '--name', name, '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--memory', '256m', '--cpus', '0.5',
    '--user', gradeIdentity().user, '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m',
    '--mount', 'type=bind,src=' + workspace + ',dst=/candidate,readonly',
    '--mount', 'type=bind,src=' + rpcDirectory + ',dst=/rpc,readonly',
    '--workdir', '/candidate', '--entrypoint', 'node', image, '/rpc/server.cjs'];
}

export function gradeIdentity(): { user: string; publicRead: boolean } {
  if (typeof process.getuid === 'function' && typeof process.getgid === 'function' && process.getuid() !== 0) {
    return { user: `${process.getuid()}:${process.getgid()}`, publicRead: false };
  }
  return { user: '65534:65534', publicRead: true };
}

/** 只调整自建评分副本的权限，兼容 Linux 非 root 容器，不改调用者工作区。 */
export function prepareGradeDirectories(directory: string, snapshot: Map<string, Buffer>, publicRead = gradeIdentity().publicRead): { candidate: string; service: string } {
  const directoryMode = publicRead ? 0o755 : 0o700;
  const fileMode = publicRead ? 0o644 : 0o600;
  chmodSync(directory, directoryMode);
  const candidate = join(directory, 'candidate');
  const service = join(directory, 'service');
  for (const folder of [candidate, service]) { mkdirSync(folder); chmodSync(folder, directoryMode); }
  for (const [name, bytes] of snapshot) {
    const target = join(candidate, name);
    const parents: string[] = [];
    let parent = dirname(target);
    while (parent !== candidate) { parents.unshift(parent); parent = dirname(parent); }
    for (const folder of parents) { mkdirSync(folder, { recursive: true }); chmodSync(folder, directoryMode); }
    writeFileSync(target, bytes); chmodSync(target, fileMode);
  }
  const server = join(service, 'server.cjs');
  writeFileSync(server, candidateRpcSource); chmodSync(server, fileMode);
  return { candidate, service };
}

export async function gradeCandidate(options: GradeOptions): Promise<GradeResult> {
  let violations: string[];
  let snapshot: Map<string, Buffer>;
  try {
    snapshot = snapshotFiles(options.workspace);
    violations = changes(options.baseline, snapshot).filter(name => !options.allowedChanges.includes(name));
  } catch (error) {
    return { passed: false, violations: [error instanceof Error ? error.message : String(error)], output: '', error: '候选目录违反文件边界' };
  }
  if (violations.length) return { passed: false, violations, output: '', error: '修改了验收范围以外的文件或新增了违规文件' };
  if (options.signal?.aborted) return { passed: false, violations, output: '', error: '验收已取消' };
  const directory = mkdtempSync(join(tmpdir(), 'harness-grade-rpc-'));
  const name = 'harness-grade-' + randomUUID();
  let rpc: CandidateRpc | undefined;
  try {
    const prepared = prepareGradeDirectories(directory, snapshot);
    const args = options.mock ? [join(prepared.service, 'server.cjs')] : buildGradeArguments(prepared.candidate, prepared.service, options.image, name);
    rpc = createCandidateRpc(options.mock ? process.execPath : 'docker', args, {
      workspace: prepared.candidate, mock: options.mock, timeoutMs: options.timeoutMs, containerName: name, signal: options.signal,
    });
    // 验收文件来自冻结清单，父进程只加载受信断言；候选代码只在子进程运行。
    const acceptancePath = resolve(options.acceptance, 'acceptance.cjs');
    delete require.cache[require.resolve(acceptancePath)];
    const acceptance: unknown = require(acceptancePath);
    if (typeof acceptance !== 'function') throw new Error('隐藏验收必须导出异步 RPC 断言函数');
    await (acceptance as (client: CandidateRpc) => Promise<void>)(rpc);
    rpc.assertHealthy();
    options.signal?.throwIfAborted();
    return { passed: true, violations, output: '可信父进程隐藏验收通过', exitCode: 0 };
  } catch (error) {
    return { passed: false, violations, output: '', error: error instanceof Error ? error.message : String(error), exitCode: 1 };
  } finally {
    // 必须等容器删除与候选进程 close 后才返回，候选 stdout 从不决定验收成功。
    await rpc?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

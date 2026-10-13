import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative, resolve } from 'path';
import type { ActionResult, ToolExecutionContext } from '../core/types';
import { isSensitivePath, isWithinDirectory } from './path';

export interface CommandExecutor {
  execute(command: string, context?: ToolExecutionContext): Promise<ActionResult>;
}

export interface CommandExecutorOptions {
  mode: 'local' | 'docker';
  workspaceRoot: string;
  dockerImage?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  memory?: string;
  pidsLimit?: number;
  cpus?: number;
}

function failure(error: unknown, output = '', exitCode = 1): ActionResult {
  return { success: false, output, error: error instanceof Error ? error.message : String(error), exitCode };
}

/** 本地执行也不继承 API Key；只保留启动程序所需的环境。 */
function executionEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP']) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return environment;
}

function dockerEnvironment(): NodeJS.ProcessEnv {
  const environment = executionEnvironment();
  // Docker 连接设置仅交给宿主 CLI，不通过 -e 传入容器。
  for (const key of ['HOME', 'USERPROFILE', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return environment;
}

function stopProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return Promise.resolve();
  if (process.platform === 'win32') {
    return new Promise((done) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, env: executionEnvironment(), stdio: 'ignore' });
      killer.once('error', () => { child.kill(); done(); });
      killer.once('close', () => done());
    });
  }
  try {
    // POSIX detached 子进程有独立进程组，一次终止整个树。
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
  return Promise.resolve();
}

function dockerRemove(name: string): Promise<void> {
  return new Promise((done) => {
    const child = spawn('docker', ['rm', '-f', name], { windowsHide: true, env: dockerEnvironment(), stdio: 'ignore' });
    const timeout = setTimeout(() => child.kill(), 5000);
    child.once('error', () => { clearTimeout(timeout); done(); });
    child.once('close', () => { clearTimeout(timeout); done(); });
  });
}

interface ProtectedPath { path: string; directory: boolean }

function protectedPaths(workspaceRoot: string): ProtectedPath[] {
  const protectedEntries: ProtectedPath[] = [];
  const root = realpathSync(workspaceRoot);
  const inspect = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        const target = realpathSync(path);
        if (!isWithinDirectory(root, target) || isSensitivePath(relative(root, target))) {
          throw new Error(`Unsafe workspace symlink: ${relative(root, path)}`);
        }
      }
      if (isSensitivePath(relative(root, path))) {
        protectedEntries.push({ path: relative(root, path).replace(/\\/g, '/'), directory: stat.isDirectory() });
      } else if (stat.isDirectory()) {
        inspect(path);
      } else if (stat.isFile() && stat.nlink > 1) {
        throw new Error(`Hard-linked workspace file is not allowed: ${relative(root, path)}`);
      } else if (!stat.isFile() && !stat.isSymbolicLink()) {
        throw new Error(`Non-regular workspace entry: ${relative(root, path)}`);
      }
    }
  };
  inspect(root);
  return protectedEntries;
}

export function createCommandExecutor(options: CommandExecutorOptions): CommandExecutor {
  const workspaceRoot = realpathSync(resolve(options.workspaceRoot));
  const timeoutMs = options.timeoutMs ?? 120000;
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
  if (!['local', 'docker'].includes(options.mode)) throw new Error('Invalid execution mode');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new Error('Invalid command execution limits');
  }

  return {
    async execute(command, context): Promise<ActionResult> {
      if (typeof command !== 'string' || !command.trim()) return failure('Command is required');
      if (context?.signal?.aborted) return failure('Command aborted', '', 130);
      let maskRoot: string | undefined;
      let containerName: string | undefined;
      try {
        let executable: string;
        let args: string[];
        if (options.mode === 'docker') {
          const protectedEntries = protectedPaths(workspaceRoot);
          maskRoot = mkdtempSync(join(tmpdir(), 'harness-masks-'));
          mkdirSync(join(maskRoot, 'directory'));
          writeFileSync(join(maskRoot, 'file'), '');
          containerName = `harness-${randomUUID()}`;
          executable = 'docker';
          args = [
            'run', '--rm', '--name', containerName, '--pull', 'never',
            ...(process.platform !== 'win32' && process.getuid && process.getgid ? ['--user', `${process.getuid()}:${process.getgid()}`] : []),
            '--network', 'none', '--read-only', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--memory', options.memory ?? '512m',
            '--pids-limit', String(options.pidsLimit ?? 64), '--cpus', String(options.cpus ?? 1),
            '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m', '--workdir', '/workspace',
            '--env', 'HOME=/tmp', '--env', 'TMPDIR=/tmp', '--env', 'CI=1',
            '--mount', `type=bind,source=${workspaceRoot},target=/workspace`,
          ];
          // 覆盖敏感条目，容器得到空内容，且无法删除或改写这些挂载点。
          for (const entry of protectedEntries) {
            args.push('--mount', `type=bind,source=${join(maskRoot, entry.directory ? 'directory' : 'file')},target=/workspace/${entry.path},readonly`);
          }
          args.push('--entrypoint', '/bin/sh', options.dockerImage ?? 'node:22-alpine', '-c', command);
        } else {
          executable = process.platform === 'win32' ? process.env.COMSPEC ?? 'cmd.exe' : '/bin/sh';
          args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];
        }

        return await new Promise<ActionResult>((complete) => {
          let stdout = '';
          let stderr = '';
          let capturedBytes = 0;
          let terminalReason: string | undefined;
          let settled = false;
          let stopping: Promise<void> | undefined;
          const child = spawn(executable, args, {
            cwd: workspaceRoot, windowsHide: true, detached: process.platform !== 'win32',
            env: options.mode === 'docker' ? dockerEnvironment() : executionEnvironment(),
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          const stop = (reason: string): void => {
            if (terminalReason) return;
            terminalReason = reason;
            stopping = (async () => {
              if (containerName) await dockerRemove(containerName);
              await stopProcessTree(child);
            })();
          };
          const append = (chunk: Buffer, destination: 'stdout' | 'stderr'): void => {
            const remaining = maxOutputBytes - capturedBytes;
            const captured = chunk.subarray(0, Math.max(0, remaining));
            capturedBytes += captured.length;
            if (destination === 'stdout') stdout += captured.toString('utf-8');
            else stderr += captured.toString('utf-8');
            if (chunk.length > remaining) stop('Command output limit exceeded');
          };
          child.stdout?.on('data', (chunk: Buffer) => append(chunk, 'stdout'));
          child.stderr?.on('data', (chunk: Buffer) => append(chunk, 'stderr'));
          const abort = (): void => stop('Command aborted');
          const timeout = setTimeout(() => stop('Command timed out'), timeoutMs);
          context?.signal?.addEventListener('abort', abort, { once: true });
          if (context?.signal?.aborted) abort();
          const finish = async (code: number | null, error?: Error): Promise<void> => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            context?.signal?.removeEventListener('abort', abort);
            if (stopping) await stopping;
            if (terminalReason) {
              const exitCode = terminalReason === 'Command aborted' ? 130 : terminalReason === 'Command timed out' ? 124 : 1;
              complete(failure([terminalReason, stderr.trim()].filter(Boolean).join('\n'), stdout.trim(), exitCode));
            } else if (error) {
              complete(failure(error, stdout.trim()));
            } else {
              const exitCode = code ?? 1;
              complete({ success: exitCode === 0, output: stdout.trim(), error: stderr.trim() || undefined, exitCode });
            }
          };
          child.once('error', (error) => { void finish(null, error); });
          child.once('close', (code) => { void finish(code); });
        });
      } catch (error) {
        return failure(error);
      } finally {
        if (containerName) await dockerRemove(containerName);
        if (maskRoot) rmSync(maskRoot, { recursive: true, force: true });
      }
    },
  };
}

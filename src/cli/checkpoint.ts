import { createHash, randomUUID } from 'crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, statSync, writeFileSync } from 'fs';
import { basename, join, relative, resolve } from 'path';
import { AgentCheckpoint, AgentConfig } from '../core/types';
import { isSensitivePath } from '../tools/path';

export interface StoredSession {
  version: 1;
  runId: string;
  workspace: string;
  configHash: string;
  workspaceHash: string;
  verifier?: string;
  updatedAt: number;
  checkpoint: AgentCheckpoint;
}

const EXCLUDED = new Set(['.git', '.harness', 'node_modules', 'dist', 'coverage', 'target']);

export function workspaceFingerprint(workspace: string): string {
  const hash = createHash('sha256');
  const root = realpathSync(workspace);
  let count = 0;
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      if (EXCLUDED.has(entry) || isSensitivePath(entry)) continue;
      if (++count > 20000) throw new Error('会话工作区超过 20000 个条目，请缩小工作区');
      const full = join(directory, entry);
      const stat = lstatSync(full);
      const name = relative(root, full).replace(/\\/g, '/');
      hash.update(JSON.stringify(name));
      if (stat.isSymbolicLink()) hash.update(`link:${readlinkSync(full)}`);
      else if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) hash.update(createHash('sha256').update(readFileSync(full)).digest());
    }
  };
  walk(root);
  return hash.digest('hex');
}

export function sessionConfigHash(config: AgentConfig, rules: unknown): string {
  return createHash('sha256').update(JSON.stringify({ config, rules })).digest('hex');
}

function sessionPath(workspace: string, runId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(runId)) throw new Error('会话 ID 无效');
  return join(resolve(workspace), '.harness', 'sessions', `${runId}.json`);
}

export function saveSession(workspace: string, configHash: string, checkpoint: AgentCheckpoint, runId: string = randomUUID(), verifier?: string): StoredSession {
  const stored: StoredSession = { version: 1, runId, workspace: realpathSync(workspace), configHash, workspaceHash: workspaceFingerprint(workspace), verifier, updatedAt: Date.now(), checkpoint };
  const destination = sessionPath(workspace, runId);
  mkdirSync(join(resolve(workspace), '.harness', 'sessions'), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(stored, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, destination);
  return stored;
}

export function loadSession(workspace: string, runId?: string): StoredSession {
  const directory = join(resolve(workspace), '.harness', 'sessions');
  if (!existsSync(directory)) throw new Error('没有可恢复的会话');
  const filename = runId ? sessionPath(workspace, runId) : readdirSync(directory)
    .filter((entry) => /^[a-zA-Z0-9_-]{1,100}\.json$/.test(entry))
    .map((entry) => join(directory, entry))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!filename || !existsSync(filename)) throw new Error('没有找到指定会话');
  const stored = JSON.parse(readFileSync(filename, 'utf8')) as StoredSession;
  const checkpoint = stored.checkpoint;
  if (typeof stored.runId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(stored.runId) || basename(filename) !== stored.runId + '.json') throw new Error('会话文件 ID 无效或与文件名不一致');
  if (stored.version !== 1 || checkpoint?.version !== 1 || !Array.isArray(checkpoint.messages) || !Array.isArray(checkpoint.history) || !Number.isSafeInteger(checkpoint.turns) || checkpoint.turns < 0 || typeof checkpoint.task !== 'string' || !checkpoint.usage || !Number.isFinite(checkpoint.elapsedMs) || checkpoint.elapsedMs < 0) throw new Error('会话文件格式无效');
  const usage = checkpoint.usage;
  if (![usage.promptTokens, usage.completionTokens, usage.totalTokens, checkpoint.parseAttempts].every(value => Number.isSafeInteger(value) && value >= 0) || usage.totalTokens < usage.promptTokens + usage.completionTokens || typeof checkpoint.usageEstimated !== 'boolean' || typeof checkpoint.verified !== 'boolean' || typeof checkpoint.summary !== 'string' || !['idle', 'running', 'completed', 'stopped', 'error'].includes(checkpoint.state)) throw new Error('会话的用量或执行状态无效');
  if (!checkpoint.messages.every(message => message && ['system', 'user', 'assistant', 'tool'].includes(message.role) && typeof message.content === 'string')) throw new Error('会话消息格式无效');
  if (checkpoint.pendingToolCalls !== undefined && (!Array.isArray(checkpoint.pendingToolCalls) || !checkpoint.pendingToolCalls.every(call => call && typeof call.id === 'string' && typeof call.name === 'string' && call.arguments && typeof call.arguments === 'object' && !Array.isArray(call.arguments)))) throw new Error('会话待执行调用格式无效');
  if (stored.workspace !== realpathSync(workspace)) throw new Error('会话不属于当前工作区');
  return stored;
}

export function assertSessionUnchanged(session: StoredSession, workspace: string, configHash: string): void {
  if (session.configHash !== configHash) throw new Error('配置或护栏规则已经改变，请使用新任务重新运行');
  if (session.workspaceHash !== workspaceFingerprint(workspace)) throw new Error('工作区在会话中断后发生变化，请检查修改并启动新任务');
  if (session.checkpoint.verified || session.checkpoint.state === 'completed') throw new Error('该会话已结束，请启动新任务');
}

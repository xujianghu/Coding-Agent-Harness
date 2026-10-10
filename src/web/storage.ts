import { existsSync, lstatSync, mkdirSync, openSync, closeSync, readSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { join, relative, resolve, sep } from 'path';
import type { WebEvaluationReport, WebEvent, WebRun } from './types';

export const VALID_ID = /^[a-zA-Z0-9_-]{1,100}$/;

/** 状态目录只能由当前工作区持有，禁止符号链接把会话和轨迹导向其他目录。 */
export function statePath(workspace: string, ...parts: string[]): string {
  const root = realpathSync(workspace);
  const destination = resolve(root, '.harness', ...parts);
  const remaining = relative(root, destination);
  if (remaining === '..' || remaining.startsWith('..' + sep)) throw new Error('状态路径越界');
  let cursor = root;
  for (const part of relative(root, destination).split(sep)) {
    cursor = join(cursor, part);
    if (existsSync(cursor)) {
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) throw new Error('状态目录不允许符号链接或硬链接');
    }
  }
  return destination;
}

export function saveRun(workspace: string, run: WebRun): void {
  const directory = statePath(workspace, 'web-runs');
  mkdirSync(directory, { recursive: true });
  const destination = statePath(workspace, 'web-runs', run.id + '.json');
  const temporary = destination + '.' + randomUUID() + '.tmp';
  // 轨迹保存在 JSONL 中，元数据无需重复模型输入。
  writeFileSync(temporary, JSON.stringify({ ...run, events: [], pendingApproval: undefined }), { mode: 0o600 });
  renameSync(temporary, destination);
}

export function readBounded(path: string, maxBytes = 2 * 1024 * 1024): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > maxBytes) throw new Error('文件类型或大小不符合读取限制');
  return readFileSync(path, 'utf8');
}

export function readTrace(workspace: string, id: string): WebEvent[] {
  const path = statePath(workspace, 'runs', id + '.jsonl');
  if (!existsSync(path)) return [];
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink > 1) throw new Error('轨迹文件无效');
  const descriptor = openSync(path, 'r');
  const length = Math.min(stat.size, 2 * 1024 * 1024);
  const bytes = Buffer.alloc(length);
  try { readSync(descriptor, bytes, 0, length, stat.size - length); } finally { closeSync(descriptor); }
  const lines = bytes.toString('utf8').split('\n');
  if (stat.size > length) lines.shift();
  return lines.filter(Boolean).slice(-250).flatMap((line, index) => {
    try {
      const item = JSON.parse(line);
      if (typeof item.type !== 'string' || typeof item.timestamp !== 'number') return [];
      return [{ sequence: typeof item.sequence === 'number' ? item.sequence : typeof item.data?.sequence === 'number' ? item.data.sequence : index + 1, timestamp: item.timestamp, type: item.type, data: item.data }];
    } catch { return []; }
  });
}

export function listEvaluationReports(workspace: string): WebEvaluationReport[] {
  const directory = statePath(workspace, 'eval-results');
  if (!existsSync(directory)) return [];
  const candidates: { id: string; directory: string }[] = [{ id: 'latest', directory }];
  for (const entry of readdirSync(directory).filter(name => VALID_ID.test(name)).slice(0, 100)) {
    const full = statePath(workspace, 'eval-results', entry);
    if (lstatSync(full).isDirectory()) candidates.push({ id: entry, directory: full });
  }
  return candidates.flatMap(({ id, directory: location }) => {
    const reportPath = join(location, 'report.md');
    const resultsPath = join(location, 'results.jsonl');
    if (!existsSync(reportPath) || !existsSync(resultsPath)) return [];
    try {
      const report = readBounded(reportPath, 256 * 1024);
      const records = readBounded(resultsPath).split('\n').filter(Boolean).map(line => JSON.parse(line));
      return [{ id, createdAt: lstatSync(reportPath).mtimeMs,
        kind: records.every(item => item.kind === 'mock-mechanism-check') ? 'mock-mechanism-check' : records.every(item => item.kind === 'model-evaluation') ? 'model-evaluation' : 'mixed',
        modes: [...new Set(records.map(item => String(item.mode)))],
        summary: { attempts: records.length, passed: records.filter(item => item.success === true).length,
          modelAttempts: records.filter(item => item.kind === 'model-evaluation').length,
          mockAttempts: records.filter(item => item.kind === 'mock-mechanism-check').length,
          modelPassed: records.filter(item => item.kind === 'model-evaluation' && item.success === true).length,
          mockPassed: records.filter(item => item.kind === 'mock-mechanism-check' && item.success === true).length }, report }];
    } catch { return []; }
  }).sort((a, b) => b.createdAt - a.createdAt);
}

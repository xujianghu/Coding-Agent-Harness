import { createHash } from 'crypto';
import { lstatSync, readFileSync, readdirSync } from 'fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'path';
import type { LoadedManifest, EvaluationManifest } from './types';

/** 固定任务目录禁止符号链接，避免将验收目录或宿主文件带进候选区。 */
export function snapshotFiles(root: string): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  let totalBytes = 0;
  let entries = 0;
  function visit(directory: string): void {
    for (const name of readdirSync(directory).sort()) {
      if (++entries > 5000) throw new Error('候选目录超出条目上限');
      const full = resolve(directory, name);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error(`不允许符号链接：${full}`);
      if (stat.isDirectory()) visit(full);
      else if (stat.isFile()) {
        totalBytes += stat.size;
        if (stat.size > 2 * 1024 * 1024 || totalBytes > 32 * 1024 * 1024) throw new Error('候选目录超出文件大小上限');
        result.set(relative(root, full).split(sep).join('/'), readFileSync(full));
      }
      else throw new Error(`不允许特殊文件：${full}`);
    }
  }
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error(`必须使用真实目录：${root}`);
  visit(root);
  return result;
}

export function hashFiles(files: Map<string, Buffer>): string {
  const hash = createHash('sha256');
  for (const [name, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(name).update('\0').update(String(content.length)).update('\0').update(content);
  }
  return hash.digest('hex');
}

export function manifestDirectory(root: string, name: string): string {
  if (typeof name !== 'string' || isAbsolute(name)) throw new Error('任务路径必须是相对路径');
  const result = resolve(root, name);
  const difference = relative(root, result);
  if (!difference || difference === '..' || difference.startsWith(`..${sep}`) || isAbsolute(difference)) {
    throw new Error(`任务路径超出清单目录：${name}`);
  }
  return result;
}

export function loadManifest(filePath: string): LoadedManifest {
  const absolute = resolve(filePath);
  const raw = readFileSync(absolute);
  const data = JSON.parse(raw.toString('utf8')) as EvaluationManifest;
  if (data.version !== 1 || !Array.isArray(data.tasks) || !data.tasks.length) throw new Error('无效的评测清单');
  const ids = new Set<string>();
  const content = new Map<string, Buffer>([['manifest.json', raw]]);
  const root = dirname(absolute);
  for (const task of data.tasks) {
    if (!/^[a-zA-Z0-9_-]+$/.test(task.id) || ids.has(task.id)) throw new Error(`无效或重复任务 ID：${task.id}`);
    ids.add(task.id);
    if (!task.prompt || !task.publicTestCommand || !Array.isArray(task.allowedChanges) || !task.allowedChanges.length) {
      throw new Error(`任务缺少必要字段：${task.id}`);
    }
    for (const key of ['fixture', 'acceptance', 'mockSolution'] as const) {
      const files = snapshotFiles(manifestDirectory(root, task[key]));
      for (const [name, bytes] of files) content.set(`${task.id}/${key}/${name}`, bytes);
    }
    const fixture = snapshotFiles(manifestDirectory(root, task.fixture));
    for (const allowed of task.allowedChanges) {
      if (!allowed.startsWith('src/') || !fixture.has(allowed)) throw new Error(`允许变更必须是现有源码文件：${allowed}`);
    }
    if (!snapshotFiles(manifestDirectory(root, task.acceptance)).has('acceptance.cjs')) throw new Error(`缺少验收入口：${task.id}`);
  }
  return { data, root, hash: hashFiles(content) };
}

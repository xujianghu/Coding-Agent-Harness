import { lstatSync, readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import { isSensitivePath, resolveWorkspacePath } from '../tools/path';
import type { WebChange } from './types';

const IGNORED = new Set(['.git', '.harness', 'node_modules', 'dist', 'coverage', 'target']);

/** 预览只影响展示，读取失败、二进制和大文件均不会阻断实际工具。 */
export function previewWorkspace(workspace: string): Map<string, string> {
  const files = new Map<string, string>();
  let count = 0;
  let bytes = 0;
  function walk(directory: string) {
    let names: string[];
    try { names = readdirSync(directory).sort(); } catch { return; }
    for (const name of names) {
      if (count >= 5000 || bytes >= 8 * 1024 * 1024) return;
      if (IGNORED.has(name) || isSensitivePath(name)) continue;
      count++;
      const path = join(directory, name);
      const relativePath = relative(workspace, path).replace(/\\/g, '/');
      try {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) { walk(path); continue; }
        if (!stat.isFile()) continue;
        resolveWorkspacePath(workspace, relativePath);
        if (stat.size > 256 * 1024) { files.set(relativePath, `[文件超过预览上限；大小 ${stat.size} 字节；修改时间 ${stat.mtimeMs}]`); continue; }
        const content = readFileSync(path);
        bytes += content.length;
        files.set(relativePath, content.includes(0) ? `[二进制文件；大小 ${stat.size} 字节；修改时间 ${stat.mtimeMs}]`
          : content.length > 32768 ? content.toString('utf8').slice(0, 32768) + '\n[预览已截断；SHA-256 ' + createHash('sha256').update(content).digest('hex') + ']' : content.toString('utf8'));
      } catch { /* 展示无法读取的文件时保持任务执行能力。 */ }
    }
  }
  walk(workspace);
  return files;
}

export function workspaceChanges(before: Map<string, string | null>, after: Map<string, string>): WebChange[] {
  let remaining = 256 * 1024;
  const preview = (text: string | null): string | null => {
    if (text === null) return null;
    const available = Math.max(0, Math.min(8192, remaining));
    remaining -= Math.min(text.length, available);
    return text.length <= available ? text : text.slice(0, available) + '\n[差异预览已截断]';
  };
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap(path => {
    const previous = before.get(path) ?? null;
    const next = after.get(path) ?? null;
    return previous === next ? [] : [{ path, before: preview(previous), after: preview(next) }];
  }).slice(0, 200);
}

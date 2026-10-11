import { createHash } from 'crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from 'fs';
import { isAbsolute, join, relative, resolve, sep } from 'path';
import { TextDecoder } from 'util';
import { isSensitivePath, resolveWorkspacePath } from '../tools/path';
import type { WebDirectory, WebFile } from './types';
import { WebApiError } from './manager';

/** 浏览器只能读取项目源码，内部状态和凭据始终隐藏。 */
function protectedPath(path: string): boolean {
  return isSensitivePath(path) || path.replace(/\\/g, '/').split('/').some(part =>
    /^\.(?:env.*|agents|codex)$/i.test(part) || /^(?:credentials?|secrets?)(?:\.|$)/i.test(part));
}

function safePath(workspace: string, input: string): string {
  if (typeof input !== 'string' || input.length > 4096 || isAbsolute(input) || /^[a-zA-Z]:/.test(input)
    || input.includes('\\') || input.includes('\0') || protectedPath(input)) throw new WebApiError('文件路径无效或属于受保护内容', 403, 'INVALID_PATH');
  try {
    const canonical = resolveWorkspacePath(workspace, input || '.');
    const requested = resolve(workspace, input || '.');
    // 工具允许工作区内的符号链接；浏览器只读接口更严格，逐级拒绝链接。
    let cursor = workspace;
    for (const component of relative(workspace, requested).split(sep).filter(Boolean)) {
      cursor = join(cursor, component);
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) throw new Error('链接不能用于文件浏览');
    }
    return canonical;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new WebApiError('文件或目录不存在', 404, 'NOT_FOUND');
    throw new WebApiError('路径越界、链接或文件名称无效', 403, 'INVALID_PATH');
  }
}

export function listWorkspaceFiles(workspace: string, input = ''): WebDirectory {
  const directory = safePath(workspace, input);
  if (!lstatSync(directory).isDirectory()) throw new WebApiError('请求路径不是目录');
  const names = readdirSync(directory).sort();
  const entries: WebDirectory['entries'] = [];
  let examined = 0;
  for (const name of names) {
    if (++examined > 5000 || entries.length >= 500) break;
    const path = relative(workspace, join(directory, name)).replace(/\\/g, '/');
    if (protectedPath(path)) continue;
    try {
      const full = safePath(workspace, path);
      const stat = lstatSync(full);
      if (stat.isDirectory()) entries.push({ name, path, kind: 'directory' });
      else if (stat.isFile()) entries.push({ name, path, kind: 'file', size: stat.size });
    } catch { /* 目录中的链接和不可读文件不暴露给浏览器。 */ }
  }
  entries.sort((left, right) => Number(right.kind === 'directory') - Number(left.kind === 'directory') || left.name.localeCompare(right.name));
  return { path: relative(workspace, directory).replace(/\\/g, '/'), entries, truncated: examined < names.length || entries.length >= 500 };
}

export function readWorkspaceFile(workspace: string, input: string): WebFile {
  const path = safePath(workspace, input);
  const maxBytes = 256 * 1024;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink > 1) throw new WebApiError('只能读取普通文件', 403, 'INVALID_PATH');
    if (stat.size > maxBytes) throw new WebApiError('文件超过 256 KiB 预览上限', 413, 'FILE_TOO_LARGE');
    const bytes = readFileSync(descriptor);
    if (bytes.length > maxBytes) throw new WebApiError('文件超过 256 KiB 预览上限', 413, 'FILE_TOO_LARGE');
    if (bytes.includes(0)) throw new WebApiError('二进制文件不支持文本预览', 415, 'BINARY_FILE');
    let content: string;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new WebApiError('文件不是有效 UTF-8 文本', 415, 'BINARY_FILE'); }
    return { path: relative(workspace, path).replace(/\\/g, '/'), content, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

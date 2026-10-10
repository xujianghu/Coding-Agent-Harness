import { createHash } from 'crypto';
import { lstatSync, readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import { ActionResult, ToolDefinition, ToolExecutionContext } from '../core/types';
import { resolveWorkspacePath } from './path';

const EXCLUDED = new Set(['.git', '.harness', 'node_modules', 'dist', 'coverage', 'target']);
const MAX_FILE_BYTES = 1024 * 1024;

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`参数必须是 1 到 ${maximum} 的整数`);
  }
  return parsed;
}

function files(root: string, scope: string, context?: ToolExecutionContext): string[] {
  const result: string[] = [];
  let visited = 0;
  const walk = (candidate: string): void => {
    context?.signal?.throwIfAborted();
    if (++visited > 20000) throw new Error('目录超过搜索上限，请缩小 path 范围');
    const info = lstatSync(candidate);
    // 搜索不跟随链接，防止遍历进入工作区以外。
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      for (const entry of readdirSync(candidate).sort()) {
        if (EXCLUDED.has(entry) || /^\.env(?:\.|$)/.test(entry) || /\.key$/i.test(entry)) continue;
        const child = join(candidate, entry);
        try { resolveWorkspacePath(root, relative(root, child)); } catch { continue; }
        walk(child);
      }
    } else if (info.isFile() && info.size <= MAX_FILE_BYTES) {
      result.push(candidate);
    }
  };
  walk(resolveWorkspacePath(root, scope));
  return result;
}

function failure(error: unknown): ActionResult {
  return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
}

export function createSearchFilesTool(root: string): ToolDefinition {
  return {
    name: 'search_files',
    description: '按相对文件名的子串搜索文件，跳过依赖、凭据和符号链接',
    parameters: {
      query: { type: 'string', description: '文件名或相对路径的子串', required: true },
      path: { type: 'string', description: '搜索目录，默认工作区根目录', required: false },
      limit: { type: 'string', description: '最大结果数，默认 50，最大 200', required: false },
    },
    execute: async (params, context) => {
      try {
        const limit = positiveInteger(params.limit, 50, 200);
        const matches = files(root, params.path || '.', context)
          .map((file) => relative(root, file).replace(/\\/g, '/'))
          .filter((file) => file.toLowerCase().includes(params.query.toLowerCase()));
        return { success: true, output: JSON.stringify({ files: matches.slice(0, limit), truncated: matches.length > limit }) };
      } catch (error) { return failure(error); }
    },
  };
}

export function createSearchCodeTool(root: string): ToolDefinition {
  return {
    name: 'search_code',
    description: '按字面文本搜索代码，返回文件、行号和匹配内容',
    parameters: {
      query: { type: 'string', description: '需要定位的字面文本，不能为空', required: true },
      path: { type: 'string', description: '文件或目录，默认工作区根目录', required: false },
      limit: { type: 'string', description: '最大匹配数，默认 50，最大 200', required: false },
    },
    execute: async (params, context) => {
      try {
        if (!params.query) throw new Error('query 不能为空');
        const limit = positiveInteger(params.limit, 50, 200);
        const matches: Array<{ path: string; line: number; text: string }> = [];
        for (const file of files(root, params.path || '.', context)) {
          context?.signal?.throwIfAborted();
          const bytes = readFileSync(file);
          if (bytes.includes(0)) continue;
          const lines = bytes.toString('utf8').split(/\r?\n/);
          for (let index = 0; index < lines.length; index++) {
            if (lines[index].includes(params.query)) {
              matches.push({ path: relative(root, file).replace(/\\/g, '/'), line: index + 1, text: lines[index].slice(0, 1000) });
              if (matches.length > limit) return { success: true, output: JSON.stringify({ matches: matches.slice(0, limit), truncated: true }) };
            }
          }
        }
        return { success: true, output: JSON.stringify({ matches, truncated: false }) };
      } catch (error) { return failure(error); }
    },
  };
}

export function createReadFileLinesTool(root: string): ToolDefinition {
  return {
    name: 'read_file_lines',
    description: '按行读取文件并提供 SHA-256，供精确补丁校验使用',
    parameters: {
      path: { type: 'string', description: '相对工作区的文件路径', required: true },
      start_line: { type: 'string', description: '起始行号，从 1 开始，默认 1', required: false },
      end_line: { type: 'string', description: '结束行号，每次最多读取 400 行', required: false },
    },
    execute: async (params, context) => {
      try {
        context?.signal?.throwIfAborted();
        const file = resolveWorkspacePath(root, params.path);
        if (!lstatSync(file).isFile()) throw new Error('path 必须是普通文件');
        if (lstatSync(file).size > MAX_FILE_BYTES) throw new Error('文件超过 1 MiB 读取上限');
        const bytes = readFileSync(file);
        if (bytes.includes(0)) throw new Error('不支持读取二进制文件');
        const text = bytes.toString('utf8');
        const lineStarts = [0];
        for (const match of text.matchAll(/\r?\n/g)) lineStarts.push(match.index + match[0].length);
        const start = positiveInteger(params.start_line, 1, Number.MAX_SAFE_INTEGER);
        const end = positiveInteger(params.end_line, Math.min(start + 399, lineStarts.length), Number.MAX_SAFE_INTEGER);
        if (start > lineStarts.length || end < start || end - start >= 400) throw new Error('行范围无效或超过 400 行');
        const last = Math.min(end, lineStarts.length);
        const nextStart = lineStarts[last];
        const endOffset = nextStart === undefined ? text.length : nextStart - (text[nextStart - 2] === '\r' ? 2 : 1);
        return { success: true, output: JSON.stringify({ path: params.path, startLine: start, endLine: last, totalLines: lineStarts.length, sha256: createHash('sha256').update(bytes).digest('hex'), content: text.slice(lineStarts[start - 1], endOffset) }) };
      } catch (error) { return failure(error); }
    },
  };
}

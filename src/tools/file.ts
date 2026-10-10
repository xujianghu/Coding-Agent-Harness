import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import type { ToolDefinition, ActionResult } from '../core/types';
import { resolveWorkspacePath } from './path';

const MAX_FILE_SIZE = 1024 * 1024;

function failure(error: unknown): ActionResult {
  return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
}

export function createReadFileTool(workspaceRoot: string): ToolDefinition {
  return {
    name: 'read_file',
    description: '读取工作区文件，最多 1 MB',
    parameters: {
      path: { type: 'string', description: '相对于工作区根目录的文件路径', required: true },
    },
    execute: async (params): Promise<ActionResult> => {
      try {
        const filePath = resolveWorkspacePath(workspaceRoot, params.path);
        if (!existsSync(filePath)) return failure(`File not found: ${params.path}`);
        const stat = statSync(filePath);
        if (!stat.isFile()) return failure(`Path is a directory or non-regular file: ${params.path}`);
        if (stat.size > MAX_FILE_SIZE) return failure(`File size ${stat.size} exceeds max ${MAX_FILE_SIZE}`);
        return { success: true, output: readFileSync(filePath, 'utf-8') };
      } catch (error) {
        return failure(error);
      }
    },
  };
}

export function createWriteFileTool(workspaceRoot: string): ToolDefinition {
  return {
    name: 'write_file',
    description: '在工作区写入文件，最多 1 MB',
    parameters: {
      path: { type: 'string', description: '相对于工作区根目录的文件路径', required: true },
      content: { type: 'string', description: '要写入的文件内容', required: true },
    },
    execute: async (params): Promise<ActionResult> => {
      try {
        const filePath = resolveWorkspacePath(workspaceRoot, params.path);
        if (typeof params.content !== 'string') return failure('Content must be a string');
        const contentSize = Buffer.byteLength(params.content, 'utf-8');
        if (contentSize > MAX_FILE_SIZE) return failure(`Content size ${contentSize} exceeds max ${MAX_FILE_SIZE}`);
        mkdirSync(dirname(filePath), { recursive: true });
        // 创建目录后再次检查，保持执行边界与治理边界一致。
        const checkedPath = resolveWorkspacePath(workspaceRoot, params.path);
        if (existsSync(checkedPath) && !statSync(checkedPath).isFile()) return failure(`Path is a directory or non-regular file: ${params.path}`);
        writeFileSync(checkedPath, params.content, 'utf-8');
        return { success: true, output: 'File written' };
      } catch (error) {
        return failure(error);
      }
    },
  };
}

export function createDeleteFileTool(workspaceRoot: string): ToolDefinition {
  return {
    name: 'delete_file',
    description: '删除工作区中的普通文件',
    parameters: {
      path: { type: 'string', description: '相对于工作区根目录的文件路径', required: true },
    },
    execute: async (params): Promise<ActionResult> => {
      try {
        const filePath = resolveWorkspacePath(workspaceRoot, params.path);
        if (!existsSync(filePath)) return failure(`File not found: ${params.path}`);
        if (!statSync(filePath).isFile()) return failure(`Path is a directory or non-regular file: ${params.path}`);
        unlinkSync(filePath);
        return { success: true, output: 'File deleted' };
      } catch (error) {
        return failure(error);
      }
    },
  };
}

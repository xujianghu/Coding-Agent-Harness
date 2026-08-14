import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { resolve, join, dirname } from 'path';
import type { ToolDefinition, ActionResult } from '../core/types';

const MAX_FILE_SIZE = 1 * 1024 * 1024;

const SENSITIVE_PATH_PATTERNS = [
  /(^|[\\/])\.git[\\/]config$/,
  /(^|[\\/])\.harness[\\/]credentials[\\/]/,
  /(^|[\\/])\.env(?:[.][\w-]+)?$/,
  /[.]key$/,
];

function isSensitivePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function createReadFileTool(workspaceRoot: string): ToolDefinition {
  return {
    name: 'read_file',
    description: 'Reads a file from the workspace',
    parameters: {
      path: { type: 'string', description: 'Path relative to workspace root', required: true },
    },
    execute: async (params: Record<string, string>): Promise<ActionResult> => {
      const filePath = resolve(join(workspaceRoot, params.path));
      if (!filePath.startsWith(resolve(workspaceRoot))) {
        return { success: false, output: '', error: 'Path traversal detected' };
      }
      if (!existsSync(filePath)) {
        return { success: false, output: '', error: `File not found: ${params.path}` };
      }
      if (statSync(filePath).isDirectory()) {
        return { success: false, output: '', error: `Path is a directory: ${params.path}` };
      }
      const content = readFileSync(filePath, 'utf-8');
      return { success: true, output: content };
    },
  };
}

export function createWriteFileTool(workspaceRoot: string): ToolDefinition {
  return {
    name: 'write_file',
    description: 'Writes content to a file in the workspace',
    parameters: {
      path: { type: 'string', description: 'Path relative to workspace root', required: true },
      content: { type: 'string', description: 'Content to write', required: true },
    },
    execute: async (params: Record<string, string>): Promise<ActionResult> => {
      if (!params.path || params.path.trim() === '') {
        return { success: false, output: '', error: 'Path is required' };
      }
      if (isSensitivePath(params.path)) {
        return { success: false, output: '', error: `Sensitive path is blocked: ${params.path}` };
      }
      const contentSize = Buffer.byteLength(params.content, 'utf-8');
      if (contentSize > MAX_FILE_SIZE) {
        return { success: false, output: '', error: `Content size ${contentSize} exceeds max ${MAX_FILE_SIZE}` };
      }
      const filePath = resolve(join(workspaceRoot, params.path));
      if (!filePath.startsWith(resolve(workspaceRoot))) {
        return { success: false, output: '', error: 'Path traversal detected' };
      }
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, params.content, 'utf-8');
      return { success: true, output: 'File written' };
    },
  };
}
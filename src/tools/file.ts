import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join, dirname } from 'path';
import type { ToolDefinition, ActionResult } from '../core/types';

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
import { readdirSync, statSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import type { ToolDefinition, ActionResult } from '../core/types';

interface DirEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
}

export function createReadDirTool(workspaceRoot: string): ToolDefinition {
  return {
    name: 'read_dir',
    description: 'Lists the contents of a directory in the workspace',
    parameters: {
      path: { type: 'string', description: 'Path relative to workspace root', required: true },
    },
    execute: async (params: Record<string, string>): Promise<ActionResult> => {
      const dirPath = resolve(join(workspaceRoot, params.path));
      const resolvedRoot = resolve(workspaceRoot);
      if (!dirPath.startsWith(resolvedRoot) && dirPath !== resolvedRoot) {
        return { success: false, output: '', error: 'Path traversal detected' };
      }
      if (!existsSync(dirPath)) {
        return { success: false, output: '', error: `Directory not found: ${params.path}` };
      }
      const entries: DirEntry[] = readdirSync(dirPath).map((name) => {
        const fullPath = join(dirPath, name);
        const stat = statSync(fullPath);
        return {
          name,
          type: stat.isDirectory() ? 'directory' : 'file',
          size: stat.size,
        };
      });
      return { success: true, output: JSON.stringify(entries) };
    },
  };
}
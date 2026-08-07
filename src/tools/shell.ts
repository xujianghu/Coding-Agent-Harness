import { exec } from 'child_process';
import type { ToolDefinition, ActionResult } from '../core/types';

export function createShellTool(): ToolDefinition {
  return {
    name: 'shell_exec',
    description: '在 shell 中执行命令，120s 超时',
    parameters: {
      command: { type: 'string', description: '要执行的 shell 命令', required: true },
    },
    execute: async (params: Record<string, string>): Promise<ActionResult> => {
      const command = params.command;

      return new Promise((resolve) => {
        exec(command, { timeout: 120000 }, (error, stdout, stderr) => {
          const exitCode = error ? (error as any).code ?? 1 : 0;
          resolve({
            success: exitCode === 0,
            output: stdout.trim(),
            error: stderr.trim() || undefined,
            exitCode,
          });
        });
      });
    },
  };
}
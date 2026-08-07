import { exec } from 'child_process';
import type { ToolDefinition, ActionResult } from '../core/types';

function execCommand(command: string): Promise<ActionResult> {
  return new Promise((resolve) => {
    exec(command, { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          success: false,
          output: stdout,
          error: stderr || error.message,
          exitCode: error.code ?? 1,
        });
      } else {
        resolve({
          success: true,
          output: stdout,
          error: stderr,
          exitCode: 0,
        });
      }
    });
  });
}

export function createLintTool(): ToolDefinition {
  return {
    name: 'run_lint',
    description: '执行 lint 命令并返回结果',
    parameters: {
      command: { type: 'string', description: '要执行的 lint 命令', required: true },
    },
    execute: (params: Record<string, string>) => execCommand(params.command),
  };
}
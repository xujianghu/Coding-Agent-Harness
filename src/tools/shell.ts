import type { ToolDefinition } from '../core/types';
import { createCommandExecutor, type CommandExecutor } from './executor';

export function createShellTool(executor?: CommandExecutor): ToolDefinition {
  const commandExecutor = executor ?? createCommandExecutor({ mode: 'local', workspaceRoot: process.cwd() });
  return {
    name: 'shell_exec',
    description: '使用配置的执行器运行命令，本地模式不提供容器隔离',
    parameters: {
      command: { type: 'string', description: '要执行的命令', required: true },
    },
    execute: (params, context) => commandExecutor.execute(params.command, context),
  };
}

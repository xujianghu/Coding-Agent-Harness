import type { ToolDefinition } from '../core/types';
import { createCommandExecutor, type CommandExecutor } from './executor';

export function createLintTool(executor?: CommandExecutor): ToolDefinition {
  const commandExecutor = executor ?? createCommandExecutor({ mode: 'local', workspaceRoot: process.cwd() });
  return {
    name: 'run_lint',
    description: '使用配置的执行器运行代码检查并返回退出状态',
    parameters: {
      command: { type: 'string', description: '要执行的代码检查命令', required: true },
    },
    execute: (params, context) => commandExecutor.execute(params.command, context),
  };
}

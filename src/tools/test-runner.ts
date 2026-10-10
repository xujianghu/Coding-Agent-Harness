import type { ToolDefinition } from '../core/types';
import { createCommandExecutor, type CommandExecutor } from './executor';

export function createTestRunnerTool(executor?: CommandExecutor): ToolDefinition {
  const commandExecutor = executor ?? createCommandExecutor({ mode: 'local', workspaceRoot: process.cwd() });
  return {
    name: 'run_test',
    description: '使用配置的执行器运行测试并返回退出状态',
    parameters: {
      command: { type: 'string', description: '要执行的测试命令', required: true },
    },
    execute: (params, context) => commandExecutor.execute(params.command, context),
  };
}

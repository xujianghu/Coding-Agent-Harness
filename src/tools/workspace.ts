import { AgentConfig, ToolDefinition } from '../core/types';
import { createCommandExecutor } from './executor';
import { createReadFileTool, createWriteFileTool, createDeleteFileTool } from './file';
import { createShellTool } from './shell';
import { createTestRunnerTool } from './test-runner';
import { createLintTool } from './lint';
import { createSearchCodeTool, createSearchFilesTool, createReadFileLinesTool } from './search';
import { createApplyPatchTool } from './edit';

export function createWorkspaceTools(config: AgentConfig, workspaceRoot: string): ToolDefinition[] {
  const executor = createCommandExecutor({
    workspaceRoot,
    mode: config.execution?.mode ?? 'docker',
    dockerImage: config.execution?.image ?? 'node:22-alpine',
    timeoutMs: config.execution?.timeout ?? 120000,
  });
  return [
    createReadFileTool(workspaceRoot), createWriteFileTool(workspaceRoot), createDeleteFileTool(workspaceRoot),
    createShellTool(executor), createTestRunnerTool(executor), createLintTool(executor),
    createSearchFilesTool(workspaceRoot), createSearchCodeTool(workspaceRoot), createReadFileLinesTool(workspaceRoot),
    createApplyPatchTool(workspaceRoot),
  ];
}

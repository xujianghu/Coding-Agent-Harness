import { describe, it, expect } from 'vitest';
import { createLintTool } from '../../src/tools/lint';
import type { ToolDefinition } from '../../src/core/types';

describe('createLintTool', () => {
  let tool: ToolDefinition;

  it('应该返回 name=run_lint 的工具定义', () => {
    tool = createLintTool();
    expect(tool.name).toBe('run_lint');
    expect(tool.description).toBeTruthy();
    expect(tool.parameters).toHaveProperty('command');
    expect(tool.parameters.command.type).toBe('string');
    expect(tool.parameters.command.required).toBe(true);
  });

  it('执行成功命令时返回 success=true', async () => {
    tool = createLintTool();
    const result = await tool.execute({ command: 'echo hello' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
    expect(result.exitCode).toBe(0);
  });

  it('执行失败命令时返回 success=false', async () => {
    tool = createLintTool();
    const result = await tool.execute({ command: 'exit 1' });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});
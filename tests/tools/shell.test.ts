import { describe, it, expect } from 'vitest';
import { createShellTool } from '../../src/tools/shell';

describe('ShellTool', () => {
  it('执行 echo hello → 返回 success=true, output 含 "hello"', async () => {
    const tool = createShellTool();

    const result = await tool.execute({ command: 'echo hello' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
    expect(result.exitCode).toBe(0);
  });

  it('执行失败命令 → 返回 success=false', async () => {
    const tool = createShellTool();

    const result = await tool.execute({ command: 'exit 1' });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});
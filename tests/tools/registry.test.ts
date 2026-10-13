import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createToolRegistry } from '../../src/tools/registry';
import type { ToolDefinition, AgentAction } from '../../src/core/types';
import type { ToolRegistry } from '../../src/tools/registry';

function createMockTool(name: string): ToolDefinition {
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: {
      path: { type: 'string', description: '测试输入路径', required: true },
    },
    execute: async (params: Record<string, string>) => {
      return { success: true, output: `${name} executed with ${JSON.stringify(params)}` };
    },
  };
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createToolRegistry();
  });

  it('注册工具后 get 能获取到', () => {
    const tool = createMockTool('read_file');
    registry.register(tool);

    const result = registry.get('read_file');

    expect(result).toBeDefined();
    expect(result!.name).toBe('read_file');
    expect(result!.description).toBe('Mock tool: read_file');
  });

  it('list 返回所有已注册工具名称', () => {
    registry.register(createMockTool('read_file'));
    registry.register(createMockTool('write_file'));
    registry.register(createMockTool('shell_exec'));

    const tools = registry.list();

    expect(tools).toHaveLength(3);
    const names = tools.map((t) => t.name);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('shell_exec');
  });

  it('获取未注册工具返回 undefined', () => {
    const result = registry.get('non_existent');
    expect(result).toBeUndefined();
  });

  it('dispatch 动作到注册的工具 → 工具被执行并返回结果', async () => {
    const tool = createMockTool('read_file');
    registry.register(tool);

    const action: AgentAction = {
      type: 'read_file',
      params: { path: '/test/file.txt' },
    };

    const result = await registry.dispatch(action);

    expect(result.success).toBe(true);
    expect(result.output).toContain('read_file executed');
    expect(result.output).toContain('/test/file.txt');
  });

  it('dispatch 到未知工具 → 返回 error 信息', async () => {
    const action: AgentAction = {
      type: 'unknown_tool' as any,
      params: {},
    };

    const result = await registry.dispatch(action);

    expect(result.success).toBe(false);
    expect(result.output).toBe('');
    expect(result.error).toBe('Unknown tool: unknown_tool');
  });

  it('拒绝缺失参数、错误类型和未知参数，工具不执行', async () => {
    const tool = createMockTool('read_file');
    tool.execute = vi.fn();
    registry.register(tool);
    expect((await registry.dispatch({ type: 'read_file', params: {} })).error).toContain('Missing required');
    expect((await registry.dispatch({ type: 'read_file', params: { path: 42 } as never })).error).toContain('Invalid parameter type');
    expect((await registry.dispatch({ type: 'read_file', params: { path: 'file', extra: 'bad' } })).error).toContain('Unknown parameter');
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('传递 AbortSignal 并拒绝已经取消的执行', async () => {
    const tool = createMockTool('read_file');
    tool.execute = vi.fn().mockResolvedValue({ success: true, output: 'ok' });
    registry.register(tool);
    const controller = new AbortController();
    const action: AgentAction = { type: 'read_file', params: { path: 'file' } };
    await registry.dispatch(action, { signal: controller.signal });
    expect(tool.execute).toHaveBeenCalledWith(action.params, { signal: controller.signal });
    controller.abort();
    expect((await registry.dispatch(action, { signal: controller.signal })).success).toBe(false);
    expect(tool.execute).toHaveBeenCalledTimes(1);
  });
});

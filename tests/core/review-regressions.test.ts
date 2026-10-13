import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentLoop } from '../../src/core/loop';
import { createChatLoop } from '../../src/core/chat';
import { createMockLLM } from '../../src/llm/mock';
import { AgentConfig, LLMProvider, ToolDefinition } from '../../src/core/types';

const config: AgentConfig = {
  llm: { provider: 'openai', model: 'test', maxTokens: 100, temperature: 0 },
  agent: { maxTurns: 5, timeout: 5000, maxTotalTokens: 10000 },
  governance: { rulesFile: '', sandbox: { allowedPaths: [], allowedCommands: [] } },
  memory: { storagePath: '', maxConversationTurns: 20 },
};
const done = { content: '{"done":true,"summary":"完成"}' };
const tool = (execute = vi.fn(async () => ({ success: true, output: 'ok' }))): ToolDefinition => ({
  name: 'shell_exec', description: '命令', parameters: { command: { type: 'string', description: '命令', required: true } }, execute,
});
afterEach(() => vi.restoreAllMocks());

describe('审查问题的行为回归', () => {
  it('工具返回时发生取消，已返回的动作结果仍持久化且恢复不重放', async () => {
    const controller = new AbortController();
    const calls = [
      { id: 'first', name: 'shell_exec', arguments: { command: 'one' } },
      { id: 'second', name: 'shell_exec', arguments: { command: 'two' } },
    ];
    const executed: string[] = [];
    const firstTool: ToolDefinition = { ...tool(), execute: async params => {
      executed.push(params.command); controller.abort(new Error('取消')); return { success: true, output: '已执行' };
    } };
    const loop = createAgentLoop(config, createMockLLM([{ content: '', toolCalls: calls }]), [firstTool], {});
    await expect(loop.run('修复', { signal: controller.signal })).rejects.toThrow('取消');
    const saved = loop.exportCheckpoint()!;
    expect(saved.history.at(-1)?.result?.output).toBe('已执行');
    expect(saved.pendingToolCalls?.map(call => call.id)).toEqual(['second']);
    expect(saved.executionUncertain).toBeUndefined();
    const resumedTool: ToolDefinition = { ...tool(), execute: async params => { executed.push(params.command); return { success: true, output: 'ok' }; } };
    await createAgentLoop(config, createMockLLM([done]), [resumedTool], {}).run('修复', { checkpoint: saved });
    expect(executed).toEqual(['one', 'two']);
  });
  it('累计时间已耗尽的检查点不能执行剩余原生调用', async () => {
    const previous = await createAgentLoop(config, createMockLLM([done]), [], {}).run('修复');
    const call = { id: 'pending', name: 'shell_exec', arguments: { command: 'bad' } };
    const checkpoint = { ...previous.checkpoint, state: 'stopped' as const, elapsedMs: 5001, pendingToolCalls: [call] };
    const execute = vi.fn(async () => ({ success: true, output: '' }));
    await expect(createAgentLoop(config, createMockLLM([done]), [tool(execute)], {}).run('修复', { checkpoint })).rejects.toThrow('timed out');
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['approval', 'checkpoint'] as const)('同步%s跨过截止时间后禁止执行工具', async boundary => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const execute = vi.fn(async () => ({ success: true, output: '' }));
    const loop = createAgentLoop(config, createMockLLM([{ content: '{"action":{"type":"shell_exec","params":{"command":"bad"}}}' }]), [tool(execute)], {
      onAction: () => { if (boundary === 'approval') now = 5001; return { allowed: true }; },
      onCheckpoint: checkpoint => { if (boundary === 'checkpoint' && checkpoint.executionUncertain) now = 5001; },
    });
    await expect(loop.run('修复')).rejects.toThrow('timed out');
    expect(execute).not.toHaveBeenCalled();
  });

  it('取消审批后下次聊天补齐所有原生调用结果', async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => ({ success: true, output: '' }));
    const llm: LLMProvider = { name: 'test', complete: vi.fn().mockResolvedValueOnce({ content: '', toolCalls: [
      { id: 'a', name: 'shell_exec', arguments: { command: 'one' } },
      { id: 'b', name: 'shell_exec', arguments: { command: 'two' } },
    ] }).mockImplementationOnce(async messages => {
      expect(messages.filter(m => m.role === 'tool').map(m => m.toolCallId)).toEqual(['a', 'b']);
      expect(messages.filter(m => m.role === 'tool').every(m => m.content.includes('中断'))).toBe(true);
      return { content: '可以继续对话' };
    }) };
    const chat = createChatLoop(config, llm, [tool(execute)], { onAction: () => { controller.abort(new Error('取消')); } });
    await expect(chat.send('第一次', { signal: controller.signal })).rejects.toThrow('取消');
    expect(await chat.send('第二次')).toBe('可以继续对话');
    expect(execute).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { validateContextMessages } from '../../src/core/conversation-context';
import { createAgentLoop, trimConversationHistory } from '../../src/core/loop';
import { estimateContextTokens } from '../../src/core/runtime';
import { AgentConfig, LLMMessage, ToolDefinition } from '../../src/core/types';

const config = (): AgentConfig => ({
  llm: { provider: 'openai', model: 'test', maxTokens: 100, temperature: 0 },
  agent: { maxTurns: 10, timeout: 5000, maxTotalTokens: 20000 },
  governance: { rulesFile: '', sandbox: { allowedPaths: [], allowedCommands: [] } },
  memory: { storagePath: '', maxConversationTurns: 10 },
});
const done = { content: '{"done":true,"summary":"本轮完成"}', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
const call: LLMMessage = { role: 'assistant', content: '', toolCalls: [{ id: 'call_1_0', name: 'read_file', arguments: { path: 'a.ts' }, metadata: { thoughtSignature: 'signature' } }] };
const result: LLMMessage = { role: 'tool', content: '已读取', toolCallId: 'call_1_0' };

describe('连续会话上下文', () => {
  it('仅继承已完成消息，新轮预算与验收从零开始，不重放旧动作', async () => {
    const context: LLMMessage[] = [{ role: 'system', content: '旧提示词' }, { role: 'user', content: '上轮任务' }, call, result, { role: 'assistant', content: done.content }];
    const original = JSON.stringify(context);
    const execute = vi.fn(async () => ({ success: true, output: '' }));
    const tool: ToolDefinition = { name: 'read_file', description: '读取', parameters: {}, execute };
    const complete = vi.fn(async (messages: LLMMessage[]) => {
      expect(messages[0].content).not.toBe('旧提示词');
      expect(messages.filter(message => message.role === 'system')).toHaveLength(1);
      expect(messages.at(-1)).toEqual({ role: 'user', content: '追问任务' });
      expect(messages.find(message => message.role === 'tool')?.name).toBe('read_file');
      expect(messages.find(message => message.toolCalls)?.toolCalls?.[0].metadata).toEqual({ thoughtSignature: 'signature' });
      return done;
    });
    const run = await createAgentLoop(config(), { name: 'test', complete }, [tool], {}).run('追问任务', { contextMessages: context });
    expect(run.turns).toBe(1);
    expect(run.usage.totalTokens).toBe(15);
    expect(run.verified).toBe(false);
    expect(run.history).toEqual([{ role: 'user', content: '追问任务', timestamp: expect.any(Number) }]);
    expect(run.checkpoint.pendingToolCalls).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(context)).toBe(original);
  });

  it('预算裁剪完整旧调用组，仍把最新用户任务送给模型', async () => {
    const complete = vi.fn(async (_messages: LLMMessage[]) => done);
    const first = await createAgentLoop(config(), { name: 'test', complete }, [], {}).run('新任务', { contextMessages: [] });
    const options = config();
    options.memory.maxContextTokens = estimateContextTokens(first.checkpoint.messages.slice(0, 2)) + 10;
    const context = [{ role: 'user', content: '旧任务' }, call, { ...result, content: 'x'.repeat(20000) }];
    const constrained = vi.fn(async (messages: LLMMessage[]) => {
      expect(messages.map(message => message.role)).toEqual(['system', 'user']);
      expect(messages.at(-1)?.content).toBe('新任务');
      return done;
    });
    const run = await createAgentLoop(options, { name: 'test', complete: constrained }, [], {}).run('新任务', { contextMessages: context });
    expect(run.state).toBe('completed');
    expect(constrained).toHaveBeenCalledTimes(1);
  });

  it.each([
    [result], [call], [call, result, result], [call, { ...result, name: 'write_file' }],
    [call, { role: 'user', content: '插入消息' }, result],
    [{ ...call, toolCalls: [call.toolCalls![0], call.toolCalls![0]] }, result],
    [{ role: 'feedback', content: '无效角色' }],
  ].map(context => ({ context })))('非法历史在模型调用前拒绝：$context', async ({ context }) => {
    const complete = vi.fn(async () => done);
    const loop = createAgentLoop(config(), { name: 'test', complete }, [], {});
    await expect(loop.run('新任务', { contextMessages: context })).rejects.toThrow('会话上下文');
    expect(complete).not.toHaveBeenCalled();
    // 校验失败不能把循环永久锁为运行中。
    await expect(loop.run('新任务')).resolves.toHaveProperty('state', 'completed');
  });

  it('不同已完成调用组可以使用相同供应商调用 ID', () => {
    expect(validateContextMessages([call, result, call, result])).toHaveLength(4);
  });

  it('恢复沿用新任务位置与预算，不重复执行已返回的动作', async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => ({ success: true, output: '已执行' }));
    const tool: ToolDefinition = { name: 'read_file', description: '读取', parameters: { path: { type: 'string', description: '路径', required: true } }, execute };
    const complete = vi.fn(async () => ({ content: '', toolCalls: call.toolCalls, usage: done.usage }));
    const loop = createAgentLoop(config(), { name: 'test', complete }, [tool], { onTurn: () => controller.abort(new Error('中断')) });
    await expect(loop.run('新任务', { contextMessages: [{ role: 'user', content: '新任务' }, { role: 'assistant', content: '旧轮结束' }], signal: controller.signal })).rejects.toThrow('中断');
    const checkpoint = loop.exportCheckpoint()!;
    expect(checkpoint.taskMessageIndex).toBe(3);
    expect(checkpoint.executionUncertain).toBeUndefined();
    const resumed = await createAgentLoop(config(), { name: 'test', complete: vi.fn(async (messages: LLMMessage[]) => {
      expect(messages[3]).toEqual({ role: 'user', content: '新任务' });
      return done;
    }) }, [tool], {}).run('新任务', { checkpoint });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(resumed.turns).toBe(2);
    expect(resumed.usage.totalTokens).toBe(30);
    await expect(loop.run('新任务', { checkpoint, contextMessages: [] })).rejects.toThrow('不能同时使用');
    await expect(loop.run('新任务', { checkpoint: { ...checkpoint, taskMessageIndex: 0 } })).rejects.toThrow('位置无效');
  });

  it('裁剪保留最新任务与本轮验收失败反馈，不制造孤立工具结果', () => {
    const task = { role: 'user', content: '新任务' };
    const messages = [{ role: 'system', content: '' }, call, result, task, { role: 'assistant', content: done.content }, { role: 'user', content: '独立验收失败' }];
    const trimmed = trimConversationHistory(messages, 10, 1, task);
    expect(trimmed).toEqual([messages[0], task, messages[4], messages[5]]);
  });
});

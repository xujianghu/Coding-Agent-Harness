import { describe, expect, it, vi } from 'vitest';
import { createAgentLoop, trimConversationHistory } from '../../src/core/loop';
import { createMockLLM } from '../../src/llm/mock';
import { AgentConfig, AgentCheckpoint, LLMProvider, ToolDefinition } from '../../src/core/types';

const config = (): AgentConfig => ({
  llm: { provider: 'openai', model: 'test', maxTokens: 1000, temperature: 0 },
  agent: { maxTurns: 10, timeout: 5000, maxTotalTokens: 20000 },
  governance: { rulesFile: '', sandbox: { allowedPaths: [], allowedCommands: [] } },
  memory: { storagePath: '', maxConversationTurns: 10, maxToolOutputChars: 100 },
});
const done = { content: '{"done":true,"summary":"已修复"}', usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 } };
const tool = (execute = vi.fn(async () => ({ success: true, output: 'ok' }))): ToolDefinition => ({
  name: 'shell_exec', description: '命令', parameters: { command: { type: 'string', description: '命令', required: true } }, execute,
});

describe('Agent 运行时行为回归', () => {
  it('模型声明完成不会自行成为通过验收的成功结果', async () => {
    const result = await createAgentLoop(config(), createMockLLM([done]), [], {}).run('修复');
    expect(result.verified).toBe(false);
    expect(result.stopReason).toContain('unverified');
  });

  it('独立验收失败反馈给模型，修复后再次验收', async () => {
    const verifier = vi.fn().mockResolvedValueOnce({ success: false, output: 'expected 2, got 1' }).mockResolvedValueOnce({ success: true, output: 'passed' });
    const provider: LLMProvider = { name: 'test', complete: vi.fn()
      .mockResolvedValueOnce(done)
      .mockImplementationOnce(async messages => {
        expect(messages.at(-1)?.content).toContain('expected 2, got 1');
        return { content: '{"action":{"type":"shell_exec","params":{"command":"repair"}}}' };
      }).mockResolvedValueOnce(done) };
    const execute = vi.fn(async () => ({ success: true, output: 'fixed' }));
    const result = await createAgentLoop(config(), provider, [tool(execute)], { onVerify: verifier }).run('修复');
    expect(result.verified).toBe(true);
    expect(verifier).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('一轮中所有原生调用都执行，结果通过原ID对应', async () => {
    const provider: LLMProvider = { name: 'test', complete: vi.fn().mockResolvedValueOnce({ content: '', toolCalls: [
      { id: 'a', name: 'shell_exec', arguments: { command: 'first' } },
      { id: 'b', name: 'shell_exec', arguments: { command: 'second' } },
    ] }).mockImplementationOnce(async messages => {
      expect(messages.filter(m => m.role === 'tool').map(m => m.toolCallId)).toEqual(['a', 'b']);
      expect(messages.find(m => m.toolCalls)?.toolCalls?.map(c => c.id)).toEqual(['a', 'b']);
      return done;
    }) };
    const execute = vi.fn(async () => ({ success: true, output: 'ok' }));
    const result = await createAgentLoop(config(), provider, [tool(execute)], {}).run('修复');
    expect(execute.mock.calls).toHaveLength(2);
    expect(result.history.filter(t => t.action).map(t => t.action?.toolCallId)).toEqual(['a', 'b']);
  });

  it.each([{}, { command: 7 }, { command: 'ok', extra: 'bad' }])('参数不合法时禁止进入审批和执行：%j', async params => {
    const execute = vi.fn(async () => ({ success: true, output: 'bad' }));
    const onAction = vi.fn();
    const result = await createAgentLoop(config(), createMockLLM([
      { content: JSON.stringify({ action: { type: 'shell_exec', params } }) }, done,
    ]), [tool(execute)], { onAction }).run('修复');
    expect(execute).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
    expect(result.history[1].result?.success).toBe(false);
  });

  it('未知工具作为失败结果反馈，禁止调用任何工具', async () => {
    const execute = vi.fn(async () => ({ success: true, output: '' }));
    const result = await createAgentLoop(config(), createMockLLM([{ content: '{"action":{"type":"missing","params":{}}}' }, done]), [tool(execute)], {}).run('修复');
    expect(result.history[1].result?.error).toContain('Unknown tool');
    expect(execute).not.toHaveBeenCalled();
  });

  it('模型响应晚于超时也不会继续执行返回的动作', async () => {
    const options = config(); options.agent.timeout = 20;
    const execute = vi.fn(async () => ({ success: true, output: '' }));
    let requestSignal: AbortSignal | undefined;
    const provider: LLMProvider = { name: 'late', complete: (_messages, _tools, requestOptions) => {
      requestSignal = requestOptions?.signal;
      return new Promise(resolve => setTimeout(() => resolve({ content: '{"action":{"type":"shell_exec","params":{"command":"bad"}}}' }), 50));
    } };
    await expect(createAgentLoop(options, provider, [tool(execute)], {}).run('修复')).rejects.toThrow('Agent timed out');
    expect(requestSignal?.aborted).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(execute).not.toHaveBeenCalled();
  });

  it('工具接收取消信号，等待工具终止后才返回超时错误', async () => {
    const options = config(); options.agent.timeout = 20;
    let exited = false;
    const cancellable: ToolDefinition = { ...tool(), execute: (_params, context) => new Promise((resolve, reject) => {
      context!.signal!.addEventListener('abort', () => { exited = true; reject(context!.signal!.reason); }, { once: true });
    }) };
    await expect(createAgentLoop(options, createMockLLM([{ content: '{"action":{"type":"shell_exec","params":{"command":"wait"}}}' }]), [cancellable], {}).run('修复')).rejects.toThrow('Agent timed out');
    expect(exited).toBe(true);
  });

  it('在原生调用安全边界恢复，保留预算与轮数，不重复首个动作', async () => {
    const external = new AbortController();
    let saved: AgentCheckpoint | undefined;
    const executed: string[] = [];
    const commandTool: ToolDefinition = { ...tool(), execute: async params => { executed.push(params.command); return { success: true, output: params.command }; } };
    const firstLoop = createAgentLoop(config(), createMockLLM([{ content: '', usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 }, toolCalls: [
      { id: 'a', name: 'shell_exec', arguments: { command: 'first' } },
      { id: 'b', name: 'shell_exec', arguments: { command: 'second' } },
    ] }]), [commandTool], { onCheckpoint: checkpoint => {
      if (checkpoint.history.length === 2 && !checkpoint.executionUncertain && checkpoint.pendingToolCalls?.length === 1) {
        saved = checkpoint; external.abort(new Error('中断'));
      }
    } });
    await expect(firstLoop.run('修复', { signal: external.signal })).rejects.toThrow('中断');
    expect(executed).toEqual(['first']);
    expect(saved?.usage.totalTokens).toBe(110);
    const resumed = await createAgentLoop(config(), createMockLLM([done]), [commandTool], {}).run('修复', { checkpoint: saved });
    expect(executed).toEqual(['first', 'second']);
    expect(resumed.turns).toBe(2);
    expect(resumed.usage.totalTokens).toBe(220);
    expect(resumed.checkpoint.remainingTokens).toBe(19780);
  });

  it('结果未知的动作禁止恢复时自动重放', async () => {
    const completed = await createAgentLoop(config(), createMockLLM([done]), [], {}).run('修复');
    const checkpoint: AgentCheckpoint = { ...completed.checkpoint, executionUncertain: { type: 'shell_exec', params: { command: 'uncertain' } } };
    await expect(createAgentLoop(config(), createMockLLM([done]), [tool()], {}).run('修复', { checkpoint })).rejects.toThrow('禁止自动重放');
  });

  it('供应商用量达到总预算后停止，不执行该响应中的工具', async () => {
    const execute = vi.fn(async () => ({ success: true, output: '' }));
    const result = await createAgentLoop(config(), createMockLLM([{ content: '', toolCalls: [{ name: 'shell_exec', arguments: { command: 'bad' } }], usage: { promptTokens: 20000, completionTokens: 5, totalTokens: 20005 } }]), [tool(execute)], {}).run('修复');
    expect(result.stopReason).toBe('token budget exhausted');
    expect(result.usage.totalTokens).toBe(20005);
    expect(execute).not.toHaveBeenCalled();
  });

  it('工具长输出被截断，无供应商用量时显式标记估算', async () => {
    const result = await createAgentLoop(config(), createMockLLM([{ content: '{"action":{"type":"shell_exec","params":{"command":"long"}}}' }, done]), [tool(vi.fn(async () => ({ success: true, output: 'x'.repeat(1000) })))], {}).run('修复');
    expect(result.history[1].result?.output.length).toBeLessThanOrEqual(100);
    expect(result.history[1].result?.output).toContain('截断');
    expect(result.usageEstimated).toBe(true);
  });

  it('无法容纳必需上下文时停止，避免发送超预算请求', async () => {
    const options = config(); options.memory.maxContextTokens = 1;
    const provider = { name: 'test', complete: vi.fn(async () => done) };
    const result = await createAgentLoop(options, provider, [], {}).run('修复');
    expect(result.stopReason).toBe('context token budget exceeded');
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('裁剪完整调用组，保留全部结果与原调用', () => {
    const messages = [ { role: 'system', content: '' }, { role: 'user', content: 'task' },
      { role: 'assistant', content: 'old' }, { role: 'tool', content: 'old result', toolCallId: 'old' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'shell_exec', arguments: {} }, { id: 'b', name: 'shell_exec', arguments: {} }] },
      { role: 'tool', content: 'a', toolCallId: 'a' }, { role: 'tool', content: 'b', toolCallId: 'b' },
    ];
    const trimmed = trimConversationHistory(messages, 1);
    expect(trimmed).toHaveLength(5);
    expect(trimmed[2].toolCalls?.map(c => c.id)).toEqual(['a', 'b']);
  });
});

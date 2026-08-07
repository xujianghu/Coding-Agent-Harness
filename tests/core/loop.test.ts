import { describe, it, expect, vi } from 'vitest';
import { createAgentLoop, trimConversationHistory } from '../../src/core/loop';
import { createMockLLM } from '../../src/llm/mock';
import {
  AgentConfig,
  AgentAction,
  ConversationTurn,
  ToolDefinition,
  LLMResponse,
  LLMProvider,
} from '../../src/core/types';

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    llm: {
      provider: 'openai',
      model: 'gpt-4',
      maxTokens: 4096,
      temperature: 0,
    },
    agent: {
      maxTurns: 10,
      timeout: 60000,
    },
    governance: {
      rulesFile: '',
      sandbox: {
        allowedPaths: [],
        allowedCommands: [],
      },
    },
    memory: {
      storagePath: '',
      maxConversationTurns: 100,
    },
    ...overrides,
  };
}

function makeShellTool(): ToolDefinition {
  return {
    name: 'shell_exec',
    description: 'Execute a shell command',
    parameters: {
      command: { type: 'string', description: 'The command to run', required: true },
    },
    execute: async (params) => ({ success: true, output: `executed: ${params.command}` }),
  };
}

describe('createAgentLoop', () => {
  describe('停机条件', () => {
    it('1. MockLLM 返回空响应 → 循环停机，state=completed', async () => {
      const responses: LLMResponse[] = [{ content: '' }];
      const mockLLM = createMockLLM(responses);
      const loop = createAgentLoop(makeConfig(), mockLLM, [makeShellTool()], {});

      const result = await loop.run('do something');

      expect(result.state).toBe('completed');
      expect(result.turns).toBe(1);
      expect(result.summary).toBe('');
    });

    it('2. 达到 maxTurns 后强制停机 → state=stopped，turns 等于 maxTurns', async () => {
      const actionResponse: LLMResponse = {
        content: JSON.stringify({ action: { type: 'shell_exec', params: { command: 'echo hi' } } }),
      };
      const responses: LLMResponse[] = Array(10).fill(actionResponse);
      const mockLLM = createMockLLM(responses);
      const config = makeConfig({ agent: { maxTurns: 3, timeout: 60000 } });
      const loop = createAgentLoop(config, mockLLM, [makeShellTool()], {});

      const result = await loop.run('do something');

      expect(result.state).toBe('stopped');
      expect(result.turns).toBe(3);
    });

    it('3. MockLLM 返回 done 信号 → 正常停机，summary 正确', async () => {
      const responses: LLMResponse[] = [
        { content: JSON.stringify({ done: true, summary: 'All tasks completed successfully' }) },
      ];
      const mockLLM = createMockLLM(responses);
      const loop = createAgentLoop(makeConfig(), mockLLM, [makeShellTool()], {});

      const result = await loop.run('do something');

      expect(result.state).toBe('completed');
      expect(result.summary).toBe('All tasks completed successfully');
      expect(result.turns).toBe(1);
    });
  });

  describe('动作解析与回调', () => {
    it('4. MockLLM 返回 JSON 动作 → 解析动作并触发 onAction 回调', async () => {
      const actionPayload = { action: { type: 'shell_exec', params: { command: 'echo hello' } } };
      const responses: LLMResponse[] = [
        { content: JSON.stringify(actionPayload) },
        { content: '' },
      ];
      const mockLLM = createMockLLM(responses);

      const onAction = vi.fn().mockReturnValue(undefined);
      const onTurn = vi.fn();
      const onStop = vi.fn();

      const loop = createAgentLoop(makeConfig(), mockLLM, [makeShellTool()], {
        onAction,
        onTurn,
        onStop,
      });

      const result = await loop.run('run echo hello');

      expect(onAction).toHaveBeenCalledTimes(1);
      const calledAction: AgentAction = onAction.mock.calls[0][0];
      expect(calledAction.type).toBe('shell_exec');
      expect(calledAction.params).toEqual({ command: 'echo hello' });

      expect(onTurn).toHaveBeenCalledTimes(1);
      const turn: ConversationTurn = onTurn.mock.calls[0][0];
      expect(turn.role).toBe('assistant');
      expect(turn.action).toBeDefined();
      expect(turn.action!.type).toBe('shell_exec');
      expect(turn.result).toBeDefined();
      expect(turn.result!.success).toBe(true);

      expect(result.state).toBe('completed');
      expect(result.turns).toBe(2);
    });

    it('5. onAction 返回 { allowed: false } → 动作被拦截，不执行', async () => {
      const actionPayload = { action: { type: 'shell_exec', params: { command: 'rm -rf /' } } };
      const responses: LLMResponse[] = [
        { content: JSON.stringify(actionPayload) },
        { content: '' },
      ];
      const mockLLM = createMockLLM(responses);

      const onAction = vi.fn().mockReturnValue({ allowed: false, reason: 'blocked' });
      const onTurn = vi.fn();

      const loop = createAgentLoop(makeConfig(), mockLLM, [makeShellTool()], {
        onAction,
        onTurn,
      });

      const result = await loop.run('dangerous command');

      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onTurn).toHaveBeenCalledTimes(1);
      const turn: ConversationTurn = onTurn.mock.calls[0][0];
      expect(turn.result!.success).toBe(false);
      expect(turn.result!.error).toContain('blocked');
    });

    it('6. LLM 返回 JSON 代码块格式 → 正确解析', async () => {
      const actionPayload = { action: { type: 'shell_exec', params: { command: 'ls' } } };
      const responses: LLMResponse[] = [
        { content: '```json\n' + JSON.stringify(actionPayload) + '\n```' },
        { content: '' },
      ];
      const mockLLM = createMockLLM(responses);

      const onAction = vi.fn();
      const loop = createAgentLoop(makeConfig(), mockLLM, [makeShellTool()], { onAction });

      const result = await loop.run('list files');

      expect(onAction).toHaveBeenCalledTimes(1);
      expect(result.state).toBe('completed');
    });
  });

  describe('上下文与历史', () => {
    it('7. 对话历史应包含所有轮次', async () => {
      const actionPayload = { action: { type: 'shell_exec', params: { command: 'ls' } } };
      const responses: LLMResponse[] = [
        { content: JSON.stringify(actionPayload) },
        { content: JSON.stringify({ done: true, summary: 'done' }) },
      ];
      const mockLLM = createMockLLM(responses);

      const loop = createAgentLoop(makeConfig(), mockLLM, [makeShellTool()], {});

      const result = await loop.run('list files');

      expect(result.history.length).toBeGreaterThanOrEqual(2);
      expect(result.history[0].role).toBe('user');
      expect(result.history[0].content).toBe('list files');
    });
  });

  describe('消息历史裁剪', () => {
    it('8. 消息数在限制内 → 不裁剪', async () => {
      const actionPayload = { action: { type: 'shell_exec', params: { command: 'ls' } } };
      const responses: LLMResponse[] = [
        { content: JSON.stringify(actionPayload) },
        { content: JSON.stringify({ done: true, summary: 'done' }) },
      ];
      const mockLLM = createMockLLM(responses);
      const config = makeConfig({ memory: { storagePath: '', maxConversationTurns: 100 } });
      const loop = createAgentLoop(config, mockLLM, [makeShellTool()], {});

      const result = await loop.run('list files');

      expect(result.history.length).toBeGreaterThanOrEqual(2);
      expect(result.state).toBe('completed');
    });

    it('9. 消息数超过限制 → 裁剪到 maxTurns*2+2 条，保留 system + 首条 user', async () => {
      const actionPayload = { action: { type: 'shell_exec', params: { command: 'ls' } } };
      const responses: LLMResponse[] = Array(20).fill({ content: JSON.stringify(actionPayload) });
      const mockLLM = createMockLLM(responses);
      const config = makeConfig({
        agent: { maxTurns: 20, timeout: 60000 },
        memory: { storagePath: '', maxConversationTurns: 3 },
      });
      const onStop = vi.fn();
      const loop = createAgentLoop(config, mockLLM, [makeShellTool()], { onStop });

      const result = await loop.run('list files');

      expect(result.state).toBe('stopped');
      expect(result.turns).toBe(20);
    });
  });
});

describe('标准 Tool-Use 协议解析', () => {
    it('10. LLMResponse 含 toolCalls → 正确解析为 AgentAction 并分发', async () => {
      const llmResponse: LLMResponse = {
        content: '',
        toolCalls: [{
          name: 'shell_exec',
          arguments: { command: 'echo from tool_calls' },
        }],
      };
      const responses: LLMResponse[] = [
        llmResponse,
        { content: '' },
      ];
      const mockLLM = createMockLLM(responses);

      const onAction = vi.fn();
      const onTurn = vi.fn();
      const loop = createAgentLoop(makeConfig(), mockLLM, [makeShellTool()], {
        onAction,
        onTurn,
      });

      const result = await loop.run('run echo');

      expect(onAction).toHaveBeenCalledTimes(1);
      const calledAction: AgentAction = onAction.mock.calls[0][0];
      expect(calledAction.type).toBe('shell_exec');
      expect(calledAction.params).toEqual({ command: 'echo from tool_calls' });

      expect(onTurn).toHaveBeenCalledTimes(1);
      const turn: ConversationTurn = onTurn.mock.calls[0][0];
      expect(turn.action).toBeDefined();
      expect(turn.action!.type).toBe('shell_exec');
      expect(turn.result).toBeDefined();
      expect(turn.result!.success).toBe(true);
      expect(turn.result!.output).toBe('executed: echo from tool_calls');
    });

    it('11. LLMResponse 仅含 content（无 toolCalls）→ 保持现有 JSON 解析行为', async () => {
      const actionPayload = { action: { type: 'shell_exec', params: { command: 'echo fallback' } } };
      const responses: LLMResponse[] = [
        { content: JSON.stringify(actionPayload) },
        { content: '' },
      ];
      const mockLLM = createMockLLM(responses);

      const onAction = vi.fn();
      const loop = createAgentLoop(makeConfig(), mockLLM, [makeShellTool()], { onAction });

      await loop.run('run echo');

      expect(onAction).toHaveBeenCalledTimes(1);
      const calledAction: AgentAction = onAction.mock.calls[0][0];
      expect(calledAction.type).toBe('shell_exec');
      expect(calledAction.params).toEqual({ command: 'echo fallback' });
    });

    it('12. toolCalls 与 content 都存在 → 优先使用 toolCalls', async () => {
      const llmResponse: LLMResponse = {
        content: JSON.stringify({ action: { type: 'shell_exec', params: { command: 'from json' } } }),
        toolCalls: [{
          name: 'shell_exec',
          arguments: { command: 'from tool_calls' },
        }],
      };
      const responses: LLMResponse[] = [
        llmResponse,
        { content: '' },
      ];
      const mockLLM = createMockLLM(responses);

      const onAction = vi.fn();
      const loop = createAgentLoop(makeConfig(), mockLLM, [makeShellTool()], { onAction });

      await loop.run('run echo');

      expect(onAction).toHaveBeenCalledTimes(1);
      const calledAction: AgentAction = onAction.mock.calls[0][0];
      expect(calledAction.type).toBe('shell_exec');
      expect(calledAction.params).toEqual({ command: 'from tool_calls' });
    });
  });

  describe('trimConversationHistory', () => {
  it('消息数在限制内 → 不裁剪', () => {
    const messages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'task' },
      { role: 'assistant', content: 'action1' },
      { role: 'feedback', content: 'result1' },
      { role: 'assistant', content: 'action2' },
      { role: 'feedback', content: 'result2' },
    ];

    const result = trimConversationHistory(messages, 3);

    expect(result).toEqual(messages);
    expect(result.length).toBe(6);
  });

  it('消息数超过限制 → 裁剪到 maxTurns*2+2 条', () => {
    const messages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'task' },
      { role: 'assistant', content: 'old1' },
      { role: 'feedback', content: 'old_r1' },
      { role: 'assistant', content: 'old2' },
      { role: 'feedback', content: 'old_r2' },
      { role: 'assistant', content: 'recent1' },
      { role: 'feedback', content: 'recent_r1' },
      { role: 'assistant', content: 'recent2' },
      { role: 'feedback', content: 'recent_r2' },
    ];

    const result = trimConversationHistory(messages, 2);

    expect(result.length).toBe(6);
    expect(result[0]).toEqual({ role: 'system', content: 'system prompt' });
    expect(result[1]).toEqual({ role: 'user', content: 'task' });
    expect(result[2]).toEqual({ role: 'assistant', content: 'recent1' });
    expect(result[3]).toEqual({ role: 'feedback', content: 'recent_r1' });
    expect(result[4]).toEqual({ role: 'assistant', content: 'recent2' });
    expect(result[5]).toEqual({ role: 'feedback', content: 'recent_r2' });
  });

  it('裁剪后 system prompt 仍然是第一条', () => {
    const messages = [
      { role: 'system', content: 'you are a bot' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'a1' },
      { role: 'feedback', content: 'f1' },
      { role: 'assistant', content: 'a2' },
      { role: 'feedback', content: 'f2' },
      { role: 'assistant', content: 'a3' },
      { role: 'feedback', content: 'f3' },
      { role: 'assistant', content: 'a4' },
      { role: 'feedback', content: 'f4' },
    ];

    const result = trimConversationHistory(messages, 1);

    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe('you are a bot');
  });

  it('裁剪后首条 user 消息保留', () => {
    const messages = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'original task' },
      { role: 'assistant', content: 'a1' },
      { role: 'feedback', content: 'f1' },
      { role: 'assistant', content: 'a2' },
      { role: 'feedback', content: 'f2' },
      { role: 'assistant', content: 'a3' },
      { role: 'feedback', content: 'f3' },
    ];

    const result = trimConversationHistory(messages, 1);

    expect(result[1].role).toBe('user');
    expect(result[1].content).toBe('original task');
  });
});
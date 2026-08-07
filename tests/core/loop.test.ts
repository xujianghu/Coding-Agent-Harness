import { describe, it, expect, vi } from 'vitest';
import { createAgentLoop } from '../../src/core/loop';
import { createMockLLM } from '../../src/llm/mock';
import {
  AgentConfig,
  AgentAction,
  ConversationTurn,
  ToolDefinition,
  LLMResponse,
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
});
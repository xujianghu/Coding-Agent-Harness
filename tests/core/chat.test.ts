import { describe, it, expect, vi } from 'vitest';
import { createChatLoop } from '../../src/core/chat';
import { createMockLLM } from '../../src/llm/mock';
import {
  AgentConfig,
  ToolDefinition,
  LLMResponse,
  LLMProvider,
} from '../../src/core/types';

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    llm: { provider: 'openai', model: 'gpt-4', maxTokens: 4096, temperature: 0 },
    agent: { maxTurns: 10, timeout: 60000 },
    governance: { rulesFile: '', sandbox: { allowedPaths: [], allowedCommands: [] } },
    memory: { storagePath: '', maxConversationTurns: 100 },
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

describe('createChatLoop', () => {
  it('LLM 返回纯文本 → send 直接返回该文本', async () => {
    const responses: LLMResponse[] = [{ content: 'Hello, how can I help?' }];
    const mockLLM = createMockLLM(responses);
    const chat = createChatLoop(makeConfig(), mockLLM, [makeShellTool()], {});

    const reply = await chat.send('hi');

    expect(reply).toBe('Hello, how can I help?');
  });

  it('LLM 返回 action → 执行工具 → 回灌结果 → 最终返回文本', async () => {
    const responses: LLMResponse[] = [
      { content: JSON.stringify({ action: { type: 'shell_exec', params: { command: 'ls' } } }) },
      { content: 'Done, I ran ls.' },
    ];
    const mockLLM = createMockLLM(responses);

    let executedCommand = '';
    const tool: ToolDefinition = {
      ...makeShellTool(),
      execute: async (params) => {
        executedCommand = params.command;
        return { success: true, output: `executed: ${params.command}` };
      },
    };

    const chat = createChatLoop(makeConfig(), mockLLM, [tool], {});

    const reply = await chat.send('run ls');

    expect(executedCommand).toBe('ls');
    expect(reply).toBe('Done, I ran ls.');
  });

  it('LLM 连续返回多个 action → 依次执行后返回文本', async () => {
    const responses: LLMResponse[] = [
      { content: JSON.stringify({ action: { type: 'shell_exec', params: { command: 'a' } } }) },
      { content: JSON.stringify({ action: { type: 'shell_exec', params: { command: 'b' } } }) },
      { content: 'All done.' },
    ];
    const mockLLM = createMockLLM(responses);

    const executed: string[] = [];
    const tool: ToolDefinition = {
      ...makeShellTool(),
      execute: async (params) => {
        executed.push(params.command);
        return { success: true, output: params.command };
      },
    };

    const chat = createChatLoop(makeConfig(), mockLLM, [tool], {});

    const reply = await chat.send('run two commands');

    expect(executed).toEqual(['a', 'b']);
    expect(reply).toBe('All done.');
  });

  it('LLM 返回 done 信号 → send 返回 summary', async () => {
    const responses: LLMResponse[] = [
      { content: JSON.stringify({ done: true, summary: 'Task finished' }) },
    ];
    const mockLLM = createMockLLM(responses);
    const chat = createChatLoop(makeConfig(), mockLLM, [makeShellTool()], {});

    const reply = await chat.send('do something');

    expect(reply).toBe('Task finished');
  });

  it('onAction 返回 allowed:false → 回灌 blocked，LLM 继续回复', async () => {
    const responses: LLMResponse[] = [
      { content: JSON.stringify({ action: { type: 'shell_exec', params: { command: 'rm -rf /' } } }) },
      { content: 'I cannot do that.' },
    ];
    const mockLLM = createMockLLM(responses);
    const onAction = vi.fn().mockReturnValue({ allowed: false, reason: 'blocked' });

    const chat = createChatLoop(makeConfig(), mockLLM, [makeShellTool()], { onAction });

    const reply = await chat.send('delete everything');

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(reply).toBe('I cannot do that.');
  });

  it('跨轮次累积上下文：第二轮 LLM 能看到第一轮的消息', async () => {
    const captured: Array<Array<{ role: string; content: string }>> = [];
    const recordingLLM: LLMProvider = {
      name: 'recording',
      complete: async (messages) => {
        captured.push(messages);
        if (captured.length === 1) {
          return { content: 'First reply.' };
        }
        return { content: 'Second reply.' };
      },
    };

    const chat = createChatLoop(makeConfig(), recordingLLM, [makeShellTool()], {});

    await chat.send('first question');
    await chat.send('second question');

    const secondRoundRoles = captured[1].map((m) => m.role);
    expect(secondRoundRoles).toContain('user');
    expect(secondRoundRoles).toContain('assistant');
    // 第二轮消息应包含第一轮的提问与回复
    expect(captured[1].some((m) => m.content === 'first question')).toBe(true);
    expect(captured[1].some((m) => m.content === 'First reply.')).toBe(true);
  });

  it('单轮动作数超过 maxTurns → 强制结束并返回提示', async () => {
    const actionPayload = { action: { type: 'shell_exec', params: { command: 'loop' } } };
    const responses: LLMResponse[] = Array(5).fill({ content: JSON.stringify(actionPayload) });
    const mockLLM = createMockLLM(responses);
    const config = makeConfig({ agent: { maxTurns: 2, timeout: 60000 } });

    const chat = createChatLoop(config, mockLLM, [makeShellTool()], {});

    const reply = await chat.send('loop forever');

    expect(reply).toContain('maximum number of actions');
  });
});

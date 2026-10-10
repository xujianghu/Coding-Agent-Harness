import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate, mockConstructor } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockConstructor: vi.fn(),
}));

vi.mock('openai', () => ({
  default: mockConstructor.mockImplementation(function () { return {
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }; }),
}));

import { createOpenAIProvider } from '../../src/llm/openai';
import { LLMProvider } from '../../src/core/types';

describe('createOpenAIProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a provider with the correct name', () => {
    const provider: LLMProvider = createOpenAIProvider({
      apiKey: 'test-key',
      model: 'gpt-4o',
    });
    expect(provider.name).toBe('openai');
  });

  it('should pass baseURL to OpenAI SDK when baseUrl is provided', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Hi from DeepSeek' } }],
    });

    const provider: LLMProvider = createOpenAIProvider({
      apiKey: 'test-key',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com',
    });

    await provider.complete([{ role: 'user', content: 'Hello' }]);

    expect(mockConstructor).toHaveBeenCalledWith({
      apiKey: 'test-key',
      baseURL: 'https://api.deepseek.com',
    });
  });

  it('should pass baseURL as undefined when baseUrl is omitted', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Hi from OpenAI' } }],
    });

    const provider: LLMProvider = createOpenAIProvider({
      apiKey: 'test-key',
      model: 'gpt-4o',
    });

    await provider.complete([{ role: 'user', content: 'Hello' }]);

    expect(mockConstructor).toHaveBeenCalledWith({
      apiKey: 'test-key',
      baseURL: undefined,
    });
  });

  it('should call OpenAI SDK with correct parameters', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Hello from OpenAI' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const provider: LLMProvider = createOpenAIProvider({
      apiKey: 'test-key',
      model: 'gpt-4o',
    });

    const result = await provider.complete([
      { role: 'user', content: 'Hello' },
    ]);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.content).toBe('Hello from OpenAI');
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it('should handle missing usage info', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'No usage' } }],
    });

    const provider: LLMProvider = createOpenAIProvider({
      apiKey: 'test-key',
      model: 'gpt-4o',
    });

    const result = await provider.complete([
      { role: 'user', content: 'Hi' },
    ]);

    expect(result.content).toBe('No usage');
    expect(result.usage).toBeUndefined();
  });

  it('should handle multiple messages', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Response' } }],
      usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
    });

    const provider: LLMProvider = createOpenAIProvider({
      apiKey: 'test-key',
      model: 'gpt-4o',
    });

    await provider.complete([
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello' },
    ]);

    expect(mockCreate).toHaveBeenCalledWith({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
      ],
    });
  });

  it('should extract tool_calls from OpenAI response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: '',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: '{"path":"/src/app.ts"}',
            },
          }, {
            id: 'call_2',
            type: 'function',
            function: {
              name: 'shell_exec',
              arguments: '{"command":"echo hello"}',
            },
          }],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const provider: LLMProvider = createOpenAIProvider({
      apiKey: 'test-key',
      model: 'gpt-4o',
    });

    const result = await provider.complete([
      { role: 'user', content: 'Read the file' },
    ]);

    expect(result.content).toBe('');
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBe(2);
    expect(result.toolCalls![0]).toEqual({
      id: 'call_1',
      name: 'read_file',
      arguments: { path: '/src/app.ts' },
    });
    expect(result.toolCalls![1]).toEqual({
      id: 'call_2',
      name: 'shell_exec',
      arguments: { command: 'echo hello' },
    });
  });

  it('should handle response without tool_calls', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'No tools here' } }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    });

    const provider: LLMProvider = createOpenAIProvider({
      apiKey: 'test-key',
      model: 'gpt-4o',
    });

    const result = await provider.complete([
      { role: 'user', content: 'Hi' },
    ]);

    expect(result.content).toBe('No tools here');
    expect(result.toolCalls).toBeUndefined();
  });

  it('原生工具调用与结果回传，并传递取消与生成配置', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: 'ok' } }] });
    const signal = new AbortController().signal;
    await createOpenAIProvider({ apiKey: 'test', model: 'test' }).complete([
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_a', name: 'read_file', arguments: { path: 'a.ts' } }] },
      { role: 'tool', content: '{"success":true,"output":"file"}', toolCallId: 'call_a', name: 'read_file' },
    ], [], { signal, maxTokens: 99, temperature: 0.2 });
    expect(mockCreate).toHaveBeenCalledWith({ model: 'test', max_tokens: 99, temperature: 0.2, messages: [
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }] },
      { role: 'tool', content: '{"success":true,"output":"file"}', tool_call_id: 'call_a' },
    ] }, { signal });
  });

  describe('completeStream', () => {
    it('should call onToken for each delta chunk', async () => {
      const streamChunks = [
        { choices: [{ delta: { content: 'H' } }] },
        { choices: [{ delta: { content: 'e' } }] },
        { choices: [{ delta: { content: 'l' } }] },
        { choices: [{ delta: { content: 'l' } }] },
        { choices: [{ delta: { content: 'o' } }] },
        {
          choices: [{ delta: {} }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      ];

      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of streamChunks) {
            yield chunk;
          }
        },
      };
      mockCreate.mockResolvedValueOnce(asyncIterable);

      const provider: LLMProvider = createOpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4o',
      });

      const tokens: string[] = [];
      const result = await provider.completeStream!(
        [{ role: 'user', content: 'Hello' }],
        (token) => tokens.push(token)
      );

      expect(tokens).toEqual(['H', 'e', 'l', 'l', 'o']);
      expect(result.content).toBe('Hello');
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it('should pass stream: true to OpenAI SDK', async () => {
      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'OK' } }] };
          yield { choices: [{ delta: {} }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } };
        },
      };
      mockCreate.mockResolvedValueOnce(asyncIterable);

      const provider: LLMProvider = createOpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4o',
      });

      await provider.completeStream!(
        [{ role: 'user', content: 'Hi' }],
        () => {}
      );

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: true,
        stream_options: { include_usage: true },
      });
    });

    it('should handle stream without usage info', async () => {
      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          yield { choices: [{ delta: { content: 'No usage' } }] };
          yield { choices: [{ delta: {} }] };
        },
      };
      mockCreate.mockResolvedValueOnce(asyncIterable);

      const provider: LLMProvider = createOpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4o',
      });

      const tokens: string[] = [];
      const result = await provider.completeStream!(
        [{ role: 'user', content: 'Hi' }],
        (token) => tokens.push(token)
      );

      expect(result.content).toBe('No usage');
      expect(result.usage).toBeUndefined();
    });
  });
});

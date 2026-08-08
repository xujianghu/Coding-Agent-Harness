import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: mockCreate,
    },
  })),
}));

import { createAnthropicProvider } from '../../src/llm/anthropic';
import { LLMProvider } from '../../src/core/types';

describe('createAnthropicProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a provider with the correct name', () => {
    const provider: LLMProvider = createAnthropicProvider({
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });
    expect(provider.name).toBe('anthropic');
  });

  it('should extract system message and pass it separately', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Hello from Anthropic' }],
      usage: { input_tokens: 20, output_tokens: 10 },
    });

    const provider: LLMProvider = createAnthropicProvider({
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });

    await provider.complete([
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello' },
    ]);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({
      model: 'claude-sonnet-4-20250514',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 4096,
    });
  });

  it('should handle messages without system message', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Response' }],
      usage: { input_tokens: 5, output_tokens: 3 },
    });

    const provider: LLMProvider = createAnthropicProvider({
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });

    await provider.complete([{ role: 'user', content: 'Hello' }]);

    expect(mockCreate).toHaveBeenCalledWith({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 4096,
    });
  });

  it('should return correct LLMResponse format', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Anthropic response' }],
      usage: { input_tokens: 15, output_tokens: 8 },
    });

    const provider: LLMProvider = createAnthropicProvider({
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });

    const result = await provider.complete([
      { role: 'user', content: 'Hi' },
    ]);

    expect(result.content).toBe('Anthropic response');
    expect(result.usage).toEqual({
      promptTokens: 15,
      completionTokens: 8,
      totalTokens: 23,
    });
  });

  it('should handle missing usage', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'No usage' }],
    });

    const provider: LLMProvider = createAnthropicProvider({
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });

    const result = await provider.complete([
      { role: 'user', content: 'Hi' },
    ]);

    expect(result.content).toBe('No usage');
    expect(result.usage).toBeUndefined();
  });

  it('should extract tool_use blocks from Anthropic response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'Let me read that file.' },
        { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: '/src/app.ts' } },
        { type: 'tool_use', id: 'toolu_2', name: 'shell_exec', input: { command: 'echo hello' } },
      ],
      usage: { input_tokens: 15, output_tokens: 8 },
    });

    const provider: LLMProvider = createAnthropicProvider({
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });

    const result = await provider.complete([
      { role: 'user', content: 'Read the file' },
    ]);

    expect(result.content).toBe('Let me read that file.');
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBe(2);
    expect(result.toolCalls![0]).toEqual({
      name: 'read_file',
      arguments: { path: '/src/app.ts' },
    });
    expect(result.toolCalls![1]).toEqual({
      name: 'shell_exec',
      arguments: { command: 'echo hello' },
    });
  });

  it('should handle response without tool_use blocks', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'No tools here' }],
      usage: { input_tokens: 5, output_tokens: 3 },
    });

    const provider: LLMProvider = createAnthropicProvider({
      apiKey: 'test-key',
      model: 'claude-sonnet-4-20250514',
    });

    const result = await provider.complete([
      { role: 'user', content: 'Hi' },
    ]);

    expect(result.content).toBe('No tools here');
    expect(result.toolCalls).toBeUndefined();
  });

  describe('completeStream', () => {
    it('should call onToken for each text_delta event', async () => {
      const streamEvents = [
        { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 5 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'H' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'e' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'l' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'l' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'o' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
        { type: 'message_stop' },
      ];

      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          for (const event of streamEvents) {
            yield event;
          }
        },
      };
      mockCreate.mockResolvedValueOnce(asyncIterable);

      const provider: LLMProvider = createAnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-sonnet-4-20250514',
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

    it('should pass stream: true to Anthropic SDK', async () => {
      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'message_start', message: { usage: { input_tokens: 2, output_tokens: 1 } } };
          yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } };
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } };
          yield { type: 'message_stop' };
        },
      };
      mockCreate.mockResolvedValueOnce(asyncIterable);

      const provider: LLMProvider = createAnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-sonnet-4-20250514',
      });

      await provider.completeStream!(
        [{ role: 'system', content: 'Be helpful' }, { role: 'user', content: 'Hi' }],
        () => {}
      );

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'claude-sonnet-4-20250514',
        system: 'Be helpful',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 4096,
        stream: true,
      });
    });

    it('should handle stream without usage info', async () => {
      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'No usage' } };
          yield { type: 'message_stop' };
        },
      };
      mockCreate.mockResolvedValueOnce(asyncIterable);

      const provider: LLMProvider = createAnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-sonnet-4-20250514',
      });

      const tokens: string[] = [];
      const result = await provider.completeStream!(
        [{ role: 'user', content: 'Hi' }],
        (token) => tokens.push(token)
      );

      expect(result.content).toBe('No usage');
      expect(result.usage).toBeUndefined();
    });

    it('should handle messages without system message in stream', async () => {
      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 3 } } };
          yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Response' } };
          yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } };
          yield { type: 'message_stop' };
        },
      };
      mockCreate.mockResolvedValueOnce(asyncIterable);

      const provider: LLMProvider = createAnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-sonnet-4-20250514',
      });

      await provider.completeStream!(
        [{ role: 'user', content: 'Hello' }],
        () => {}
      );

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 4096,
        stream: true,
      });
    });
  });
});
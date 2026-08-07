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
});
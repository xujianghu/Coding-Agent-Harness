import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
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
});
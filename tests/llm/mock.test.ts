import { describe, it, expect } from 'vitest';
import { createMockLLM } from '../../src/llm/mock';
import { LLMResponse, LLMProvider } from '../../src/core/types';

describe('createMockLLM', () => {
  it('should return preset responses in order', async () => {
    const responses: LLMResponse[] = [
      { content: 'Hello', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
      { content: 'World', usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 } },
    ];

    const mock: LLMProvider = createMockLLM(responses);

    const result1 = await mock.complete([{ role: 'user', content: 'Hi' }]);
    expect(result1.content).toBe('Hello');
    expect(result1.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });

    const result2 = await mock.complete([{ role: 'user', content: 'Again' }]);
    expect(result2.content).toBe('World');
    expect(result2.usage).toEqual({ promptTokens: 20, completionTokens: 10, totalTokens: 30 });
  });

  it('should return empty string after all responses are exhausted', async () => {
    const responses: LLMResponse[] = [
      { content: 'Only one' },
    ];

    const mock: LLMProvider = createMockLLM(responses);

    const result1 = await mock.complete([{ role: 'user', content: 'Hi' }]);
    expect(result1.content).toBe('Only one');

    const result2 = await mock.complete([{ role: 'user', content: 'Again' }]);
    expect(result2.content).toBe('');
  });

  it('should have the correct provider name', () => {
    const mock: LLMProvider = createMockLLM([]);
    expect(mock.name).toBe('mock');
  });

  it('should handle empty responses array', async () => {
    const mock: LLMProvider = createMockLLM([]);

    const result = await mock.complete([{ role: 'user', content: 'Hi' }]);
    expect(result.content).toBe('');
  });
});
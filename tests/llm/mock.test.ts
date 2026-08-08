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

  it('should return explicit message after all responses are exhausted', async () => {
    const responses: LLMResponse[] = [
      { content: 'Only one' },
    ];

    const mock: LLMProvider = createMockLLM(responses);

    const result1 = await mock.complete([{ role: 'user', content: 'Hi' }]);
    expect(result1.content).toBe('Only one');

    const result2 = await mock.complete([{ role: 'user', content: 'Again' }]);
    expect(result2.content).toBe('[MOCK] No more preset responses available');
  });

  it('should have the correct provider name', () => {
    const mock: LLMProvider = createMockLLM([]);
    expect(mock.name).toBe('mock');
  });

  it('should handle empty responses array', async () => {
    const mock: LLMProvider = createMockLLM([]);

    const result = await mock.complete([{ role: 'user', content: 'Hi' }]);
    expect(result.content).toBe('[MOCK] No more preset responses available');
  });

  describe('completeStream', () => {
    it('should call onToken for each character of the content', async () => {
      const responses: LLMResponse[] = [
        { content: 'Hello', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
      ];

      const mock: LLMProvider = createMockLLM(responses);
      const tokens: string[] = [];

      const result = await mock.completeStream!(
        [{ role: 'user', content: 'Hi' }],
        (token) => tokens.push(token)
      );

      expect(tokens).toEqual(['H', 'e', 'l', 'l', 'o']);
      expect(tokens.length).toBe(5);
      expect(result.content).toBe('Hello');
    });

    it('should return complete LLMResponse from streaming', async () => {
      const responses: LLMResponse[] = [
        { content: 'World', usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 } },
      ];

      const mock: LLMProvider = createMockLLM(responses);
      const tokens: string[] = [];

      const result = await mock.completeStream!(
        [{ role: 'user', content: 'Hi' }],
        (token) => tokens.push(token)
      );

      expect(result.content).toBe('World');
      expect(result.usage).toEqual({ promptTokens: 20, completionTokens: 10, totalTokens: 30 });
    });

    it('should handle empty content string', async () => {
      const responses: LLMResponse[] = [
        { content: '', usage: { promptTokens: 5, completionTokens: 0, totalTokens: 5 } },
      ];

      const mock: LLMProvider = createMockLLM(responses);
      const tokens: string[] = [];

      const result = await mock.completeStream!(
        [{ role: 'user', content: 'Hi' }],
        (token) => tokens.push(token)
      );

      expect(tokens).toEqual([]);
      expect(result.content).toBe('');
    });

    it('should return fallback message when responses are exhausted', async () => {
      const responses: LLMResponse[] = [
        { content: 'Only one' },
      ];

      const mock: LLMProvider = createMockLLM(responses);
      const tokens: string[] = [];

      await mock.completeStream!(
        [{ role: 'user', content: 'First' }],
        (token) => tokens.push(token)
      );

      const tokens2: string[] = [];
      const result = await mock.completeStream!(
        [{ role: 'user', content: 'Second' }],
        (token) => tokens2.push(token)
      );

      expect(result.content).toBe('[MOCK] No more preset responses available');
      expect(tokens2.length).toBeGreaterThan(0);
    });

    it('should share the same response index with complete', async () => {
      const responses: LLMResponse[] = [
        { content: 'First' },
        { content: 'Second' },
      ];

      const mock: LLMProvider = createMockLLM(responses);

      const result1 = await mock.complete([{ role: 'user', content: 'A' }]);
      expect(result1.content).toBe('First');

      const tokens: string[] = [];
      const result2 = await mock.completeStream!(
        [{ role: 'user', content: 'B' }],
        (token) => tokens.push(token)
      );
      expect(result2.content).toBe('Second');
      expect(tokens).toEqual(['S', 'e', 'c', 'o', 'n', 'd']);
    });
  });
});
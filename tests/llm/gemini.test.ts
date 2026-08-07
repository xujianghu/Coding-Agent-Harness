import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateContent = vi.fn();
const mockGetGenerativeModel = vi.fn().mockImplementation(() => ({
  generateContent: mockGenerateContent,
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}));

import { createGeminiProvider } from '../../src/llm/gemini';
import { LLMProvider } from '../../src/core/types';

describe('createGeminiProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a provider with the correct name', () => {
    const provider: LLMProvider = createGeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
    });
    expect(provider.name).toBe('gemini');
  });

  it('should pass system message as systemInstruction', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => 'Hello from Gemini',
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      },
    });

    const provider: LLMProvider = createGeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
    });

    await provider.complete([
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello' },
    ]);

    expect(mockGetGenerativeModel).toHaveBeenCalledWith({
      model: 'gemini-2.5-flash',
      systemInstruction: { role: 'user', parts: [{ text: 'You are helpful' }] },
    });
  });

  it('should handle chat history correctly', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => 'Response',
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 10,
          totalTokenCount: 30,
        },
      },
    });

    const provider: LLMProvider = createGeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
    });

    await provider.complete([
      { role: 'user', content: 'First message' },
      { role: 'assistant', content: 'First response' },
      { role: 'user', content: 'Second message' },
    ]);

    expect(mockGenerateContent).toHaveBeenCalledWith({
      contents: [
        { role: 'user', parts: [{ text: 'First message' }] },
        { role: 'model', parts: [{ text: 'First response' }] },
        { role: 'user', parts: [{ text: 'Second message' }] },
      ],
    });
  });

  it('should return correct LLMResponse format', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => 'Gemini response',
        usageMetadata: {
          promptTokenCount: 8,
          candidatesTokenCount: 4,
          totalTokenCount: 12,
        },
      },
    });

    const provider: LLMProvider = createGeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
    });

    const result = await provider.complete([{ role: 'user', content: 'Hi' }]);

    expect(result.content).toBe('Gemini response');
    expect(result.usage).toEqual({
      promptTokens: 8,
      completionTokens: 4,
      totalTokens: 12,
    });
  });

  it('should handle missing usage metadata', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => 'No usage',
      },
    });

    const provider: LLMProvider = createGeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
    });

    const result = await provider.complete([{ role: 'user', content: 'Hi' }]);

    expect(result.content).toBe('No usage');
    expect(result.usage).toBeUndefined();
  });

  it('should handle messages without system instruction', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => 'OK',
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 2,
          totalTokenCount: 7,
        },
      },
    });

    const provider: LLMProvider = createGeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
    });

    await provider.complete([{ role: 'user', content: 'Hello' }]);

    expect(mockGetGenerativeModel).toHaveBeenCalledWith({
      model: 'gemini-2.5-flash',
    });
  });
});
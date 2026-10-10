import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();
const mockGetGenerativeModel = vi.fn().mockImplementation(() => ({
  generateContent: mockGenerateContent,
  generateContentStream: mockGenerateContentStream,
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(function () { return {
    getGenerativeModel: mockGetGenerativeModel,
  }; }),
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

  it('should extract functionCall from Gemini response', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => '',
        candidates: [{
          content: {
            parts: [{
              functionCall: {
                name: 'read_file',
                args: { path: '/src/app.ts' },
              },
            }],
          },
        }],
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

    const result = await provider.complete([
      { role: 'user', content: 'Read the file' },
    ]);

    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBe(1);
    expect(result.toolCalls![0]).toEqual({
      name: 'read_file',
      arguments: { path: '/src/app.ts' },
    });
  });

  it('should handle response without functionCall', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => 'No function call here',
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 3,
          totalTokenCount: 8,
        },
      },
    });

    const provider: LLMProvider = createGeminiProvider({
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
    });

    const result = await provider.complete([
      { role: 'user', content: 'Hi' },
    ]);

    expect(result.content).toBe('No function call here');
    expect(result.toolCalls).toBeUndefined();
  });

  it('注册函数声明并回传functionResponse及调用元数据，传递signal', async () => {
    mockGenerateContent.mockResolvedValueOnce({ response: { text: () => 'ok' } });
    const signal = new AbortController().signal;
    const tool = { name: 'read_file', description: '读取', parameters: { path: { type: 'string', description: '路径', required: true } }, execute: async () => ({ success: true, output: '' }) };
    await createGeminiProvider({ apiKey: 'test', model: 'test' }).complete([
      { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'read_file', arguments: { path: 'a' }, metadata: { thoughtSignature: 'signature' } }] },
      { role: 'tool', content: '{"success":true,"output":"file"}', toolCallId: 'a', name: 'read_file' },
    ], [tool], { signal, maxTokens: 70, temperature: 0 });
    expect(mockGetGenerativeModel).toHaveBeenCalledWith({ model: 'test', generationConfig: { maxOutputTokens: 70, temperature: 0 }, tools: [{ functionDeclarations: [{
      name: 'read_file', description: '读取', parameters: { type: 'object', properties: { path: { type: 'string', description: '路径' } }, required: ['path'] },
    }] }] });
    expect(mockGenerateContent).toHaveBeenCalledWith({ contents: [
      { role: 'model', parts: [{ thoughtSignature: 'signature', functionCall: { name: 'read_file', args: { path: 'a' } } }] },
      { role: 'function', parts: [{ functionResponse: { name: 'read_file', response: { success: true, output: 'file' } } }] },
    ] }, { signal });
  });

  describe('completeStream', () => {
    it('should call onToken for each streamed chunk', async () => {
      const streamChunks = [
        { text: () => 'H' },
        { text: () => 'e' },
        { text: () => 'l' },
        { text: () => 'l' },
        { text: () => 'o' },
      ];

      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of streamChunks) {
            yield chunk;
          }
        },
      };

      mockGenerateContentStream.mockResolvedValueOnce({
        stream: asyncIterable,
        response: Promise.resolve({
          text: () => 'Hello',
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
        }),
      });

      const provider: LLMProvider = createGeminiProvider({
        apiKey: 'test-key',
        model: 'gemini-2.5-flash',
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

    it('should pass system message as systemInstruction in stream mode', async () => {
      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          yield { text: () => 'OK' };
        },
      };

      mockGenerateContentStream.mockResolvedValueOnce({
        stream: asyncIterable,
        response: Promise.resolve({
          text: () => 'OK',
          usageMetadata: {
            promptTokenCount: 2,
            candidatesTokenCount: 1,
            totalTokenCount: 3,
          },
        }),
      });

      const provider: LLMProvider = createGeminiProvider({
        apiKey: 'test-key',
        model: 'gemini-2.5-flash',
      });

      await provider.completeStream!(
        [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
        ],
        () => {}
      );

      expect(mockGetGenerativeModel).toHaveBeenCalledWith({
        model: 'gemini-2.5-flash',
        systemInstruction: { role: 'user', parts: [{ text: 'You are helpful' }] },
      });
    });

    it('should handle stream without usage metadata', async () => {
      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          yield { text: () => 'No usage' };
        },
      };

      mockGenerateContentStream.mockResolvedValueOnce({
        stream: asyncIterable,
        response: Promise.resolve({
          text: () => 'No usage',
        }),
      });

      const provider: LLMProvider = createGeminiProvider({
        apiKey: 'test-key',
        model: 'gemini-2.5-flash',
      });

      const tokens: string[] = [];
      const result = await provider.completeStream!(
        [{ role: 'user', content: 'Hi' }],
        (token) => tokens.push(token)
      );

      expect(result.content).toBe('No usage');
      expect(result.usage).toBeUndefined();
    });

    it('should handle chat history correctly in stream mode', async () => {
      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          yield { text: () => 'Response' };
        },
      };

      mockGenerateContentStream.mockResolvedValueOnce({
        stream: asyncIterable,
        response: Promise.resolve({
          text: () => 'Response',
          usageMetadata: {
            promptTokenCount: 20,
            candidatesTokenCount: 10,
            totalTokenCount: 30,
          },
        }),
      });

      const provider: LLMProvider = createGeminiProvider({
        apiKey: 'test-key',
        model: 'gemini-2.5-flash',
      });

      await provider.completeStream!(
        [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'First response' },
          { role: 'user', content: 'Second message' },
        ],
        () => {}
      );

      expect(mockGenerateContentStream).toHaveBeenCalledWith({
        contents: [
          { role: 'user', parts: [{ text: 'First message' }] },
          { role: 'model', parts: [{ text: 'First response' }] },
          { role: 'user', parts: [{ text: 'Second message' }] },
        ],
      });
    });

    it('should handle messages without system instruction in stream mode', async () => {
      const asyncIterable = {
        [Symbol.asyncIterator]: async function* () {
          yield { text: () => 'OK' };
        },
      };

      mockGenerateContentStream.mockResolvedValueOnce({
        stream: asyncIterable,
        response: Promise.resolve({
          text: () => 'OK',
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 2,
            totalTokenCount: 7,
          },
        }),
      });

      const provider: LLMProvider = createGeminiProvider({
        apiKey: 'test-key',
        model: 'gemini-2.5-flash',
      });

      await provider.completeStream!(
        [{ role: 'user', content: 'Hello' }],
        () => {}
      );

      expect(mockGetGenerativeModel).toHaveBeenCalledWith({
        model: 'gemini-2.5-flash',
      });
    });
  });
});

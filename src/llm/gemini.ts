import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMProvider, LLMResponse } from '../core/types';

export function createGeminiProvider(config: {
  apiKey: string;
  model: string;
}): LLMProvider {
  const genAI = new GoogleGenerativeAI(config.apiKey);

  return {
    name: 'gemini',
    complete: async (
      messages: Array<{ role: string; content: string }>
    ): Promise<LLMResponse> => {
      const systemMessage = messages.find((m) => m.role === 'system');
      const nonSystemMessages = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

      const modelConfig: {
        model: string;
        systemInstruction?: { role: string; parts: Array<{ text: string }> };
      } = {
        model: config.model,
      };

      if (systemMessage) {
        modelConfig.systemInstruction = {
          role: 'user',
          parts: [{ text: systemMessage.content }],
        };
      }

      const model = genAI.getGenerativeModel(modelConfig);

      const result = await model.generateContent({
        contents: nonSystemMessages as Array<{
          role: string;
          parts: Array<{ text: string }>;
        }>,
      });

      const response = result.response;
      const content = response.text();

      const llmResponse: LLMResponse = { content };

      const candidate = response.candidates?.[0];
      const parts = candidate?.content?.parts;
      if (parts) {
        const functionCalls = parts
          .filter((p: any) => p.functionCall)
          .map((p: any) => ({
            name: p.functionCall.name,
            arguments: p.functionCall.args as Record<string, string>,
          }));
        if (functionCalls.length > 0) {
          llmResponse.toolCalls = functionCalls;
        }
      }

      if (response.usageMetadata) {
        llmResponse.usage = {
          promptTokens: response.usageMetadata.promptTokenCount,
          completionTokens: response.usageMetadata.candidatesTokenCount,
          totalTokens: response.usageMetadata.totalTokenCount,
        };
      }

      return llmResponse;
    },
    completeStream: async (
      messages: Array<{ role: string; content: string }>,
      onToken: (token: string) => void
    ): Promise<LLMResponse> => {
      const systemMessage = messages.find((m) => m.role === 'system');
      const nonSystemMessages = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

      const modelConfig: {
        model: string;
        systemInstruction?: { role: string; parts: Array<{ text: string }> };
      } = {
        model: config.model,
      };

      if (systemMessage) {
        modelConfig.systemInstruction = {
          role: 'user',
          parts: [{ text: systemMessage.content }],
        };
      }

      const model = genAI.getGenerativeModel(modelConfig);

      const streamingResult = await model.generateContentStream({
        contents: nonSystemMessages as Array<{
          role: string;
          parts: Array<{ text: string }>;
        }>,
      });

      let content = '';
      for await (const chunk of streamingResult.stream) {
        const chunkText = chunk.text();
        content += chunkText;
        onToken(chunkText);
      }

      const response = await streamingResult.response;

      const llmResponse: LLMResponse = { content };

      if (response.usageMetadata) {
        llmResponse.usage = {
          promptTokens: response.usageMetadata.promptTokenCount,
          completionTokens: response.usageMetadata.candidatesTokenCount,
          totalTokens: response.usageMetadata.totalTokenCount,
        };
      }

      return llmResponse;
    },
  };
}
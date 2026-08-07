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
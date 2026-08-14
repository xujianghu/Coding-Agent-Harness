import { LLMProvider, LLMResponse, ToolDefinition } from '../core/types';

export function createMockLLM(responses: LLMResponse[]): LLMProvider {
  let index = 0;

  return {
    name: 'mock',
    complete: async (_messages: Array<{ role: string; content: string }>, _tools?: ToolDefinition[]) => {
      if (index >= responses.length) {
        return { content: '[MOCK] No more preset responses available' };
      }
      const response = responses[index];
      index++;
      return response;
    },
    completeStream: async (
      _messages: Array<{ role: string; content: string }>,
      onToken: (token: string) => void
    ): Promise<LLMResponse> => {
      if (index >= responses.length) {
        const fallback = '[MOCK] No more preset responses available';
        for (const char of fallback) {
          onToken(char);
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        return { content: fallback };
      }
      const response = responses[index];
      index++;
      for (const char of response.content) {
        onToken(char);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return response;
    },
  };
}
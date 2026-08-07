import { LLMProvider, LLMResponse } from '../core/types';

export function createMockLLM(responses: LLMResponse[]): LLMProvider {
  let index = 0;

  return {
    name: 'mock',
    complete: async (_messages: Array<{ role: string; content: string }>) => {
      if (index >= responses.length) {
        return { content: '[MOCK] No more preset responses available' };
      }
      const response = responses[index];
      index++;
      return response;
    },
  };
}
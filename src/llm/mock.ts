import { LLMProvider, LLMResponse } from '../core/types';

export function createMockLLM(responses: LLMResponse[]): LLMProvider {
  let index = 0;

  return {
    name: 'mock',
    complete: async (_messages: Array<{ role: string; content: string }>) => {
      if (index >= responses.length) {
        return { content: '' };
      }
      const response = responses[index];
      index++;
      return response;
    },
  };
}
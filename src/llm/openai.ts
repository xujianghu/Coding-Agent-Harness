import OpenAI from 'openai';
import { LLMProvider, LLMResponse } from '../core/types';

export function createOpenAIProvider(config: {
  apiKey: string;
  model: string;
}): LLMProvider {
  const client = new OpenAI({ apiKey: config.apiKey });

  return {
    name: 'openai',
    complete: async (
      messages: Array<{ role: string; content: string }>
    ): Promise<LLMResponse> => {
      const response = await client.chat.completions.create({
        model: config.model,
        messages: messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
      });

      const choice = response.choices[0];
      const content = choice?.message?.content ?? '';

      const result: LLMResponse = { content };

      if (response.usage) {
        result.usage = {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        };
      }

      return result;
    },
  };
}
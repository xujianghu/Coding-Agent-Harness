import OpenAI from 'openai';
import { LLMProvider, LLMResponse, ToolDefinition } from '../core/types';

function toOpenAITools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object' as const,
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([k, v]) => [k, { type: v.type, description: v.description }]),
        ),
        required: Object.entries(t.parameters).filter(([, v]) => v.required).map(([k]) => k),
      },
    },
  }));
}

export function createOpenAIProvider(config: {
  apiKey: string;
  model: string;
  baseUrl?: string;
}): LLMProvider {
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });

  return {
    name: 'openai',
    complete: async (
      messages: Array<{ role: string; content: string }>,
      tools?: ToolDefinition[],
    ): Promise<LLMResponse> => {
      const response = await client.chat.completions.create({
        model: config.model,
        messages: messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
        ...(tools && tools.length > 0 ? { tools: toOpenAITools(tools) } : {}),
      });

      const choice = response.choices[0];
      const content = choice?.message?.content ?? '';

      const result: LLMResponse = { content };

      if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
        result.toolCalls = choice.message.tool_calls.map((tc) => ({
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        }));
      }

      if (response.usage) {
        result.usage = {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        };
      }

      return result;
    },
    completeStream: async (
      messages: Array<{ role: string; content: string }>,
      onToken: (token: string) => void
    ): Promise<LLMResponse> => {
      const stream = await client.chat.completions.create({
        model: config.model,
        messages: messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
        stream: true,
      });

      let content = '';
      let usage: LLMResponse['usage'];

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          content += delta;
          onToken(delta);
        }
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }
      }

      const result: LLMResponse = { content };
      if (usage) {
        result.usage = usage;
      }
      return result;
    },
  };
}
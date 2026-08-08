import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, LLMResponse } from '../core/types';

export function createAnthropicProvider(config: {
  apiKey: string;
  model: string;
}): LLMProvider {
  const client = new Anthropic({ apiKey: config.apiKey });

  return {
    name: 'anthropic',
    complete: async (
      messages: Array<{ role: string; content: string }>
    ): Promise<LLMResponse> => {
      const systemMessage = messages.find((m) => m.role === 'system');
      const nonSystemMessages = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      const params: {
        model: string;
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
        system?: string;
        max_tokens: number;
      } = {
        model: config.model,
        messages: nonSystemMessages,
        max_tokens: 4096,
      };

      if (systemMessage) {
        params.system = systemMessage.content;
      }

      const response = await client.messages.create(params);

      const textContent = response.content.find((c) => c.type === 'text');
      const content = textContent?.text ?? '';

      const result: LLMResponse = { content };

      const toolUseBlocks = response.content.filter((c) => c.type === 'tool_use');
      if (toolUseBlocks.length > 0) {
        result.toolCalls = toolUseBlocks.map((tu) => ({
          name: tu.name,
          arguments: tu.input as Record<string, string>,
        }));
      }

      if (response.usage) {
        result.usage = {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        };
      }

      return result;
    },
    completeStream: async (
      messages: Array<{ role: string; content: string }>,
      onToken: (token: string) => void
    ): Promise<LLMResponse> => {
      const systemMessage = messages.find((m) => m.role === 'system');
      const nonSystemMessages = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      const params: {
        model: string;
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
        system?: string;
        max_tokens: number;
        stream: boolean;
      } = {
        model: config.model,
        messages: nonSystemMessages,
        max_tokens: 4096,
        stream: true,
      };

      if (systemMessage) {
        params.system = systemMessage.content;
      }

      const stream = await client.messages.create(params) as unknown as AsyncIterable<any>;

      let content = '';
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;

      for await (const event of stream) {
        if (event.type === 'message_start') {
          inputTokens = event.message.usage.input_tokens;
        } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          content += event.delta.text;
          onToken(event.delta.text);
        } else if (event.type === 'message_delta') {
          outputTokens = event.usage?.output_tokens;
        }
      }

      const result: LLMResponse = { content };
      if (inputTokens !== undefined && outputTokens !== undefined) {
        result.usage = {
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          totalTokens: inputTokens + outputTokens,
        };
      }
      return result;
    },
  };
}
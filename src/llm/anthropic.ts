import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, LLMResponse, ToolDefinition, LLMMessage, LLMCompletionOptions } from '../core/types';

function toMessages(messages: LLMMessage[]): Anthropic.MessageParam[] {
  const converted: Anthropic.MessageParam[] = [];
  for (const message of messages.filter(m => m.role !== 'system')) {
    if (message.role === 'tool') {
      const block: Anthropic.ToolResultBlockParam = { type: 'tool_result', tool_use_id: message.toolCallId!, content: message.content };
      const previous = converted[converted.length - 1];
      if (previous?.role === 'user' && Array.isArray(previous.content)) previous.content.push(block);
      else converted.push({ role: 'user', content: [block] });
    } else if (message.toolCalls?.length) {
      converted.push({ role: 'assistant', content: [
        ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
        ...message.toolCalls.map(call => ({ type: 'tool_use' as const, id: call.id!, name: call.name, input: call.arguments })),
      ] });
    } else converted.push({ role: message.role as 'user' | 'assistant', content: message.content });
  }
  return converted;
}

function toAnthropicTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(t.parameters).map(([k, v]) => [k, { type: v.type, description: v.description }]),
      ),
      required: Object.entries(t.parameters).filter(([, v]) => v.required).map(([k]) => k),
    },
  }));
}

export function createAnthropicProvider(config: {
  apiKey: string;
  model: string;
}): LLMProvider {
  const client = new Anthropic({ apiKey: config.apiKey });

  return {
    name: 'anthropic',
    complete: async (
      messages: LLMMessage[],
      tools?: ToolDefinition[],
      options?: LLMCompletionOptions,
    ): Promise<LLMResponse> => {
      const systemMessage = messages.find((m) => m.role === 'system');
      const nonSystemMessages = toMessages(messages);

      const params: {
        model: string;
        messages: Anthropic.MessageParam[];
        system?: string;
        max_tokens: number;
        tools?: any[];
        temperature?: number;
      } = {
        model: config.model,
        messages: nonSystemMessages,
        max_tokens: options?.maxTokens ?? 4096,
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(tools && tools.length > 0 ? { tools: toAnthropicTools(tools) } : {}),
      };

      if (systemMessage) {
        params.system = systemMessage.content;
      }

      const response = await client.messages.create(params, ...options?.signal ? [{ signal: options.signal }] : []);

      const textContent = response.content.find((c) => c.type === 'text');
      const content = textContent?.text ?? '';

      const result: LLMResponse = { content };

      const toolUseBlocks = response.content.filter((c) => c.type === 'tool_use');
      if (toolUseBlocks.length > 0) {
        result.toolCalls = toolUseBlocks.map((tu) => ({
          ...(tu.id ? { id: tu.id } : {}),
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
      messages: LLMMessage[],
      onToken: (token: string) => void,
      options?: LLMCompletionOptions,
    ): Promise<LLMResponse> => {
      const systemMessage = messages.find((m) => m.role === 'system');
      const nonSystemMessages = toMessages(messages);

      const params: {
        model: string;
        messages: Anthropic.MessageParam[];
        system?: string;
        max_tokens: number;
        stream: boolean;
        temperature?: number;
      } = {
        model: config.model,
        messages: nonSystemMessages,
        max_tokens: options?.maxTokens ?? 4096,
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        stream: true,
      };

      if (systemMessage) {
        params.system = systemMessage.content;
      }

      const stream = await client.messages.create(params, ...options?.signal ? [{ signal: options.signal }] : []) as unknown as AsyncIterable<any>;

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

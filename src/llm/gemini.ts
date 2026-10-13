import { GoogleGenerativeAI, Content, Part, ModelParams, SchemaType } from '@google/generative-ai';
import { LLMProvider, LLMResponse, ToolDefinition, LLMMessage, LLMCompletionOptions } from '../core/types';

function toMessages(messages: LLMMessage[]): Content[] {
  const converted: Content[] = [];
  for (const message of messages.filter(m => m.role !== 'system')) {
    if (message.role === 'tool') {
      const part: Part = { functionResponse: { name: message.name!, response: JSON.parse(message.content) } };
      const previous = converted[converted.length - 1];
      if (previous?.role === 'function') previous.parts.push(part);
      else converted.push({ role: 'function', parts: [part] });
    } else if (message.toolCalls?.length) {
      converted.push({ role: 'model', parts: [
        ...(message.content ? [{ text: message.content }] : []),
        ...message.toolCalls.map(call => ({ ...(call.metadata ?? {}), functionCall: { name: call.name, args: call.arguments } } as Part)),
      ] });
    } else converted.push({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] });
  }
  return converted;
}

function modelParams(model: string, messages: LLMMessage[], tools?: ToolDefinition[], options?: LLMCompletionOptions): ModelParams {
  const system = messages.find(m => m.role === 'system');
  return {
    model,
    ...(system ? { systemInstruction: { role: 'user', parts: [{ text: system.content }] } } : {}),
    ...(tools?.length ? { tools: [{ functionDeclarations: tools.map(tool => ({
      name: tool.name, description: tool.description,
      parameters: {
        type: 'object' as SchemaType,
        properties: Object.fromEntries(Object.entries(tool.parameters).map(([name, param]) => [name, { type: param.type as SchemaType, description: param.description }])),
        required: Object.entries(tool.parameters).filter(([, param]) => param.required).map(([name]) => name),
      },
    })) }] } : {}),
    ...(options?.maxTokens || options?.temperature !== undefined ? { generationConfig: {
      ...(options.maxTokens ? { maxOutputTokens: options.maxTokens } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    } } : {}),
  };
}

export function createGeminiProvider(config: {
  apiKey: string;
  model: string;
}): LLMProvider {
  const genAI = new GoogleGenerativeAI(config.apiKey);

  return {
    name: 'gemini',
    complete: async (
      messages: LLMMessage[],
      tools?: ToolDefinition[],
      options?: LLMCompletionOptions,
    ): Promise<LLMResponse> => {
      const model = genAI.getGenerativeModel(modelParams(config.model, messages, tools, options));
      const result = await model.generateContent({ contents: toMessages(messages) }, ...options?.signal ? [{ signal: options.signal }] : []);

      const response = result.response;
      const content = response.text();

      const llmResponse: LLMResponse = { content };

      const candidate = response.candidates?.[0];
      const parts = candidate?.content?.parts;
      if (parts) {
        const functionCalls = parts
          .filter((p: any) => p.functionCall)
          .map((p: any) => ({
            ...(p.functionCall.id ? { id: p.functionCall.id } : {}),
            name: p.functionCall.name,
            arguments: p.functionCall.args as Record<string, string>,
            ...(Object.keys(p).some(key => key !== 'functionCall') ? { metadata: Object.fromEntries(Object.entries(p).filter(([key]) => key !== 'functionCall')) } : {}),
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
      messages: LLMMessage[],
      onToken: (token: string) => void,
      options?: LLMCompletionOptions,
    ): Promise<LLMResponse> => {
      const model = genAI.getGenerativeModel(modelParams(config.model, messages, undefined, options));
      const streamingResult = await model.generateContentStream({ contents: toMessages(messages) }, ...options?.signal ? [{ signal: options.signal }] : []);

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

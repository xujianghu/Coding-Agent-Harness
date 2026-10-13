import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { LLMProvider } from '../core/types';

export interface RunTrace {
  event(type: string, data: unknown): void;
}

export function createRunTrace(path: string, runId: string): RunTrace {
  mkdirSync(dirname(path), { recursive: true });
  return {
    event(type, data) {
      appendFileSync(path, JSON.stringify({ runId, timestamp: Date.now(), type, data }) + '\n', { encoding: 'utf8', mode: 0o600 });
    },
  };
}

export function traceProvider(provider: LLMProvider, trace: RunTrace): LLMProvider {
  let sequence = 0;
  return {
    ...provider,
    async complete(messages, tools, options) {
      const callId = ++sequence;
      const started = Date.now();
      trace.event('model_request', { callId, messages, tools: tools?.map(tool => tool.name), maxTokens: options?.maxTokens, temperature: options?.temperature });
      try {
        const response = await provider.complete(messages, tools, options);
        trace.event('model_response', { callId, durationMs: Date.now() - started, response });
        return response;
      } catch (error) {
        trace.event('model_error', { callId, durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
  };
}

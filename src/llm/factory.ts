import { LLMProvider } from '../core/types';
import { createMockLLM } from './mock';
import { createOpenAIProvider } from './openai';
import { createAnthropicProvider } from './anthropic';
import { createGeminiProvider } from './gemini';

const ENV_KEY_MAP: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

export async function createLLMProvider(
  config: { provider: string; model: string; baseUrl?: string },
  credentialManager: { get: (provider: string) => Promise<string | null> }
): Promise<LLMProvider> {
  const { provider, model } = config;

  if (provider === 'mock') {
    return createMockLLM([]);
  }

  if (provider === 'openai' || provider === 'anthropic' || provider === 'gemini') {
    const apiKey = await credentialManager.get(provider)
      ?? (ENV_KEY_MAP[provider] ? process.env[ENV_KEY_MAP[provider]] : undefined);
    if (!apiKey) {
      throw new Error(`API key not configured for ${provider}`);
    }
    if (provider === 'openai') {
      return createOpenAIProvider({ apiKey, model, baseUrl: config.baseUrl });
    }
    if (provider === 'anthropic') {
      return createAnthropicProvider({ apiKey, model });
    }
    if (provider === 'gemini') {
      return createGeminiProvider({ apiKey, model });
    }
  }

  throw new Error(`Unknown provider: ${provider}`);
}
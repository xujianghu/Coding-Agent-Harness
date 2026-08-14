import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLLMProvider } from '../../src/llm/factory';

describe('createLLMProvider', () => {
  beforeEach(() => {
    // 隔离环境变量，避免本机已设置的 *_API_KEY 干扰“无 key 应抛错”的断言。
    // 用空字符串（而非 undefined）——vitest 1.6 下 stubEnv 传 undefined 不会删除变量。
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("provider='mock' → returns MockLLMProvider (name='mock')", async () => {
    const credManager = {
      get: async (_provider: string) => null,
    };

    const provider = await createLLMProvider(
      { provider: 'mock', model: 'mock-model' },
      credManager
    );

    expect(provider.name).toBe('mock');
  });

  it("provider='openai' + valid apiKey → returns OpenAIProvider", async () => {
    const credManager = {
      get: async (provider: string) => {
        if (provider === 'openai') return 'sk-test-key';
        return null;
      },
    };

    const provider = await createLLMProvider(
      { provider: 'openai', model: 'gpt-4' },
      credManager
    );

    expect(provider.name).toBe('openai');
  });

  it("provider='anthropic' + valid apiKey → returns AnthropicProvider", async () => {
    const credManager = {
      get: async (provider: string) => {
        if (provider === 'anthropic') return 'sk-ant-test-key';
        return null;
      },
    };

    const provider = await createLLMProvider(
      { provider: 'anthropic', model: 'claude-3-5-sonnet' },
      credManager
    );

    expect(provider.name).toBe('anthropic');
  });

  it("provider='gemini' + valid apiKey → returns GeminiProvider", async () => {
    const credManager = {
      get: async (provider: string) => {
        if (provider === 'gemini') return 'gemini-test-key';
        return null;
      },
    };

    const provider = await createLLMProvider(
      { provider: 'gemini', model: 'gemini-pro' },
      credManager
    );

    expect(provider.name).toBe('gemini');
  });

  it("provider='openai' + no apiKey → throws error", async () => {
    const credManager = {
      get: async (_provider: string) => null,
    };

    await expect(
      createLLMProvider(
        { provider: 'openai', model: 'gpt-4' },
        credManager
      )
    ).rejects.toThrow('API key not configured for openai');
  });

  it("provider='anthropic' + no apiKey → throws error", async () => {
    const credManager = {
      get: async (_provider: string) => null,
    };

    await expect(
      createLLMProvider(
        { provider: 'anthropic', model: 'claude-3-5-sonnet' },
        credManager
      )
    ).rejects.toThrow('API key not configured for anthropic');
  });

  it("provider='gemini' + no apiKey → throws error", async () => {
    const credManager = {
      get: async (_provider: string) => null,
    };

    await expect(
      createLLMProvider(
        { provider: 'gemini', model: 'gemini-pro' },
        credManager
      )
    ).rejects.toThrow('API key not configured for gemini');
  });

  it("provider='unknown' → throws error", async () => {
    const credManager = {
      get: async (_provider: string) => null,
    };

    await expect(
      createLLMProvider(
        { provider: 'unknown-provider', model: 'some-model' },
        credManager
      )
    ).rejects.toThrow('Unknown provider: unknown-provider');
  });

  it('mock provider does not access credentialManager', async () => {
    let getCalled = false;
    const credManager = {
      get: async (_provider: string) => {
        getCalled = true;
        return null;
      },
    };

    const provider = await createLLMProvider(
      { provider: 'mock', model: 'mock-model' },
      credManager
    );

    expect(provider.name).toBe('mock');
    expect(getCalled).toBe(false);
  });
});
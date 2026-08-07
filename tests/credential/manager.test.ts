import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createCredentialManager } from '../../src/credential/manager';

describe('CredentialManager', () => {
  let storagePath: string;

  beforeEach(() => {
    storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-credential-test-'));
  });

  afterEach(() => {
    if (storagePath && fs.existsSync(storagePath)) {
      fs.rmSync(storagePath, { recursive: true, force: true });
    }
  });

  describe('status', () => {
    it('初始状态无 provider → status 全为 false', async () => {
      const manager = createCredentialManager(storagePath);

      const result = await manager.status();

      expect(result).toEqual({
        openai: false,
        anthropic: false,
        gemini: false,
      });
    });

    it('status 不回显明文 → 只返回 true/false', async () => {
      const manager = createCredentialManager(storagePath);

      await manager.set('openai', 'sk-secret-key-12345');
      const result = await manager.status();

      expect(result).toEqual({
        openai: true,
        anthropic: false,
        gemini: false,
      });
    });
  });

  describe('set 和 get', () => {
    it('设置后获取 key → 返回正确值', async () => {
      const manager = createCredentialManager(storagePath);

      await manager.set('openai', 'sk-test-key');
      const key = await manager.get('openai');

      expect(key).toBe('sk-test-key');
    });
  });

  describe('clear', () => {
    it('删除后 get 返回 null', async () => {
      const manager = createCredentialManager(storagePath);

      await manager.set('anthropic', 'sk-ant-key');
      const beforeClear = await manager.get('anthropic');
      expect(beforeClear).toBe('sk-ant-key');

      await manager.clear('anthropic');
      const afterClear = await manager.get('anthropic');

      expect(afterClear).toBeNull();
    });
  });

  describe('持久化', () => {
    it('跨实例持久化 → 创建新 manager 实例能读取之前设置的值', async () => {
      const manager1 = createCredentialManager(storagePath);
      await manager1.set('gemini', 'gemini-api-key');

      const manager2 = createCredentialManager(storagePath);
      const key = await manager2.get('gemini');

      expect(key).toBe('gemini-api-key');
    });
  });
});
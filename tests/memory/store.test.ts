import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createMemoryStore } from '../../src/memory/store';

describe('MemoryStore', () => {
  let storagePath: string;

  beforeEach(() => {
    storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-memory-test-'));
  });

  afterEach(() => {
    if (storagePath && fs.existsSync(storagePath)) {
      fs.rmSync(storagePath, { recursive: true, force: true });
    }
  });

  describe('set 和 get', () => {
    it('写入并读取 → 返回正确的 key/value/category', async () => {
      const store = createMemoryStore(storagePath);

      await store.set('coding-style', 'use tabs', 'convention');
      const entry = await store.get('coding-style');

      expect(entry).not.toBeNull();
      expect(entry!.key).toBe('coding-style');
      expect(entry!.value).toBe('use tabs');
      expect(entry!.category).toBe('convention');
      expect(entry!.timestamp).toBeGreaterThan(0);
    });

    it('不存在的 key 返回 null', async () => {
      const store = createMemoryStore(storagePath);

      const entry = await store.get('non-existent-key');

      expect(entry).toBeNull();
    });
  });

  describe('list', () => {
    it('list 列出所有条目', async () => {
      const store = createMemoryStore(storagePath);

      await store.set('convention-1', 'use spaces', 'convention');
      await store.set('decision-1', 'use vitest', 'decision');
      await store.set('structure-1', 'src/ directory', 'structure');

      const entries = await store.list();

      expect(entries).toHaveLength(3);
      const keys = entries.map((e) => e.key).sort();
      expect(keys).toEqual(['convention-1', 'decision-1', 'structure-1']);
    });
  });

  describe('持久化', () => {
    it('跨"会话"持久化（创建新 store 读取旧数据）', async () => {
      const store1 = createMemoryStore(storagePath);
      await store1.set('persist-key', 'persist-value', 'decision');

      const store2 = createMemoryStore(storagePath);
      const entry = await store2.get('persist-key');

      expect(entry).not.toBeNull();
      expect(entry!.key).toBe('persist-key');
      expect(entry!.value).toBe('persist-value');
      expect(entry!.category).toBe('decision');
    });
  });

  describe('delete', () => {
    it('删除条目后 get 返回 null', async () => {
      const store = createMemoryStore(storagePath);

      await store.set('to-delete', 'will be removed', 'structure');
      const beforeDelete = await store.get('to-delete');
      expect(beforeDelete).not.toBeNull();

      await store.delete('to-delete');
      const afterDelete = await store.get('to-delete');

      expect(afterDelete).toBeNull();
    });
  });
});
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createMemoryStore } from '../../src/memory/store';
import { createMemoryRetriever } from '../../src/memory/retriever';

describe('MemoryRetriever', () => {
  let storagePath: string;

  beforeEach(async () => {
    storagePath = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-retriever-test-'));
    const store = await createMemoryStore(storagePath);

    await store.set('coding-style', 'use tabs for indentation', 'convention');
    await store.set('test-framework', 'use vitest for testing', 'decision');
    await store.set('project-structure', 'src/ contains source code', 'structure');
    await store.set('lint-rule', 'use eslint with strict rules', 'convention');
    await store.set('deploy-strategy', 'deploy via CI/CD pipeline', 'decision');
  });

  afterEach(() => {
    if (storagePath && fs.existsSync(storagePath)) {
      fs.rmSync(storagePath, { recursive: true, force: true });
    }
  });

  it('关键词检索匹配 → 返回包含 query 的条目', async () => {
    const store = await createMemoryStore(storagePath);
    const retriever = createMemoryRetriever(store);

    const results = await retriever.search('vitest');

    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('test-framework');
    expect(results[0].value).toContain('vitest');
  });

  it('按分类过滤 → 只返回指定 category 的条目', async () => {
    const store = await createMemoryStore(storagePath);
    const retriever = createMemoryRetriever(store);

    const results = await retriever.search('use', { category: 'convention' });

    expect(results).toHaveLength(2);
    expect(results.every((e) => e.category === 'convention')).toBe(true);
  });

  it('无匹配结果返回空数组', async () => {
    const store = await createMemoryStore(storagePath);
    const retriever = createMemoryRetriever(store);

    const results = await retriever.search('nonexistent');

    expect(results).toHaveLength(0);
    expect(Array.isArray(results)).toBe(true);
  });
});
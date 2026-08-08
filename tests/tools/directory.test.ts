import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createReadDirTool } from '../../src/tools/directory';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ToolDefinition } from '../../src/core/types';

describe('DirectoryTools', () => {
  let workspaceRoot: string;
  let readDirTool: ToolDefinition;

  beforeEach(() => {
    workspaceRoot = join(tmpdir(), `harness-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(workspaceRoot, { recursive: true });
    readDirTool = createReadDirTool(workspaceRoot);
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('列出目录返回文件和子目录列表', async () => {
    mkdirSync(join(workspaceRoot, 'subdir'));
    writeFileSync(join(workspaceRoot, 'a.txt'), 'content');
    writeFileSync(join(workspaceRoot, 'b.ts'), 'content');

    const result = await readDirTool.execute({ path: '.' });

    expect(result.success).toBe(true);
    const entries = JSON.parse(result.output);
    expect(entries).toHaveLength(3);

    const names = entries.map((e: { name: string }) => e.name).sort();
    expect(names).toEqual(['a.txt', 'b.ts', 'subdir']);

    const subdir = entries.find((e: { name: string }) => e.name === 'subdir');
    expect(subdir.type).toBe('directory');

    const file = entries.find((e: { name: string }) => e.name === 'a.txt');
    expect(file.type).toBe('file');
    expect(typeof file.size).toBe('number');
  });

  it('空目录返回空数组', async () => {
    const result = await readDirTool.execute({ path: '.' });

    expect(result.success).toBe(true);
    const entries = JSON.parse(result.output);
    expect(entries).toEqual([]);
  });

  it('不存在的目录返回错误', async () => {
    const result = await readDirTool.execute({ path: 'nonexistent' });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Directory not found');
  });

  it('路径越界被拦截', async () => {
    const result = await readDirTool.execute({ path: '../..' });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Path traversal');
  });
});
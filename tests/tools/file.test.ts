import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createReadFileTool, createWriteFileTool, createDeleteFileTool } from '../../src/tools/file';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ToolDefinition } from '../../src/core/types';

describe('FileTools', () => {
  let workspaceRoot: string;
  let readTool: ToolDefinition;
  let writeTool: ToolDefinition;
  let deleteTool: ToolDefinition;

  beforeEach(() => {
    workspaceRoot = join(tmpdir(), `harness-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(workspaceRoot, { recursive: true });
    readTool = createReadFileTool(workspaceRoot);
    writeTool = createWriteFileTool(workspaceRoot);
    deleteTool = createDeleteFileTool(workspaceRoot);
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('读取文件返回内容', async () => {
    const filePath = join(workspaceRoot, 'test.txt');
    writeFileSync(filePath, 'hello world');

    const result = await readTool.execute({ path: 'test.txt' });

    expect(result.success).toBe(true);
    expect(result.output).toBe('hello world');
  });

  it('文件不存在返回错误', async () => {
    const result = await readTool.execute({ path: 'nonexistent.txt' });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('File not found');
  });

  it('读取目录路径返回友好错误（不抛 EISDIR）', async () => {
    mkdirSync(join(workspaceRoot, 'subdir'), { recursive: true });

    const result = await readTool.execute({ path: 'subdir' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Path is a directory');
  });

  it('删除文件', async () => {
    const filePath = join(workspaceRoot, 'to-delete.txt');
    writeFileSync(filePath, 'delete me');

    const result = await deleteTool.execute({ path: 'to-delete.txt' });

    expect(result.success).toBe(true);
    expect(existsSync(filePath)).toBe(false);
  });

  it('删除不存在文件返回错误', async () => {
    const result = await deleteTool.execute({ path: 'nonexistent.txt' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('File not found');
  });

  it('写入文件后读取验证持久化', async () => {
    const writeResult = await writeTool.execute({ path: 'output.txt', content: 'persisted data' });

    expect(writeResult.success).toBe(true);
    expect(writeResult.output).toBe('File written');

    const filePath = join(workspaceRoot, 'output.txt');
    const fileContent = readFileSync(filePath, 'utf-8');
    expect(fileContent).toBe('persisted data');
  });

  describe('writeFileTool 参数校验', () => {
    it('路径为空返回错误', async () => {
      const result = await writeTool.execute({ path: '', content: 'some content' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Path is required');
    });

    it('写入 .env 文件被拦截', async () => {
      const result = await writeTool.execute({ path: '.env', content: 'SECRET=123' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Sensitive path');
    });

    it('写入 .git/config 文件被拦截', async () => {
      const result = await writeTool.execute({ path: '.git/config', content: 'fake config' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Sensitive path');
    });

    it('写入 .harness/credentials/ 下文件被拦截', async () => {
      const result = await writeTool.execute({ path: '.harness/credentials/token.json', content: '{}' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Sensitive path');
    });

    it('写入 *.key 文件被拦截', async () => {
      const result = await writeTool.execute({ path: 'private.key', content: 'key content' });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Sensitive path');
    });

    it('写入超过 1MB 的内容返回错误', async () => {
      const largeContent = 'x'.repeat(1 * 1024 * 1024 + 1);

      const result = await writeTool.execute({ path: 'large.txt', content: largeContent });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('exceeds max');
    });

    it('正常写入小文件成功', async () => {
      const result = await writeTool.execute({ path: 'normal.txt', content: 'hello world' });

      expect(result.success).toBe(true);
      expect(result.output).toBe('File written');

      const filePath = join(workspaceRoot, 'normal.txt');
      const fileContent = readFileSync(filePath, 'utf-8');
      expect(fileContent).toBe('hello world');
    });
  });
});
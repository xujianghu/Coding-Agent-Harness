import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createReadFileTool, createWriteFileTool, createDeleteFileTool } from '../../src/tools/file';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, linkSync } from 'fs';
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

  it.each(['.env', '.env.production', '.git/config', '.harness/credentials/token.json', 'private.key'])('敏感路径 %s 在读写删除工具中一致保护', async (path) => {
    const filePath = join(workspaceRoot, path);
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, 'fixture-secret');
    const results = await Promise.all([
      readTool.execute({ path }),
      writeTool.execute({ path, content: 'changed' }),
      deleteTool.execute({ path }),
    ]);
    for (const result of results) {
      expect(result.success).toBe(false);
      expect(result.error).toContain('Sensitive path');
    }
    expect(readFileSync(filePath, 'utf-8')).toBe('fixture-secret');
  });

  it('工作区同名前缀不能绕过读写删除边界', async () => {
    const path = `${workspaceRoot}-outside/file.txt`;
    for (const tool of [readTool, writeTool, deleteTool]) {
      const result = await tool.execute({ path, content: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Path traversal');
    }
    expect(existsSync(path)).toBe(false);
  });

  it('新文件路径的现有祖先为敏感目录别名时拒绝写入', async () => {
    mkdirSync(join(workspaceRoot, '.harness'));
    symlinkSync(join(workspaceRoot, '.harness'), join(workspaceRoot, 'alias'), 'junction');
    const result = await writeTool.execute({ path: 'alias/nested/token.txt', content: 'secret' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Sensitive path');
    expect(existsSync(join(workspaceRoot, '.harness', 'nested'))).toBe(false);
  });

  it('读取超过 1 MB 的文件不会把全部内容放入上下文', async () => {
    writeFileSync(join(workspaceRoot, 'large-read.txt'), 'x'.repeat(1024 * 1024 + 1));
    expect((await readTool.execute({ path: 'large-read.txt' })).error).toContain('exceeds max');
  });

  it('敏感文件的硬链接别名在读写删除工具中都拒绝执行', async () => {
    writeFileSync(join(workspaceRoot, '.env'), 'fixture-secret');
    linkSync(join(workspaceRoot, '.env'), join(workspaceRoot, 'alias.txt'));
    for (const tool of [readTool, writeTool, deleteTool]) {
      const result = await tool.execute({ path: 'alias.txt', content: 'changed' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Hard-linked');
    }
    expect(readFileSync(join(workspaceRoot, '.env'), 'utf-8')).toBe('fixture-secret');
  });

  it.runIf(process.platform === 'win32')('拒绝 Windows 文件流、设备名和尾部点', async () => {
    for (const path of ['file.txt:secret', 'NUL', 'sub/COM1.txt', '.env.']) {
      expect((await writeTool.execute({ path, content: 'changed' })).success).toBe(false);
    }
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

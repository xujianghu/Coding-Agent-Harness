import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createReadFileTool, createWriteFileTool } from '../../src/tools/file';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ToolDefinition } from '../../src/core/types';

describe('FileTools', () => {
  let workspaceRoot: string;
  let readTool: ToolDefinition;
  let writeTool: ToolDefinition;

  beforeEach(() => {
    workspaceRoot = join(tmpdir(), `harness-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(workspaceRoot, { recursive: true });
    readTool = createReadFileTool(workspaceRoot);
    writeTool = createWriteFileTool(workspaceRoot);
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

  it('写入文件后读取验证持久化', async () => {
    const writeResult = await writeTool.execute({ path: 'output.txt', content: 'persisted data' });

    expect(writeResult.success).toBe(true);
    expect(writeResult.output).toBe('File written');

    const filePath = join(workspaceRoot, 'output.txt');
    const fileContent = readFileSync(filePath, 'utf-8');
    expect(fileContent).toBe('persisted data');
  });
});
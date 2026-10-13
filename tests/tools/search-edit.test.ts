import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createSearchCodeTool, createSearchFilesTool, createReadFileLinesTool } from '../../src/tools/search';
import { createApplyPatchTool } from '../../src/tools/edit';

describe('仓库定位与精确补丁', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'harness-search-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'sum.js'), 'function sum(a, b) {\n  return a - b;\n}\n');
    writeFileSync(join(root, '.env'), 'SECRET=sum');
    mkdirSync(join(root, '.harness'));
    writeFileSync(join(root, '.harness', 'credentials.json'), 'sum');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('CRLF 多行读取保留原始分隔符，可直接作为精确补丁原文', async () => {
    writeFileSync(join(root, 'src', 'sum.js'), 'first\r\nsecond\r\nthird\r\n');
    const read = JSON.parse((await createReadFileLinesTool(root).execute({ path: 'src/sum.js', start_line: '1', end_line: '2' })).output);
    expect(read.content).toBe('first\r\nsecond');
    const patched = await createApplyPatchTool(root).execute({ path: 'src/sum.js', old_text: read.content, new_text: 'changed\r\nsecond', expected_sha256: read.sha256 });
    expect(patched.success).toBe(true);
    expect(readFileSync(join(root, 'src', 'sum.js'), 'utf8')).toBe('changed\r\nsecond\r\nthird\r\n');
  });

  it('搜索返回代码位置且不读取凭据', async () => {
    const found = await createSearchCodeTool(root).execute({ query: 'sum' });
    expect(JSON.parse(found.output).matches).toEqual([{ path: 'src/sum.js', line: 1, text: 'function sum(a, b) {' }]);
    const names = await createSearchFilesTool(root).execute({ query: 'sum' });
    expect(JSON.parse(names.output).files).toEqual(['src/sum.js']);
  });

  it('按行读取并基于摘要应用补丁', async () => {
    const read = await createReadFileLinesTool(root).execute({ path: 'src/sum.js', start_line: '2', end_line: '2' });
    const slice = JSON.parse(read.output);
    expect(slice.content).toBe('  return a - b;');
    const result = await createApplyPatchTool(root).execute({ path: 'src/sum.js', old_text: 'return a - b;', new_text: 'return a + b;', expected_sha256: slice.sha256 });
    expect(result.success).toBe(true);
    expect(readFileSync(join(root, 'src', 'sum.js'), 'utf8')).toContain('return a + b;');
  });

  it('文件版本改变时拒绝覆盖', async () => {
    const read = JSON.parse((await createReadFileLinesTool(root).execute({ path: 'src/sum.js' })).output);
    writeFileSync(join(root, 'src', 'sum.js'), 'return a - b; // 用户已修改\n');
    const result = await createApplyPatchTool(root).execute({ path: 'src/sum.js', old_text: 'return a - b;', new_text: 'return a + b;', expected_sha256: read.sha256 });
    expect(result.success).toBe(false);
    expect(readFileSync(join(root, 'src', 'sum.js'), 'utf8')).toContain('用户已修改');
  });

  it('重复匹配和越界路径都不写入', async () => {
    writeFileSync(join(root, 'src', 'sum.js'), 'old old');
    expect((await createApplyPatchTool(root).execute({ path: 'src/sum.js', old_text: 'old', new_text: 'new' })).success).toBe(false);
    expect(readFileSync(join(root, 'src', 'sum.js'), 'utf8')).toBe('old old');
    expect((await createReadFileLinesTool(root).execute({ path: '../outside.js' })).success).toBe(false);
    expect((await createSearchCodeTool(root).execute({ query: 'SECRET', path: '.env' })).success).toBe(false);
  });

  it('取消后的补丁不能继续写入', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await createApplyPatchTool(root).execute({ path: 'src/sum.js', old_text: 'return a - b;', new_text: 'return a + b;' }, { signal: controller.signal });
    expect(result.success).toBe(false);
    expect(readFileSync(join(root, 'src', 'sum.js'), 'utf8')).toContain('return a - b;');
  });
});

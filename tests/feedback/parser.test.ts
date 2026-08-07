import { describe, it, expect } from 'vitest';
import { parseTestOutput, parseLintOutput } from '../../src/feedback/parser';
import type { FeedbackSignal } from '../../src/core/types';

describe('parseTestOutput', () => {
  it('exitCode=0 → passed=true（即使输出含 "fail" 字样）', () => {
    const output = 'Running tests...\n  ✗ test1 failed\n  ✗ test2\n\nTests: 0 passed, 2 failed, 2 total';
    const signal = parseTestOutput(output, 0);

    expect(signal.type).toBe('test');
    expect(signal.passed).toBe(true);
    expect(signal.summary).toContain('passed');
    expect(signal.details).toEqual([]);
  });

  it('exitCode=1 → passed=false', () => {
    const output = 'Running tests...\n  ✓ test1\n  ✓ test2\n\nTests: 2 passed, 2 total';
    const signal = parseTestOutput(output, 1);

    expect(signal.type).toBe('test');
    expect(signal.passed).toBe(false);
    expect(signal.summary).toContain('failed');
    expect(signal.details).toEqual([]);
  });

  it('无 exitCode 时用正则降级：输出含 "2 failed" → passed=false', () => {
    const output = 'Running tests...\n  ✓ test1\n  ✗ test2\n  ✗ test3\n\nTests: 1 passed, 2 failed, 3 total';
    const signal = parseTestOutput(output);

    expect(signal.type).toBe('test');
    expect(signal.passed).toBe(false);
    expect(signal.summary).toContain('failed');
    expect(signal.details).toEqual([]);
  });

  it('无 exitCode 时输出含 "0 failures" → passed=true', () => {
    const output = 'Running tests...\n  ✓ test1\n  ✓ test2\n\nTest Suites: 1 passed, 1 total\nTests: 0 failures, 2 passed, 2 total';
    const signal = parseTestOutput(output);

    expect(signal.type).toBe('test');
    expect(signal.passed).toBe(true);
    expect(signal.summary).toContain('passed');
    expect(signal.details).toEqual([]);
  });

  it('无 exitCode 时输出含 "failures" 但不匹配 "(\\d+)\\s+failed" → passed=true', () => {
    const output = 'Tests completed with failures=0\nAll tests passed';
    const signal = parseTestOutput(output);

    expect(signal.type).toBe('test');
    expect(signal.passed).toBe(true);
    expect(signal.summary).toContain('passed');
  });

  it('解析测试通过输出 → passed=true, summary 含 "passed"', () => {
    const output = 'Running tests...\n  ✓ test1\n  ✓ test2\n\nTest Suites: 1 passed, 1 total\nTests: 2 passed, 2 total';
    const signal = parseTestOutput(output);

    expect(signal.type).toBe('test');
    expect(signal.passed).toBe(true);
    expect(signal.summary).toContain('passed');
    expect(signal.details).toEqual([]);
  });

  it('解析测试失败输出（含 "2 failed"）→ passed=false, summary 含 "failed"', () => {
    const output = 'Running tests...\n  ✓ test1\n  ✗ test2\n  ✗ test3\n\nTests: 1 passed, 2 failed, 3 total';
    const signal = parseTestOutput(output);

    expect(signal.type).toBe('test');
    expect(signal.passed).toBe(false);
    expect(signal.summary).toContain('failed');
    expect(signal.details).toEqual([]);
  });
});

describe('parseLintOutput', () => {
  it('解析 Lint 错误输出（含 file:line:col: message）→ details 正确解析', () => {
    const output = 'test.ts:5:10: error TS1234: Type error\nsrc/app.ts:12:3: warning TS5678: Missing return type';
    const signal: FeedbackSignal = parseLintOutput(output);

    expect(signal.type).toBe('lint');
    expect(signal.passed).toBe(false);
    expect(signal.details).toHaveLength(2);
    expect(signal.details[0]).toEqual({
      file: 'test.ts',
      line: 5,
      message: 'error TS1234: Type error',
    });
    expect(signal.details[1]).toEqual({
      file: 'src/app.ts',
      line: 12,
      message: 'warning TS5678: Missing return type',
    });
    expect(signal.summary).toContain('2');
  });

  it('空 Lint 输出 → passed=true, details 为空数组', () => {
    const signal: FeedbackSignal = parseLintOutput('');

    expect(signal.type).toBe('lint');
    expect(signal.passed).toBe(true);
    expect(signal.details).toEqual([]);
    expect(signal.summary).toBe('No issues found');
  });
});
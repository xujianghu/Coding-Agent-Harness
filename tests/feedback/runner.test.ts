import { describe, it, expect } from 'vitest';
import { createFeedbackRunner } from '../../src/feedback/runner';
import type { FeedbackRunner } from '../../src/feedback/runner';

describe('createFeedbackRunner', () => {
  let runner: FeedbackRunner;

  it('执行成功命令时返回 passed=true', async () => {
    runner = createFeedbackRunner();
    const signal = await runner.runTest('echo "All tests passed"');
    expect(signal.type).toBe('test');
    expect(signal.passed).toBe(true);
    expect(signal.summary).toBe('All tests passed');
    expect(signal.details).toEqual([]);
  });

  it('执行失败命令时返回 passed=false', async () => {
    runner = createFeedbackRunner();
    const signal = await runner.runTest('exit 1');
    expect(signal.type).toBe('test');
    expect(signal.passed).toBe(false);
    expect(signal.summary).toBe('1 tests failed');
  });

  it('执行 lint 命令时解析输出中的 file:line:message 模式', async () => {
    runner = createFeedbackRunner();
    const signal = await runner.runLint('echo "test.ts:5:10: error TS1234: Type error"');
    expect(signal.type).toBe('lint');
    expect(signal.passed).toBe(true);
    expect(signal.details).toHaveLength(1);
    expect(signal.details[0]).toEqual({
      file: 'test.ts',
      line: 5,
      message: 'error TS1234: Type error',
    });
  });
});
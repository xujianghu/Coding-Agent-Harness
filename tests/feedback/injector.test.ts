import { describe, it, expect } from 'vitest';
import { createFeedbackInjector } from '../../src/feedback/injector';
import type { FeedbackInjector } from '../../src/feedback/injector';
import type { FeedbackSignal } from '../../src/core/types';

describe('createFeedbackInjector', () => {
  let injector: FeedbackInjector;

  it('失败信号 → 格式化为包含文件行号和修复建议的消息', () => {
    injector = createFeedbackInjector();
    const signal: FeedbackSignal = {
      type: 'test',
      passed: false,
      details: [
        { file: 'src/app.ts', line: 5, message: 'Type error' },
        { file: 'src/utils.ts', line: 12, message: 'Missing return type' },
      ],
      summary: '2 tests failed',
    };

    const result = injector.format(signal);

    expect(result.role).toBe('feedback');
    expect(result.content).toContain('src/app.ts:5');
    expect(result.content).toContain('Type error');
    expect(result.content).toContain('src/utils.ts:12');
    expect(result.content).toContain('Missing return type');
    expect(result.content).toContain('Please fix the issues above and try again.');
  });

  it('通过信号 → 格式化为成功消息', () => {
    injector = createFeedbackInjector();
    const signal: FeedbackSignal = {
      type: 'lint',
      passed: true,
      details: [],
      summary: 'No issues found',
    };

    const result = injector.format(signal);

    expect(result.role).toBe('feedback');
    expect(result.content).toBe('[LINT] PASSED: No issues found');
  });

  it('验证返回消息的 role 为 "feedback"', () => {
    injector = createFeedbackInjector();
    const signal: FeedbackSignal = {
      type: 'typecheck',
      passed: false,
      details: [],
      summary: 'Type check failed',
    };

    const result = injector.format(signal);

    expect(result.role).toBe('feedback');
  });
});
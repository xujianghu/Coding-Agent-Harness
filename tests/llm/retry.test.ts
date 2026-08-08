import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry } from '../../src/llm/retry';

describe('withRetry', () => {
  describe('retry with timers', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return immediately on first success', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const promise = withRetry(fn);
      await promise;
      expect(fn).toHaveBeenCalledTimes(1);
      await expect(promise).resolves.toBe('success');
    });

    it('should retry on transient failures and succeed', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce('eventual success');

      const promise = withRetry(fn, { maxRetries: 3, baseDelay: 1000 });
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result).toBe('eventual success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after exceeding maxRetries', async () => {
      const error = new Error('Persistent failure');
      const fn = vi.fn().mockRejectedValue(error);

      const promise = withRetry(fn, { maxRetries: 2, baseDelay: 100 });
      // 先注册 rejection handler 再触发 timers
      const rejection = expect(promise).rejects.toThrow('Persistent failure');
      await vi.runAllTimersAsync();
      await rejection;
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should retry on 429 rate limit errors', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce({ status: 429, message: 'Rate limited' })
        .mockRejectedValueOnce({ status: 429, message: 'Rate limited' })
        .mockResolvedValueOnce('rate limit resolved');

      const promise = withRetry(fn, { maxRetries: 3, baseDelay: 1000 });
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result).toBe('rate limit resolved');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should retry on 5xx server errors', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce({ status: 500, message: 'Internal Server Error' })
        .mockRejectedValueOnce({ status: 503, message: 'Service Unavailable' })
        .mockResolvedValueOnce('server recovered');

      const promise = withRetry(fn, { maxRetries: 3, baseDelay: 1000 });
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result).toBe('server recovered');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should use exponential backoff with jitter', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValueOnce('success');

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      const promise = withRetry(fn, { maxRetries: 3, baseDelay: 1000 });
      await vi.runAllTimersAsync();
      await promise;

      const delays = setTimeoutSpy.mock.calls
        .filter((call) => call[1] !== undefined)
        .map((call) => call[1] as number);

      expect(delays.length).toBe(2);
      expect(delays[0]).toBeGreaterThanOrEqual(1000);
      expect(delays[0]).toBeLessThan(1000 + 1000 + 100);
      expect(delays[1]).toBeGreaterThanOrEqual(2000);
      expect(delays[1]).toBeLessThan(2000 + 1000 + 100);
      setTimeoutSpy.mockRestore();
    });

    it('should use default maxRetries=3 and baseDelay=1000', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockRejectedValueOnce(new Error('fail 3'))
        .mockResolvedValueOnce('success');

      const promise = withRetry(fn);
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(4);
    });
  });

  describe('non-retryable errors (no timers)', () => {
    it('should not retry on 401 errors', async () => {
      const fn = vi.fn().mockRejectedValue({ status: 401, message: 'Unauthorized' });
      await expect(withRetry(fn, { maxRetries: 3, baseDelay: 1000 }))
        .rejects.toMatchObject({ status: 401, message: 'Unauthorized' });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 403 errors', async () => {
      const fn = vi.fn().mockRejectedValue({ status: 403, message: 'Forbidden' });
      await expect(withRetry(fn, { maxRetries: 3, baseDelay: 1000 }))
        .rejects.toMatchObject({ status: 403, message: 'Forbidden' });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 400 errors', async () => {
      const fn = vi.fn().mockRejectedValue({ status: 400, message: 'Bad Request' });
      await expect(withRetry(fn, { maxRetries: 3, baseDelay: 1000 }))
        .rejects.toMatchObject({ status: 400, message: 'Bad Request' });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should not retry on Anthropic AuthenticationError', async () => {
      class AuthenticationError extends Error {
        status: number;
        constructor(message: string) {
          super(message);
          this.name = 'AuthenticationError';
          this.status = 401;
        }
      }
      const fn = vi.fn().mockRejectedValue(new AuthenticationError('Invalid API key'));
      await expect(withRetry(fn, { maxRetries: 3, baseDelay: 1000 }))
        .rejects.toThrow('Invalid API key');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should not retry on Anthropic PermissionError', async () => {
      class PermissionError extends Error {
        status: number;
        constructor(message: string) {
          super(message);
          this.name = 'PermissionError';
          this.status = 403;
        }
      }
      const fn = vi.fn().mockRejectedValue(new PermissionError('Forbidden'));
      await expect(withRetry(fn, { maxRetries: 3, baseDelay: 1000 }))
        .rejects.toThrow('Forbidden');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
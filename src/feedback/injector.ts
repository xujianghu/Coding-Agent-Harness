import type { FeedbackSignal } from '../core/types';

export interface FeedbackInjector {
  format(signal: FeedbackSignal): { role: string; content: string };
}

export function createFeedbackInjector(): FeedbackInjector {
  return {
    format(signal: FeedbackSignal): { role: string; content: string } {
      const status = signal.passed ? 'PASSED' : 'FAILED';
      let msg = `[${signal.type.toUpperCase()}] ${status}: ${signal.summary}`;
      if (!signal.passed && signal.details.length > 0) {
        const detailLines = signal.details
          .map((d) => `${d.file}:${d.line}: ${d.message}`)
          .join('\n');
        msg += `\n${detailLines}\n\nPlease fix the issues above and try again.`;
      }
      return { role: 'feedback', content: msg };
    },
  };
}
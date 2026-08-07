import type { FeedbackSignal } from '../core/types';

export function parseTestOutput(output: string): FeedbackSignal {
  const failPattern = /\b(fail|failed|failing)\b/i;
  const passed = !failPattern.test(output);

  let summary: string;
  if (!passed) {
    const failMatch = output.match(/(\d+)\s+failed/);
    summary = failMatch ? `${failMatch[1]} tests failed` : 'Tests failed';
  } else {
    const testMatch = output.match(/(\d+)\s+passed/);
    summary = testMatch ? `${testMatch[1]} tests passed` : 'All tests passed';
  }

  return {
    type: 'test',
    passed,
    details: [],
    summary,
  };
}

export function parseLintOutput(output: string): FeedbackSignal {
  const details: Array<{ file: string; line: number; message: string }> = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^(.+?):(\d+):(\d+):\s+(.+)$/);
    if (match) {
      details.push({
        file: match[1],
        line: parseInt(match[2], 10),
        message: match[4],
      });
    }
  }

  return {
    type: 'lint',
    passed: details.length === 0,
    details,
    summary: details.length === 0 ? 'No issues found' : `${details.length} issues found`,
  };
}
import type { FeedbackSignal } from '../core/types';

export function parseTestOutput(output: string, exitCode?: number): FeedbackSignal {
  if (exitCode !== undefined) {
    const passed = exitCode === 0;
    let summary: string;
    if (passed) {
      const testMatch = output.match(/(\d+)\s+passed/);
      summary = testMatch ? `${testMatch[1]} tests passed` : 'All tests passed';
    } else {
      const failMatch = output.match(/(\d+)\s+failed/i);
      summary = failMatch ? `${failMatch[1]} tests failed` : 'Tests failed';
    }
    return { type: 'test', passed, details: [], summary };
  }

  const failPattern = /(\d+)\s+failed/i;
  const failMatch = output.match(failPattern);
  const passed = !failMatch;

  let summary: string;
  if (!passed) {
    summary = `${failMatch[1]} tests failed`;
  } else {
    const testMatch = output.match(/(\d+)\s+passed/);
    summary = testMatch ? `${testMatch[1]} tests passed` : 'All tests passed';
  }

  return { type: 'test', passed, details: [], summary };
}

export function parseLintOutput(output: string): FeedbackSignal {
  const details: Array<{ file: string; line: number; message: string }> = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim().replace(/^"/, '').replace(/"$/, '');
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
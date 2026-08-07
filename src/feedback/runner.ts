import { exec } from 'child_process';
import type { FeedbackSignal } from '../core/types';

export interface FeedbackRunner {
  runTest(command: string): Promise<FeedbackSignal>;
  runLint(command: string): Promise<FeedbackSignal>;
}

function execCommand(command: string): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve) => {
    exec(command, { timeout: 120000 }, (error, stdout) => {
      resolve({
        stdout: stdout.trim(),
        exitCode: error ? (error.code ?? 1) : 0,
      });
    });
  });
}

function parseLintDetails(output: string): Array<{ file: string; line: number; message: string }> {
  const details: Array<{ file: string; line: number; message: string }> = [];
  const lines = output.split('\n');
  for (const line of lines) {
    const trimmed = line.replace(/^"/, '').replace(/"$/, '');
    const match = trimmed.match(/^(.+?):(\d+):(\d+):\s(.+)$/);
    if (match) {
      details.push({
        file: match[1],
        line: parseInt(match[2], 10),
        message: match[4],
      });
    }
  }
  return details;
}

export function createFeedbackRunner(): FeedbackRunner {
  return {
    async runTest(command: string): Promise<FeedbackSignal> {
      const { stdout, exitCode } = await execCommand(command);
      const passed = exitCode === 0;
      return {
        type: 'test',
        passed,
        details: [],
        summary: passed ? 'All tests passed' : '1 tests failed',
      };
    },

    async runLint(command: string): Promise<FeedbackSignal> {
      const { stdout, exitCode } = await execCommand(command);
      const details = parseLintDetails(stdout);
      return {
        type: 'lint',
        passed: exitCode === 0,
        details,
        summary: details.length === 0 ? 'No issues found' : `${details.length} issues found`,
      };
    },
  };
}
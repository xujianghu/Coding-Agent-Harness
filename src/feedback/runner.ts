import { exec } from 'child_process';
import type { FeedbackSignal } from '../core/types';
import { parseLintOutput, parseTestOutput } from './parser';

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



export function createFeedbackRunner(): FeedbackRunner {
  return {
    async runTest(command: string): Promise<FeedbackSignal> {
      const { stdout, exitCode } = await execCommand(command);
      return parseTestOutput(stdout, exitCode);
    },

    async runLint(command: string): Promise<FeedbackSignal> {
      const { stdout, exitCode } = await execCommand(command);
      const parsed = parseLintOutput(stdout);
      return {
        type: 'lint',
        passed: exitCode === 0,
        details: parsed.details,
        summary: parsed.summary,
      };
    },
  };
}
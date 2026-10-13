import type { LLMProvider, LLMResponse } from '../core/types';
import type { EvaluationTask } from './types';
import { manifestDirectory, snapshotFiles } from './manifest';

/** 固定修复脚本只测工具、隔离与报告管道，不能作为模型效果证据。 */
export function createEvaluationMock(task: EvaluationTask, manifestRoot: string): LLMProvider {
  const responses: LLMResponse[] = [
    { content: '', toolCalls: [{ id: `${task.id}-search`, name: 'search_files', arguments: { path: '.', query: '.cjs' } }] },
    { content: '', toolCalls: [{ id: `${task.id}-test-before`, name: 'run_test', arguments: { command: task.publicTestCommand } }] },
  ];
  const solution = snapshotFiles(manifestDirectory(manifestRoot, task.mockSolution));
  for (const [path, content] of solution) responses.push({ content: '', toolCalls: [{ id: `${task.id}-write-${responses.length}`, name: 'write_file', arguments: { path, content: content.toString('utf8') } }] });
  responses.push({ content: '', toolCalls: [{ id: `${task.id}-test-after`, name: 'run_test', arguments: { command: task.publicTestCommand } }] });
  responses.push({ content: JSON.stringify({ done: true, summary: '固定修复脚本已执行；仅用于离线机制自检。' }) });
  let index = 0;
  return { name: 'mock-mechanism-check', async complete() {
    if (index >= responses.length) throw new Error('Mock 脚本耗尽；不能伪造额外模型决策');
    return responses[index++];
  } };
}

import { appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { EvaluationRecord } from './types';

export function changes(before: Map<string, Buffer>, after: Map<string, Buffer>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].sort().filter(name => {
    const oldContent = before.get(name);
    const newContent = after.get(name);
    return !oldContent || !newContent || !oldContent.equals(newContent);
  });
}

/** 直接保存字节快照的逐文件 Diff，无需将候选仓库中的 Git 配置交给宿主执行。 */
export function renderDiff(before: Map<string, Buffer>, after: Map<string, Buffer>): string {
  return changes(before, after).map(name => {
    const oldText = before.get(name)?.toString('utf8') ?? '';
    const newText = after.get(name)?.toString('utf8') ?? '';
    const oldLines = oldText ? oldText.replace(/\n$/, '').split('\n') : [];
    const newLines = newText ? newText.replace(/\n$/, '').split('\n') : [];
    return [`diff --git a/${name} b/${name}`, `--- ${before.has(name) ? `a/${name}` : '/dev/null'}`,
      `+++ ${after.has(name) ? `b/${name}` : '/dev/null'}`, `@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@`,
      ...oldLines.map(line => `-${line}`), ...newLines.map(line => `+${line}`)].join('\n');
  }).join('\n') + '\n';
}

export function writeReport(directory: string, records: EvaluationRecord[]): void {
  const modelRecords = records.filter(record => record.kind === 'model-evaluation');
  const mockRecords = records.filter(record => record.kind === 'mock-mechanism-check');
  const rows: string[] = [];
  for (const mode of ['full', 'baseline', 'no-feedback']) {
    const trials = modelRecords.filter(record => record.mode === mode);
    if (trials.length) rows.push(`| ${mode} | ${trials.length} | ${trials.filter(record => record.success).length} | ${(100 * trials.filter(record => record.success).length / trials.length).toFixed(1)}% | ${(trials.reduce((sum, record) => sum + record.elapsedMs, 0) / trials.length / 1000).toFixed(2)} |`);
  }
  const lines = ['# 编码 Agent 评测记录', '', '所有已开始的尝试均进入 results.jsonl；运行错误、超时、预算耗尽和验收失败均进入分母。', '',
    ...(rows.length ? ['| 模式 | 尝试数 | 隐藏验收通过数 | 成功率 | 平均耗时（秒） |', '|---|---:|---:|---:|---:|', ...rows, ''] : []),
    ...(mockRecords.length ? [`离线机制自检：${mockRecords.filter(record => record.success).length}/${mockRecords.length} 次通过。固定修复脚本不衡量模型能力，禁止把本项数字作为 Agent 成功率。`, ''] : []),
    '费用未知时 cost=null。realUsage 只累计服务端返回的真实用量；estimatedUsage 单列缺失用量时的估算，不能冒充真实账单。', '',
    '| 任务 | 模式 | 重复 | 类型 | 验收 | 停止原因 | Diff / Trace |', '|---|---|---:|---|---|---|---|',
    ...records.map(record => `| ${record.taskId} | ${record.mode} | ${record.repetition} | ${record.kind} | ${record.success ? '通过' : '失败'} | ${record.stopReason.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')} | [Diff](${record.artifacts.diff}) / [Trace](${record.artifacts.trace}) |`), ''];
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'report.md'), lines.join('\n'));
}

export function appendRecord(directory: string, record: EvaluationRecord): void {
  appendFileSync(join(directory, 'results.jsonl'), JSON.stringify(record) + '\n');
}

#!/usr/bin/env node
import { Command } from 'commander';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { loadConfig } from '../config/loader';
import { runEvaluation } from './runner';
import type { EvaluationMode } from './types';

export async function main(argv = process.argv): Promise<void> {
  const program = new Command();
  program.name('harness-eval').description('固定仓库任务的独立验收与对照评测')
    .option('--manifest <path>', '固定任务清单', resolve(__dirname, '../../eval/manifest.json'))
    .option('--config <path>', '模型与预算配置', '.harness/config.yaml')
    .option('--credentials <path>', '正常凭据存储目录', '.harness/credentials')
    .option('--output <path>', '报告输出根目录', '.harness/eval-results')
    .option('--mode <mode>', 'full、baseline、no-feedback 或 all', 'all')
    .option('--repeat <count>', '每任务每模式独立尝试次数', '1')
    .option('--tasks <ids>', '逗号分隔任务 ID，默认全部')
    .option('--mock', '离线机制自检：执行固定修复脚本，不调用模型、不衡量模型能力', false);
  program.parse(argv);
  const options = program.opts<{ manifest: string; config: string; credentials: string; output: string; mode: string; repeat: string; tasks?: string; mock: boolean }>();
  if (!options.mock && !existsSync(resolve(options.config))) throw new Error(`真实评测配置不存在：${options.config}。请显式准备模型与预算配置，避免误用默认模型。`);
  if (options.mock) console.log('离线机制自检：固定脚本使用本地临时工作区；结果不能作为真实 Agent 成功率。');
  else console.log('真实评测：工具和隐藏验收均在隔离 Docker 容器执行，将使用配置模型产生正常 API 费用。');
  const modes: EvaluationMode[] = options.mode === 'all' ? ['full', 'baseline', 'no-feedback'] : [options.mode as EvaluationMode];
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error('用户取消评测'));
  process.once('SIGINT', cancel);
  try {
    const result = await runEvaluation({ manifestPath: resolve(options.manifest), outputDir: resolve(options.output),
      config: loadConfig(resolve(options.config)), modes, repetitions: Number(options.repeat), mock: options.mock,
      taskIds: options.tasks?.split(',').map(id => id.trim()), credentialPath: resolve(options.credentials), signal: controller.signal });
    console.log(`${options.mock ? '机制自检' : '独立验收'}完成：${result.records.filter(record => record.success).length}/${result.records.length} 次通过。报告：${resolve(result.directory, 'report.md')}`);
    if (result.records.some(record => !record.success)) process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', cancel);
  }
}

if (require.main === module) main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

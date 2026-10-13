import { execFileSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { parse } from 'yaml';
import { createAgentLoop } from '../core/loop';
import type { AgentConfig, ActionResult, LLMProvider } from '../core/types';
import { createCredentialManager } from '../credential/manager';
import { createGuardrailEngine } from '../governance/guardrail';
import { createHITL } from '../governance/hitl';
import { createGovernancePipeline } from '../governance/pipeline';
import type { GuardrailRule } from '../governance/rules';
import { createSandbox } from '../governance/sandbox';
import { createLLMProvider } from '../llm/factory';
import { createWorkspaceTools } from '../tools/workspace';
import { appendRecord, renderDiff, writeReport } from './artifacts';
import { assertDockerAvailable, gradeCandidate } from './grader';
import { hashFiles, loadManifest, manifestDirectory, snapshotFiles } from './manifest';
import { createEvaluationMock } from './mock';
import type { EvaluationOptions, EvaluationRecord, GradeResult } from './types';
import { wrapEvaluationProvider } from './variants';

function materialize(files: Map<string, Buffer>, root: string): void {
  for (const [name, bytes] of files) {
    const target = join(root, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
}

function harnessMetadata(): { harnessCommit: string | null; harnessDirty: boolean; harnessSourceHash: string } {
  let harnessCommit: string | null = null;
  let harnessDirty = true;
  const project = resolve(__dirname, '../..');
  try {
    harnessCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    harnessDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: project, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    // 发布包没有 Git 元数据时保留 null，源码哈希仍可识别执行版本。
  }
  const source = existsSync(join(project, 'src')) ? join(project, 'src') : join(project, 'dist');
  return { harnessCommit, harnessDirty, harnessSourceHash: hashFiles(snapshotFiles(source)) };
}

function validateOptions(options: EvaluationOptions): void {
  for (const [name, value] of Object.entries({ repetitions: options.repetitions, maxTurns: options.config.agent.maxTurns,
    timeout: options.config.agent.timeout, maxTokens: options.config.llm.maxTokens,
    maxTotalTokens: options.config.agent.maxTotalTokens ?? 100000 })) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数`);
  }
  if (!options.modes.length || options.modes.some(mode => !['full', 'baseline', 'no-feedback'].includes(mode))) throw new Error('无效评测模式');
  if (new Set(options.modes).size !== options.modes.length) throw new Error('评测模式重复');
}

export async function runEvaluation(options: EvaluationOptions): Promise<{ directory: string; records: EvaluationRecord[] }> {
  validateOptions(options);
  const manifest = loadManifest(options.manifestPath);
  const selected = manifest.data.tasks.filter(task => !options.taskIds || options.taskIds.includes(task.id));
  if (!selected.length || options.taskIds?.some(id => !selected.some(task => task.id === id))) throw new Error('指定的任务不存在或任务列表为空');
  const image = options.config.execution?.image ?? 'node:22-alpine';
  if (!options.mock) assertDockerAvailable(image);
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const directory = resolve(options.outputDir, runId);
  mkdirSync(directory, { recursive: true });
  const metadata = harnessMetadata();
  const config: AgentConfig = {
    ...options.config,
    llm: { ...options.config.llm },
    agent: { ...options.config.agent, maxTotalTokens: options.config.agent.maxTotalTokens ?? 100000 },
    execution: { ...options.config.execution, mode: options.mock ? 'local' : 'docker', image },
    governance: { ...options.config.governance, sandbox: { allowedPaths: ['.'], allowedCommands: ['node', 'npm'] } },
    memory: { ...options.config.memory },
  };
  const safeModel = { provider: config.llm.provider, model: options.mock ? 'mock-mechanism-check' : config.llm.model,
    maxTokens: config.llm.maxTokens, temperature: config.llm.temperature };
  writeFileSync(join(directory, 'run.json'), JSON.stringify({ schemaVersion: 1, runId,
    kind: options.mock ? 'mock-mechanism-check' : 'model-evaluation', manifestHash: manifest.hash, ...metadata,
    model: safeModel, budget: config.agent, memory: config.memory, execution: config.execution,
    modes: options.modes, repetitions: options.repetitions, tasks: selected.map(task => task.id) }, null, 2));
  let rules: GuardrailRule[] = [];
  const rulesFile = resolve(config.governance.rulesFile);
  if (existsSync(rulesFile)) {
    const parsed = parse(readFileSync(rulesFile, 'utf8')) as { rules?: GuardrailRule[] };
    if (!Array.isArray(parsed?.rules)) throw new Error('治理规则格式无效');
    rules = parsed.rules;
  }
  writeFileSync(join(directory, 'policy.json'), JSON.stringify({ rules, allowedPaths: ['.'], allowedCommands: ['node', 'npm'],
    requiresApproval: 'deny', endpointHash: createHash('sha256').update(config.llm.baseUrl ?? 'provider-default').digest('hex') }, null, 2));
  let realProvider: LLMProvider | undefined;
  if (!options.mock) {
    const credentials = createCredentialManager(options.credentialPath ?? resolve('.harness/credentials'), process.env.HARNESS_MASTER_PASSWORD);
    realProvider = await createLLMProvider(config.llm, credentials);
  }
  const records: EvaluationRecord[] = [];
  for (let repetition = 1; repetition <= options.repetitions; repetition++) {
    for (const task of selected) {
      for (const mode of options.modes) {
        options.signal?.throwIfAborted();
        const startedAt = new Date().toISOString();
        const started = Date.now();
        const trialId = `${task.id}-${mode}-${repetition}`;
        const trialDirectory = join(directory, trialId);
        mkdirSync(trialDirectory, { recursive: true });
        const traceFile = join(trialDirectory, 'trace.jsonl');
        const trace = (event: object) => appendFileSync(traceFile, JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + '\n');
        const workspace = mkdtempSync(join(tmpdir(), 'harness-eval-'));
        const baseline = snapshotFiles(manifestDirectory(manifest.root, task.fixture));
        materialize(baseline, workspace);
        const provider = wrapEvaluationProvider(options.mock ? createEvaluationMock(task, manifest.root) : realProvider!, mode, options.mock, trace);
        let state = 'error';
        let stopReason = '';
        let error: string | undefined;
        let turns = 0;
        let toolCalls = 0;
        let grade: GradeResult = { passed: false, violations: [], output: '', error: '验收尚未执行' };
        try {
          const tools = createWorkspaceTools(config, workspace);
          const pipeline = createGovernancePipeline(createGuardrailEngine(rules), createHITL(), createSandbox(['.'], ['node', 'npm'], workspace));
          const onVerify = async ({ signal }: { signal?: AbortSignal }): Promise<ActionResult> => {
            const action = { type: 'run_test' as const, params: { command: task.publicTestCommand } };
            const policy = pipeline.process(action);
            const result = policy.allowed ? await tools.find(tool => tool.name === 'run_test')!.execute(action.params, { signal })
              : { success: false, output: '', error: policy.reason ?? '公开测试被治理策略拒绝' };
            trace({ type: 'public-verification', result });
            return mode === 'no-feedback' && !result.success ? { success: false, output: '', error: '公开测试未通过（消融实验移除诊断）', exitCode: result.exitCode } : result;
          };
          const loop = createAgentLoop(config, provider.provider, tools, {
            onAction(action) {
              const decision = pipeline.process(action);
              trace({ type: 'governance', action, decision });
              return { allowed: decision.allowed && !decision.requiresApproval, reason: decision.requiresApproval ? '评测不接受人工审批' : decision.reason };
            },
            onTurn: turn => trace({ type: 'tool-result', turn }),
            onStop: reason => trace({ type: 'agent-stop', reason }),
            ...(mode === 'baseline' ? {} : { onVerify }),
          });
          try {
            const result = await loop.run(`${task.prompt}\n只允许修改：${task.allowedChanges.join(', ')}。不得新增文件或修改 package.json、公开测试、README。`, { signal: options.signal });
            state = result.state; stopReason = result.stopReason; turns = result.turns;
            toolCalls = result.history.filter(turn => turn.action).length;
          } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
            const checkpoint = loop.exportCheckpoint();
            state = checkpoint?.state ?? 'error'; stopReason = error; turns = checkpoint?.turns ?? 0;
            toolCalls = checkpoint?.history.filter(turn => turn.action).length ?? 0;
            trace({ type: 'agent-error', error });
          }
          grade = await gradeCandidate({ workspace, acceptance: manifestDirectory(manifest.root, task.acceptance), baseline,
            allowedChanges: task.allowedChanges, mock: options.mock, image, timeoutMs: Math.min(config.agent.timeout, 30000), signal: options.signal });
          trace({ type: 'hidden-grade', grade });
          try {
            const finalFiles = snapshotFiles(workspace);
            writeFileSync(join(trialDirectory, 'changes.diff'), renderDiff(baseline, finalFiles));
            materialize(finalFiles, join(trialDirectory, 'candidate'));
          } catch (caught) {
            const artifactError = caught instanceof Error ? caught.message : String(caught);
            error = error ? `${error}; ${artifactError}` : artifactError;
            writeFileSync(join(trialDirectory, 'changes.diff'), `候选目录无法安全导出：${artifactError}\n`);
          }
        } catch (caught) {
          const evaluationError = caught instanceof Error ? caught.message : String(caught);
          state = 'error'; stopReason = 'evaluation error';
          error = error ? `${error}; ${evaluationError}` : evaluationError;
          trace({ type: 'evaluation-error', error });
          if (!existsSync(join(trialDirectory, 'changes.diff'))) writeFileSync(join(trialDirectory, 'changes.diff'), '评测过程异常，未能导出候选变化。\n');
        } finally {
          // workspace 来自 mkdtemp，且从未改变路径；只删除本次创建的临时目录。
          rmSync(workspace, { recursive: true, force: true });
        }
        const record: EvaluationRecord = { schemaVersion: 1, runId, taskId: task.id, mode, repetition, startedAt,
          kind: options.mock ? 'mock-mechanism-check' : 'model-evaluation', success: state === 'completed' && grade.passed && !error,
          state, stopReason, ...(error ? { error } : {}), turns, toolCalls, elapsedMs: Date.now() - started,
          ...provider.statistics(), cost: null, grade, manifestHash: manifest.hash, ...metadata,
          model: safeModel, budget: config.agent, execution: { mode: options.mock ? 'local' : 'docker', image: options.mock ? undefined : image },
          artifacts: { diff: `${trialId}/changes.diff`, trace: `${trialId}/trace.jsonl`, candidate: `${trialId}/candidate` } };
        records.push(record);
        appendRecord(directory, record);
        writeReport(directory, records);
      }
    }
  }
  return { directory, records };
}

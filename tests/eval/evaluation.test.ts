import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, chmodSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { DefaultConfig } from '../../src/config/loader';
import { buildGradeArguments, gradeCandidate, prepareGradeDirectories, gradeIdentity } from '../../src/eval/grader';
import { hashFiles, loadManifest, manifestDirectory, snapshotFiles } from '../../src/eval/manifest';
import { runEvaluation } from '../../src/eval/runner';
import { hideFailureDiagnostics, wrapEvaluationProvider } from '../../src/eval/variants';
import { decodeValue, encodeValue } from '../../src/eval/rpc-codec';

const manifestPath = resolve('eval/manifest.json');

function materialize(files: Map<string, Buffer>, directory: string): void {
  for (const [path, bytes] of files) {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
}

describe('可复现评测边界', () => {
  it.skipIf(process.platform === 'win32')('Linux 评分副本与 RPC 服务允许 nobody 读取，原始私有工作区权限不变', () => {
    const directory = mkdtempSync(join(tmpdir(), 'grade-mode-test-'));
    const original = mkdtempSync(join(tmpdir(), 'grade-private-test-'));
    try {
      chmodSync(original, 0o700);
      mkdirSync(join(original, 'src')); writeFileSync(join(original, 'src/code.cjs'), 'module.exports = {};');
      const prepared = prepareGradeDirectories(directory, snapshotFiles(original), true);
      for (const folder of [directory, prepared.candidate, join(prepared.candidate, 'src'), prepared.service]) expect(statSync(folder).mode & 0o777).toBe(0o755);
      for (const file of [join(prepared.candidate, 'src/code.cjs'), join(prepared.service, 'server.cjs')]) expect(statSync(file).mode & 0o777).toBe(0o644);
      expect(statSync(original).mode & 0o777).toBe(0o700);
    } finally { rmSync(directory, { recursive: true, force: true }); rmSync(original, { recursive: true, force: true }); }
  });

  it.skipIf(process.platform === 'win32')('非 root Linux 评分沿用宿主 UID/GID，私有副本无需放宽权限', () => {
    const directory = mkdtempSync(join(tmpdir(), 'grade-private-copy-test-'));
    try {
      const prepared = prepareGradeDirectories(directory, new Map([['src/code.cjs', Buffer.from('module.exports = {};')]]), false);
      expect(statSync(directory).mode & 0o777).toBe(0o700);
      expect(statSync(prepared.candidate).mode & 0o777).toBe(0o700);
      expect(statSync(join(prepared.candidate, 'src/code.cjs')).mode & 0o777).toBe(0o600);
      if (process.getuid?.() !== 0) expect(gradeIdentity().user).toBe(`${process.getuid?.()}:${process.getgid?.()}`);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('RPC 数据协议保留特殊数字、共享引用与无原型对象，拒绝可执行值', () => {
    const object = Object.create(null); object.key = NaN;
    const input = [object, object, -0, undefined];
    const output = decodeValue(encodeValue(input)) as unknown[];
    expect(output[0]).toBe(output[1]); expect(Object.getPrototypeOf(output[0])).toBeNull();
    expect(Number.isNaN((output[0] as Record<string, number>).key)).toBe(true);
    expect(Object.is(output[2], -0)).toBe(true); expect(output[3]).toBeUndefined();
    expect(() => encodeValue(() => {})).toThrow('可执行值');
    expect(() => decodeValue({ root: { ref: 999 }, nodes: [] })).toThrow();
  });
  it('10 个冻结任务原始代码验收失败，固定修复均通过隐藏验收', async ({ signal }) => {
    const manifest = loadManifest(manifestPath);
    expect(manifest.data.tasks).toHaveLength(10);
    expect(loadManifest(manifestPath).hash).toBe(manifest.hash);
    for (const task of manifest.data.tasks) {
      signal.throwIfAborted();
      const workspace = mkdtempSync(join(tmpdir(), 'eval-fixture-test-'));
      try {
        const baseline = snapshotFiles(manifestDirectory(manifest.root, task.fixture));
        materialize(baseline, workspace);
        const options = { workspace, acceptance: manifestDirectory(manifest.root, task.acceptance), baseline,
          allowedChanges: task.allowedChanges, mock: true, image: 'node:22-alpine', timeoutMs: 10000, signal };
        expect((await gradeCandidate(options)).passed, `${task.id} 原始代码应失败`).toBe(false);
        signal.throwIfAborted();
        materialize(snapshotFiles(manifestDirectory(manifest.root, task.mockSolution)), workspace);
        expect((await gradeCandidate(options)).passed, `${task.id} 固定修复应通过`).toBe(true);
      } finally { rmSync(workspace, { recursive: true, force: true }); }
    }
  // Windows 逐次清理进程树有固定开销；20 次真实评分需要独立的测试总时限。
  }, 120000);

  it('即使修改后代码正确，新增文件和篡改公开测试也必须失败', async () => {
    const manifest = loadManifest(manifestPath); const task = manifest.data.tasks[0];
    const workspace = mkdtempSync(join(tmpdir(), 'eval-tamper-test-'));
    try {
      const baseline = snapshotFiles(manifestDirectory(manifest.root, task.fixture));
      materialize(baseline, workspace);
      materialize(snapshotFiles(manifestDirectory(manifest.root, task.mockSolution)), workspace);
      writeFileSync(join(workspace, 'unexpected.cjs'), '');
      writeFileSync(join(workspace, 'test/public.test.cjs'), '');
      const result = await gradeCandidate({ workspace, acceptance: manifestDirectory(manifest.root, task.acceptance), baseline,
        allowedChanges: task.allowedChanges, mock: true, image: 'unused', timeoutMs: 10000 });
      expect(result.passed).toBe(false);
      expect(result.violations).toEqual(['test/public.test.cjs', 'unexpected.cjs']);
    } finally { rmSync(workspace, { recursive: true, force: true }); }
  });

  it('清单路径不能穿越边界，内容哈希会随验收内容变化', () => {
    expect(() => manifestDirectory(resolve('eval'), '../src')).toThrow();
    expect(hashFiles(new Map([['a', Buffer.from('original')]]))).not.toBe(hashFiles(new Map([['a', Buffer.from('changed')]])));
  });

  it('候选模块提前退出不能伪造验收成功', async () => {
    const manifest = loadManifest(manifestPath); const task = manifest.data.tasks[0];
    const workspace = mkdtempSync(join(tmpdir(), 'eval-exit-test-'));
    try {
      const baseline = snapshotFiles(manifestDirectory(manifest.root, task.fixture));
      materialize(baseline, workspace);
      writeFileSync(join(workspace, 'src/clamp.cjs'), "console.log('隐藏验收通过'); process.exit(0);");
      const result = await gradeCandidate({ workspace, acceptance: manifestDirectory(manifest.root, task.acceptance), baseline,
        allowedChanges: task.allowedChanges, mock: true, image: 'unused', timeoutMs: 10000 });
      expect(result.passed).toBe(false); expect(result.error).toMatch(/RPC 协议错误|提前退出/);
    } finally { rmSync(workspace, { recursive: true, force: true }); }
  });

  it('隐藏验收在独立只读、断网、无权限容器中运行', () => {
    const args = buildGradeArguments(resolve('candidate'), resolve('rpc-service'), 'node:22-alpine', 'grader');
    expect(args).toContain('none'); expect(args).toContain('--read-only'); expect(args).toContain('ALL');
    expect(args.filter(value => value.startsWith('type=bind'))).toEqual([
      `type=bind,src=${resolve('candidate')},dst=/candidate,readonly`,
      `type=bind,src=${resolve('rpc-service')},dst=/rpc,readonly`,
    ]);
    expect(args).not.toContain('-e');
    expect(args.join(' ')).not.toContain('acceptance');
  });
});

describe('对照实验与用量记录', () => {
  it('no-feedback 删除失败诊断，同时保持原生工具调用关联', () => {
    const messages = [
      { role: 'assistant', content: '', toolCalls: [{ id: 'call1', name: 'run_test', arguments: { command: 'npm test' } }] },
      { role: 'tool', toolCallId: 'call1', name: 'run_test', content: JSON.stringify({ success: false, output: 'secret failing assertion', error: 'details', exitCode: 1 }) },
      { role: 'user', content: '独立验收失败，请根据报错继续修复：{"success":false,"output":"more assertions"}' },
    ];
    const hidden = hideFailureDiagnostics(messages);
    expect(hidden[1].toolCallId).toBe('call1'); expect(hidden[0].toolCalls).toEqual(messages[0].toolCalls);
    expect(hidden[1].content).not.toContain('secret failing assertion'); expect(hidden[2].content).not.toContain('more assertions');
    expect(JSON.parse(hidden[1].content).success).toBe(false);
    expect(messages[1].content).toContain('secret failing assertion');
  });

  it('真实与估算用量分开，mock 不能冒充服务端用量', async () => {
    let calls = 0;
    const wrapped = wrapEvaluationProvider({ name: 'stub', async complete() {
      return ++calls === 1 ? { content: 'ok', usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } } : { content: 'ok' };
    } }, 'full', false);
    await wrapped.provider.complete([{ role: 'user', content: 'task' }]);
    await wrapped.provider.complete([{ role: 'user', content: 'task' }]);
    expect(wrapped.statistics().realUsage?.totalTokens).toBe(12);
    expect(wrapped.statistics().estimatedUsage?.totalTokens).toBeGreaterThan(0);
    expect(wrapped.statistics().usageEstimated).toBe(true);
    const mock = wrapEvaluationProvider({ name: 'mock', async complete() { return { content: 'ok', usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } }; } }, 'full', true);
    await mock.provider.complete([]);
    expect(mock.statistics().realUsage).toBeNull();
  });

  it('全部任务离线通过管道，模式确有区别且预算相同，结果明确标注 mock', async ({ signal }) => {
    const outputDir = mkdtempSync(join(tmpdir(), 'eval-pipeline-test-'));
    const oldPath = process.env.PATH; const oldWindowsPath = process.env.Path;
    const commandPath = dirname(process.execPath) + (process.platform === 'win32' ? ';' : ':') + (oldPath ?? oldWindowsPath ?? '');
    process.env.PATH = commandPath; process.env.Path = commandPath;
    try {
      const config = { ...DefaultConfig, agent: { maxTurns: 20, timeout: 60000, maxTotalTokens: 200000 }, memory: { ...DefaultConfig.memory, maxConversationTurns: 20 } };
      const full = await runEvaluation({ manifestPath, outputDir, config, modes: ['full'], repetitions: 1, mock: true, signal });
      expect(full.records).toHaveLength(10);
      for (const record of full.records) {
        expect(record.success, record.taskId + ': ' + JSON.stringify({ state: record.state, stopReason: record.stopReason, error: record.error, grade: record.grade })).toBe(true);
        expect(record.kind).toBe('mock-mechanism-check'); expect(record.realUsage).toBeNull(); expect(record.cost).toBeNull();
        const trace = readFileSync(join(full.directory, record.artifacts.trace), 'utf8');
        expect(trace).toContain('public-verification'); expect(trace).toContain('hidden-grade');
        expect(readFileSync(join(full.directory, record.artifacts.diff), 'utf8')).toContain('diff --git');
      }
      const controls = await runEvaluation({ manifestPath, outputDir, config, modes: ['baseline', 'no-feedback'], repetitions: 1, mock: true, taskIds: ['01-clamp'], signal });
      expect(controls.records.every(record => record.success)).toBe(true);
      expect(controls.records[0].budget).toEqual(controls.records[1].budget);
      const baselineTrace = readFileSync(join(controls.directory, controls.records[0].artifacts.trace), 'utf8');
      expect(baselineTrace).not.toContain('public-verification');
      const noFeedbackTrace = readFileSync(join(controls.directory, controls.records[1].artifacts.trace), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
      const modelRequests = noFeedbackTrace.filter(event => event.type === 'model-request');
      expect(JSON.stringify(modelRequests)).toContain('消融实验移除诊断');
      expect(readFileSync(join(full.directory, 'report.md'), 'utf8')).toContain('禁止把本项数字作为 Agent 成功率');
      expect(readFileSync(join(full.directory, 'results.jsonl'), 'utf8').trim().split('\n')).toHaveLength(10);
    } finally {
      if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
      if (oldWindowsPath === undefined) delete process.env.Path; else process.env.Path = oldWindowsPath;
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 120000);

  it('预算耗尽的尝试仍保存 Diff、Trace 与失败记录并计入报告', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'eval-failure-test-'));
    try {
      const config = { ...DefaultConfig, agent: { maxTurns: 1, timeout: 10000, maxTotalTokens: 100000 } };
      const result = await runEvaluation({ manifestPath, outputDir, config, modes: ['full'], repetitions: 1, mock: true, taskIds: ['01-clamp'] });
      expect(result.records).toHaveLength(1);
      expect(result.records[0].success).toBe(false);
      expect(result.records[0].stopReason).toBe('maxTurns reached');
      expect(result.records[0].grade.passed).toBe(false);
      expect(readFileSync(join(result.directory, 'results.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
      expect(readFileSync(join(result.directory, 'report.md'), 'utf8')).toContain('0/1');
      expect(readFileSync(join(result.directory, result.records[0].artifacts.trace), 'utf8')).toContain('hidden-grade');
    } finally { rmSync(outputDir, { recursive: true, force: true }); }
  });
});

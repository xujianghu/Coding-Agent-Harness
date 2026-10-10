import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { gradeCandidate } from '../../src/eval/grader';
import { loadManifest, manifestDirectory, snapshotFiles } from '../../src/eval/manifest';

const dockerTests = process.env.HARNESS_DOCKER_TESTS === '1' ? describe : describe.skip;

function materialize(files: Map<string, Buffer>, directory: string): void {
  for (const [path, bytes] of files) {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
}

dockerTests('可信父评分器与独立候选 Docker RPC', () => {
  it('10 项固定正确候选通过真实隔离验收，不调用任何模型', async () => {
    const manifest = loadManifest(resolve('eval/manifest.json'));
    for (const task of manifest.data.tasks) {
      const workspace = mkdtempSync(join(tmpdir(), 'grade-docker-test-'));
      try {
        const baseline = snapshotFiles(manifestDirectory(manifest.root, task.fixture));
        materialize(baseline, workspace);
        materialize(snapshotFiles(manifestDirectory(manifest.root, task.mockSolution)), workspace);
        const result = await gradeCandidate({ workspace, acceptance: manifestDirectory(manifest.root, task.acceptance), baseline,
          allowedChanges: task.allowedChanges, mock: false, image: 'node:22-alpine', timeoutMs: 15000 });
        expect(result.passed, task.id + ': ' + result.error).toBe(true);
      } finally { rmSync(workspace, { recursive: true, force: true }); }
    }
  }, 120000);

  it('候选源码只读、看不到隐藏验收、不继承宿主密钥，伪造 stdout 无法通过', async () => {
    const manifest = loadManifest(resolve('eval/manifest.json')); const task = manifest.data.tasks[0];
    const workspace = mkdtempSync(join(tmpdir(), 'grade-isolation-test-'));
    vi.stubEnv('OPENAI_API_KEY', 'fixture-host-secret');
    try {
      const baseline = snapshotFiles(manifestDirectory(manifest.root, task.fixture));
      materialize(baseline, workspace);
      const source = `
        const fs=require('node:fs'); const os=require('node:os');
        if(process.getuid()===0) throw new Error('candidate must be non-root');
        if(process.env.OPENAI_API_KEY) throw new Error('host credential exposed');
        if(fs.existsSync('/grader')||fs.existsSync('/acceptance')) throw new Error('hidden tests mounted');
        if(Object.values(os.networkInterfaces()).flat().some(entry=>!entry.internal)) throw new Error('network available');
        let writable=false; try {fs.writeFileSync(__filename,'tampered'); writable=true;} catch {}
        if(writable) throw new Error('candidate mount writable');
        module.exports.clamp=(value,min,max)=>{if(min>max)throw new RangeError('invalid range');return Math.max(min,Math.min(max,value));};
      `;
      writeFileSync(join(workspace, 'src/clamp.cjs'), source);
      const options = { workspace, acceptance: manifestDirectory(manifest.root, task.acceptance), baseline,
        allowedChanges: task.allowedChanges, mock: false, image: 'node:22-alpine', timeoutMs: 15000 };
      expect((await gradeCandidate(options)).passed).toBe(true);
      expect(readFileSync(join(workspace, 'src/clamp.cjs'), 'utf8')).toBe(source);
      writeFileSync(join(workspace, 'src/clamp.cjs'), "console.log('隐藏验收通过'); process.exit(0);");
      const attack = await gradeCandidate(options);
      expect(attack.passed).toBe(false); expect(attack.error).toMatch(/RPC 协议错误|提前退出/);
    } finally { vi.unstubAllEnvs(); rmSync(workspace, { recursive: true, force: true }); }
  }, 45000);

  it('超时与取消在返回前终止候选容器', async () => {
    const manifest = loadManifest(resolve('eval/manifest.json')); const task = manifest.data.tasks[0];
    const workspace = mkdtempSync(join(tmpdir(), 'grade-cancel-test-'));
    try {
      const baseline = snapshotFiles(manifestDirectory(manifest.root, task.fixture));
      materialize(baseline, workspace);
      writeFileSync(join(workspace, 'src/clamp.cjs'), 'module.exports.clamp=()=>new Promise(()=>{});');
      const options = { workspace, acceptance: manifestDirectory(manifest.root, task.acceptance), baseline,
        allowedChanges: task.allowedChanges, mock: false, image: 'node:22-alpine', timeoutMs: 700 };
      const timeout = await gradeCandidate(options);
      expect(timeout.passed).toBe(false); expect(timeout.error).toContain('超时');
      const controller = new AbortController();
      const running = gradeCandidate({ ...options, timeoutMs: 15000, signal: controller.signal });
      setTimeout(() => controller.abort(), 700);
      const cancel = await running;
      expect(cancel.passed).toBe(false); expect(cancel.error).toContain('取消');
      expect(execFileSync('docker', ['ps', '-aq', '--filter', 'name=harness-grade-'], { encoding: 'utf8' }).trim()).toBe('');
    } finally { rmSync(workspace, { recursive: true, force: true }); }
  }, 30000);
});

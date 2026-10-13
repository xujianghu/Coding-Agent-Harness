import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { createCommandExecutor } from '../../src/tools/executor';
import { createApplyPatchTool } from '../../src/tools/edit';

const dockerTests = process.env.HARNESS_DOCKER_TESTS === '1' ? describe : describe.skip;

dockerTests('CommandExecutor Docker 真实隔离', () => {
  let fixture: string;
  let workspace: string;
  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), 'harness-docker-'));
    workspace = join(fixture, 'workspace');
    mkdirSync(workspace);
    chmodSync(workspace, 0o777);
  });
  afterEach(() => { rmSync(fixture, { recursive: true, force: true }); vi.unstubAllEnvs(); });

  it('容器创建文件后宿主补丁工具仍可写入', async () => {
    writeFileSync(join(workspace, 'create.cjs'), 'require("fs").writeFileSync("created.txt","before",{mode:0o600})');
    const result = await createCommandExecutor({ mode: 'docker', workspaceRoot: workspace }).execute('node create.cjs');
    expect(result.success, result.error).toBe(true);
    const patched = await createApplyPatchTool(workspace).execute({ path: 'created.txt', old_text: 'before', new_text: 'after' });
    expect(patched.success, patched.error).toBe(true);
    expect(readFileSync(join(workspace, 'created.txt'), 'utf8')).toBe('after');
  }, 30000);

  it('可修改工作区，但不能读凭据、改敏感挂载点、写系统根目录或继承宿主密钥', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'fixture-host-secret');
    mkdirSync(join(workspace, '.git'));
    mkdirSync(join(workspace, '.harness'));
    mkdirSync(join(workspace, 'nested'));
    writeFileSync(join(workspace, '.git', 'config'), 'fixture-git-secret');
    writeFileSync(join(workspace, '.harness', 'credentials.json'), 'fixture-harness-secret');
    writeFileSync(join(workspace, '.env'), 'fixture-env-secret');
    writeFileSync(join(workspace, 'nested', '.env.production'), 'fixture-nested-secret');
    writeFileSync(join(workspace, 'nested', 'private.key'), 'fixture-key-secret');
    writeFileSync(join(fixture, 'outside.txt'), 'fixture-outside-secret');
    writeFileSync(join(workspace, 'inspect.cjs'), `
      const fs = require('fs');
      const os = require('os');
      const result = {cwd:process.cwd(), key:process.env.OPENAI_API_KEY ?? null};
      result.env = fs.readFileSync('.env','utf8');
      result.nestedEnv = fs.readFileSync('nested/.env.production','utf8');
      result.privateKey = fs.readFileSync('nested/private.key','utf8');
      result.git = fs.readdirSync('.git');
      result.harness = fs.readdirSync('.harness');
      try { fs.writeFileSync('.env','tampered'); result.envWritable=true; } catch {result.envWritable=false;}
      try { fs.writeFileSync('/etc/escape','tampered'); result.rootWritable=true; } catch {result.rootWritable=false;}
      result.network = Object.values(os.networkInterfaces()).flat().every(entry=>entry.internal);
      fs.writeFileSync('result.txt','written');
      console.log(JSON.stringify(result));
    `);
    const result = await createCommandExecutor({ mode: 'docker', workspaceRoot: workspace, timeoutMs: 15000 }).execute('node inspect.cjs');
    expect(result.success, result.error).toBe(true);
    expect(JSON.parse(result.output)).toEqual({
      cwd: '/workspace', key: null, env: '', nestedEnv: '', privateKey: '', git: [], harness: [], envWritable: false, rootWritable: false, network: true,
    });
    expect(readFileSync(join(workspace, '.env'), 'utf-8')).toBe('fixture-env-secret');
    expect(readFileSync(join(workspace, 'result.txt'), 'utf-8')).toBe('written');
  }, 30000);

  it('超时与取消清理容器，后代无法继续写入', async () => {
    writeFileSync(join(workspace, 'wait.cjs'), 'setTimeout(()=>require("fs").writeFileSync("late.txt","escaped"),3000);setInterval(()=>{},1000)');
    const result = await createCommandExecutor({ mode: 'docker', workspaceRoot: workspace, timeoutMs: 700 }).execute('node wait.cjs');
    expect(result.exitCode).toBe(124);
    const controller = new AbortController();
    const running = createCommandExecutor({ mode: 'docker', workspaceRoot: workspace }).execute('node wait.cjs', { signal: controller.signal });
    setTimeout(() => controller.abort(), 700);
    expect((await running).exitCode).toBe(130);
    await new Promise((done) => setTimeout(done, 3100));
    expect(existsSync(join(workspace, 'late.txt'))).toBe(false);
    const remaining = execFileSync('docker', ['ps', '-aq', '--filter', 'name=harness-'], { encoding: 'utf-8' }).trim();
    expect(remaining).toBe('');
  }, 30000);

  it('启动容器前拒绝外部符号链接', async () => {
    const outside = join(fixture, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(workspace, 'escape'), 'junction');
    const result = await createCommandExecutor({ mode: 'docker', workspaceRoot: workspace }).execute('node -v');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsafe workspace symlink');
  });

  it('拒绝敏感文件的硬链接别名，防止只读遮罩被另一个文件名绕过', async () => {
    writeFileSync(join(workspace, '.env'), 'fixture-secret');
    linkSync(join(workspace, '.env'), join(workspace, 'alias.txt'));
    const result = await createCommandExecutor({ mode: 'docker', workspaceRoot: workspace }).execute('node -v');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Hard-linked');
  });
});

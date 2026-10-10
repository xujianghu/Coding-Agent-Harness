import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createCommandExecutor, type CommandExecutor } from '../../src/tools/executor';
import { createShellTool } from '../../src/tools/shell';
import { createTestRunnerTool } from '../../src/tools/test-runner';
import { createLintTool } from '../../src/tools/lint';

let workspace: string;
beforeEach(() => { workspace = mkdtempSync(join(tmpdir(), 'harness-executor-')); });
afterEach(() => { rmSync(workspace, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe('CommandExecutor 本地模式', () => {
  it('使用指定工作区并清理 API Key 环境变量', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'fixture-secret');
    writeFileSync(join(workspace, 'inspect.cjs'), 'console.log(JSON.stringify({cwd:process.cwd(), secret:process.env.OPENAI_API_KEY ?? null}))');
    const result = await createCommandExecutor({ mode: 'local', workspaceRoot: workspace }).execute('node inspect.cjs');
    expect(result.success).toBe(true);
    expect(JSON.parse(result.output)).toEqual({ cwd: workspace, secret: null });
  });

  it('输出超限终止进程并保持结果有界', async () => {
    writeFileSync(join(workspace, 'output.cjs'), 'setInterval(()=>process.stdout.write("x".repeat(4096)),1)');
    const result = await createCommandExecutor({ mode: 'local', workspaceRoot: workspace, maxOutputBytes: 1024 }).execute('node output.cjs');
    expect(result.success).toBe(false);
    expect(result.error).toContain('output limit');
    expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(1024);
  });

  it('超时后终止子进程树，后代不能继续修改工作区', async () => {
    writeFileSync(join(workspace, 'grandchild.cjs'), 'let tick=0;setInterval(()=>require("fs").writeFileSync("ticks.txt",String(++tick)),50)');
    writeFileSync(join(workspace, 'parent.cjs'), 'require("child_process").spawn(process.execPath,["grandchild.cjs"],{stdio:"ignore"});setInterval(()=>{},1000)');
    const result = await createCommandExecutor({ mode: 'local', workspaceRoot: workspace, timeoutMs: 300 }).execute('node parent.cjs');
    expect(result.exitCode).toBe(124);
    expect(result.error).toContain('timed out');
    // 清理返回后不再写入；Windows 的 taskkill 本身有启动延迟。
    const marker = join(workspace, 'ticks.txt');
    const afterStop = existsSync(marker) ? readFileSync(marker, 'utf-8') : null;
    await new Promise((done) => setTimeout(done, 300));
    expect(existsSync(marker) ? readFileSync(marker, 'utf-8') : null).toBe(afterStop);
  });

  it('AbortSignal 中止运行中的命令', async () => {
    writeFileSync(join(workspace, 'wait.cjs'), 'setInterval(()=>{},1000)');
    const controller = new AbortController();
    const running = createCommandExecutor({ mode: 'local', workspaceRoot: workspace }).execute('node wait.cjs', { signal: controller.signal });
    setTimeout(() => controller.abort(), 150);
    const result = await running;
    expect(result.exitCode).toBe(130);
    expect(result.error).toContain('aborted');
  });

  it('已取消的命令不启动任何进程', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await createCommandExecutor({ mode: 'local', workspaceRoot: workspace }).execute('echo test', { signal: controller.signal });
    expect(result.exitCode).toBe(130);
    expect(result.output).toBe('');
  });

  it.each([createShellTool, createTestRunnerTool, createLintTool])('三个命令工具都使用注入执行器并转发上下文', async (createTool) => {
    const executor: CommandExecutor = { execute: vi.fn().mockResolvedValue({ success: true, output: 'fixture-result' }) };
    const controller = new AbortController();
    const tool = createTool(executor);
    expect((await tool.execute({ command: 'npm test' }, { signal: controller.signal })).output).toBe('fixture-result');
    expect(executor.execute).toHaveBeenCalledWith('npm test', { signal: controller.signal });
  });
});

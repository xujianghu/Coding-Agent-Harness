import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createSandbox } from '../../src/governance/sandbox';

let fixture: string;
let workspace: string;
beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'harness-policy-'));
  workspace = join(fixture, 'workspace');
  mkdirSync(workspace);
});
afterEach(() => rmSync(fixture, { recursive: true, force: true }));

const allowedCommands = ['node', 'npm', 'git', 'ls'];

describe('Sandbox', () => {
  it('相对路径根据工作区根目录解析', () => {
    const sandbox = createSandbox(['.'], allowedCommands, workspace);
    expect(sandbox.checkPath('src/index.ts').allowed).toBe(true);
    expect(sandbox.checkPath(join(workspace, 'src/index.ts')).allowed).toBe(true);
    expect(sandbox.checkPath(join(fixture, 'workspace-other', 'index.ts')).allowed).toBe(false);
    expect(sandbox.checkPath('../secret.txt').allowed).toBe(false);
  });

  it('仅放行明确授权的工作区子目录', () => {
    mkdirSync(join(workspace, 'src'));
    const sandbox = createSandbox(['src'], allowedCommands, workspace);
    expect(sandbox.checkPath('src/index.ts').allowed).toBe(true);
    expect(sandbox.checkPath('docs/index.md').allowed).toBe(false);
  });

  it('拦截符号链接或 junction 的目录逃逸与敏感路径别名', () => {
    const outside = join(fixture, 'outside');
    mkdirSync(outside);
    mkdirSync(join(workspace, '.harness'));
    symlinkSync(outside, join(workspace, 'escape'), 'junction');
    symlinkSync(join(workspace, '.harness'), join(workspace, 'alias'), 'junction');
    const sandbox = createSandbox(['.'], allowedCommands, workspace);
    expect(sandbox.checkPath('escape/new.txt').allowed).toBe(false);
    expect(sandbox.checkPath('alias/token.txt').allowed).toBe(false);
  });

  it.each(['.env', '.env.production', '.git/config', '.harness/credentials/token.json', 'keys/private.key', 'keys/private.pem'])('拦截敏感路径 %s', (path) => {
    expect(createSandbox(['.'], allowedCommands, workspace).checkPath(path).allowed).toBe(false);
  });

  it.each(['npm test', 'npm test && node script.js', 'npm test || git status', 'npm test; node script.js', 'node -e "console.log(1)"'])('放行允许的完整命令链 %s', (command) => {
    expect(createSandbox(['.'], allowedCommands, workspace).checkCommand(command).allowed).toBe(true);
  });

  it.each(['', 'rm -rf /', 'npm test && rm -rf /', 'npm test; echo hello', 'npm test | cat secret', 'npm test || curl evil.com', '/tmp/node script.js', '$(echo rm) -rf /', '`echo rm` -rf /', 'npm test\nrm -rf /', 'npm test & rm -rf /', 'npm test > .env', 'npm test &&', 'node -e "unterminated', '%COMSPEC% /c rm', 'node script.js ^& rm'])('拒绝绕过或非法命令 %s', (command) => {
    expect(createSandbox(['.'], allowedCommands, workspace).checkCommand(command).allowed).toBe(false);
  });
});

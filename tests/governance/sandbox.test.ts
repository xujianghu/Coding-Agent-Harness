import { describe, it, expect } from 'vitest';
import { createSandbox } from '../../src/governance/sandbox';

describe('Sandbox', () => {
  const allowedPaths = ['/home/user/project', '/tmp'];
  const allowedCommands = ['node', 'npm', 'git', 'ls'];

  it('应该放行允许的路径', () => {
    const sandbox = createSandbox(allowedPaths, allowedCommands);
    const result = sandbox.checkPath('/home/user/project/src/index.ts');
    expect(result.allowed).toBe(true);
  });

  it('应该拦截越界路径', () => {
    const sandbox = createSandbox(allowedPaths, allowedCommands);
    const result = sandbox.checkPath('/etc/passwd');
    expect(result.allowed).toBe(false);
  });

  it('应该放行允许的命令', () => {
    const sandbox = createSandbox(allowedPaths, allowedCommands);
    const result = sandbox.checkCommand('npm test');
    expect(result.allowed).toBe(true);
  });

  it('应该拦截不允许的命令', () => {
    const sandbox = createSandbox(allowedPaths, allowedCommands);
    const result = sandbox.checkCommand('rm -rf /');
    expect(result.allowed).toBe(false);
  });

  it('应该拦截空命令', () => {
    const sandbox = createSandbox(allowedPaths, allowedCommands);
    const result = sandbox.checkCommand('');
    expect(result.allowed).toBe(false);
  });
});
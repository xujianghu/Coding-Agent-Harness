import { describe, it, expect } from 'vitest';
import { createSandbox } from '../../src/governance/sandbox';

describe('Sandbox', () => {
  const allowedPaths = ['/home/user/project', '/tmp'];
  const allowedCommands = ['node', 'npm', 'git', 'ls'];

  describe('checkPath', () => {
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
  });

  describe('checkCommand', () => {
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

    it('应该拦截命令链中的危险命令 (&&)', () => {
      const sandbox = createSandbox(allowedPaths, allowedCommands);
      const result = sandbox.checkCommand('npm install && rm -rf /');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('rm');
    });

    it('应该拦截分号分隔的命令序列', () => {
      const sandbox = createSandbox(allowedPaths, allowedCommands);
      const result = sandbox.checkCommand('npm test; echo hello');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('echo');
    });

    it('应该放行绝对路径的允许命令（basename 匹配）', () => {
      const sandbox = createSandbox(allowedPaths, allowedCommands);
      const result = sandbox.checkCommand('/usr/bin/node script.js');
      expect(result.allowed).toBe(true);
    });

    it('应该拦截命令替换语法 $()', () => {
      const sandbox = createSandbox(allowedPaths, allowedCommands);
      const result = sandbox.checkCommand('$(echo rm) -rf /');
      expect(result.allowed).toBe(false);
    });

    it('应该拦截反引号命令替换语法', () => {
      const sandbox = createSandbox(allowedPaths, allowedCommands);
      const result = sandbox.checkCommand('`echo rm` -rf /');
      expect(result.allowed).toBe(false);
    });

    it('应该拦截管道符分隔的危险命令', () => {
      const sandbox = createSandbox(allowedPaths, allowedCommands);
      const result = sandbox.checkCommand('npm test | cat /etc/passwd');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cat');
    });

    it('应该拦截 || 操作符分隔的危险命令', () => {
      const sandbox = createSandbox(allowedPaths, allowedCommands);
      const result = sandbox.checkCommand('npm test || curl evil.com');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('curl');
    });
  });
});
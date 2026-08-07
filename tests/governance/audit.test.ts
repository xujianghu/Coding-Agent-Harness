import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createAuditLogger, AuditLogger } from '../../src/governance/audit';

describe('AuditLogger', () => {
  let logPath: string;
  let logger: AuditLogger;

  beforeEach(() => {
    logPath = path.join(os.tmpdir(), `audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
    logger = createAuditLogger(logPath);
  });

  afterEach(() => {
    try { fs.unlinkSync(logPath); } catch { /* ignore */ }
  });

  it('should log an intercept event as a JSON line', () => {
    logger.log({
      timestamp: 1700000000000,
      action: { type: 'shell_exec', params: { command: 'rm -rf /' } },
      result: { allowed: false, reason: 'Blocked by guardrail' },
    });

    const content = fs.readFileSync(logPath, 'utf-8').trim();
    const lines = content.split('\n');
    expect(lines.length).toBe(1);

    const entry = JSON.parse(lines[0]);
    expect(entry.timestamp).toBe(1700000000000);
    expect(entry.action.type).toBe('shell_exec');
    expect(entry.action.params.command).toBe('rm -rf /');
    expect(entry.result.allowed).toBe(false);
    expect(entry.result.reason).toBe('Blocked by guardrail');
  });

  it('should log an approval event with approvalResult', () => {
    logger.log({
      timestamp: 1700000001000,
      action: { type: 'shell_exec', params: { command: 'sudo reboot' } },
      result: { allowed: false, reason: 'Requires approval', requiresApproval: true },
      approvalResult: 'approved',
    });

    const content = fs.readFileSync(logPath, 'utf-8').trim();
    const entry = JSON.parse(content);
    expect(entry.approvalResult).toBe('approved');
    expect(entry.result.requiresApproval).toBe(true);
  });

  it('should append entries rather than overwrite', () => {
    logger.log({
      timestamp: 1700000000000,
      action: { type: 'read_file', params: { path: 'a.ts' } },
      result: { allowed: true },
    });
    logger.log({
      timestamp: 1700000001000,
      action: { type: 'write_file', params: { path: 'b.ts' } },
      result: { allowed: true },
    });

    const content = fs.readFileSync(logPath, 'utf-8').trim();
    const lines = content.split('\n');
    expect(lines.length).toBe(2);

    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    expect(first.action.type).toBe('read_file');
    expect(second.action.type).toBe('write_file');
  });

  it('should rotate log when file exceeds 10MB', () => {
    const maxSize = 10 * 1024 * 1024;
    const paddingSize = maxSize - 100 + 1;
    const padding = 'x'.repeat(paddingSize);
    const bigEntry = {
      timestamp: 1700000000000,
      action: { type: 'shell_exec', params: { command: 'test', padding } },
      result: { allowed: true },
    };

    logger.log(bigEntry);

    const smallEntry = {
      timestamp: 1700000001000,
      action: { type: 'read_file', params: { path: 'test.ts' } },
      result: { allowed: true },
    };
    logger.log(smallEntry);

    const backupPath = logPath + '.1';
    expect(fs.existsSync(backupPath)).toBe(true);

    const backupContent = fs.readFileSync(backupPath, 'utf-8').trim();
    const backupEntry = JSON.parse(backupContent);
    expect(backupEntry.action.type).toBe('shell_exec');

    const currentContent = fs.readFileSync(logPath, 'utf-8').trim();
    const currentEntry = JSON.parse(currentContent);
    expect(currentEntry.action.type).toBe('read_file');

    try { fs.unlinkSync(backupPath); } catch { /* ignore */ }
  });
});
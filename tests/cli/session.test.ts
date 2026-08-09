import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseSessionState } from '../../src/cli/session';

describe('parseSessionState', () => {
  let tmpDir: string;
  let auditLogPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-test-'));
    auditLogPath = path.join(tmpDir, 'audit.log');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeAuditLog(content: string): void {
    fs.writeFileSync(auditLogPath, content, 'utf-8');
  }

  it('should parse last entry from a valid audit log', () => {
    const entries = [
      {
        timestamp: 1700000000000,
        action: { type: 'read_file', params: { path: 'package.json' } },
        result: { allowed: true },
      },
      {
        timestamp: 1700000001000,
        action: { type: 'shell_exec', params: { command: 'npm test' } },
        result: { allowed: true },
      },
    ];
    writeAuditLog(entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

    const state = parseSessionState(auditLogPath);

    expect(state).not.toBeNull();
    expect(state!.task).toBe('Resume previous session');
    expect(state!.lastTurn).toBe(2);
    expect(state!.lastAction).toEqual({ type: 'shell_exec', params: { command: 'npm test' } });
    expect(state!.summary).toBe('Resumed from audit log (2 entries)');
  });

  it('should return null for empty log file', () => {
    writeAuditLog('');

    const state = parseSessionState(auditLogPath);

    expect(state).toBeNull();
  });

  it('should return null for non-existent file', () => {
    const state = parseSessionState(auditLogPath);

    expect(state).toBeNull();
  });

  it('should return null for log file with only whitespace', () => {
    writeAuditLog('   \n  \n  ');

    const state = parseSessionState(auditLogPath);

    expect(state).toBeNull();
  });

  it('should return null when last line is invalid JSON', () => {
    writeAuditLog('{"timestamp":1700000000000,"action":{"type":"read_file","params":{"path":"a.ts"}},"result":{"allowed":true}}\nnot valid json');

    const state = parseSessionState(auditLogPath);

    expect(state).toBeNull();
  });

  it('should handle log with approvalResult in last entry', () => {
    const entry = {
      timestamp: 1700000000000,
      action: { type: 'shell_exec', params: { command: 'echo hello' } },
      result: { allowed: false, reason: 'Requires approval', requiresApproval: true },
      approvalResult: 'approved' as const,
    };
    writeAuditLog(JSON.stringify(entry) + '\n');

    const state = parseSessionState(auditLogPath);

    expect(state).not.toBeNull();
    expect(state!.lastAction).toEqual({ type: 'shell_exec', params: { command: 'echo hello' } });
    expect(state!.lastTurn).toBe(1);
  });

  it('should return null when log file has only blank lines', () => {
    writeAuditLog('\n\n\n');

    const state = parseSessionState(auditLogPath);

    expect(state).toBeNull();
  });
});
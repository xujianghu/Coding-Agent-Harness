import * as fs from 'fs';
import * as path from 'path';

export interface AuditLogEntry {
  timestamp: number;
  action: { type: string; params: Record<string, string> };
  result: { allowed: boolean; reason?: string; requiresApproval?: boolean };
  approvalResult?: 'approved' | 'rejected';
}

export interface AuditLogger {
  log(entry: AuditLogEntry): void;
}

export function createAuditLogger(logPath: string): AuditLogger {
  return {
    log(entry: AuditLogEntry): void {
      const dir = path.dirname(logPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
    },
  };
}
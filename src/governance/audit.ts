import * as fs from 'fs';
import * as path from 'path';

const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

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

      if (fs.existsSync(logPath)) {
        const stat = fs.statSync(logPath);
        if (stat.size >= MAX_LOG_SIZE) {
          const backupPath = logPath + '.1';
          if (fs.existsSync(backupPath)) {
            fs.unlinkSync(backupPath);
          }
          fs.renameSync(logPath, backupPath);
        }
      }

      fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
    },
  };
}
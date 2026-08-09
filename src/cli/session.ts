import { readFileSync, existsSync } from 'fs';

export interface SessionState {
  task: string;
  lastTurn: number;
  lastAction?: { type: string; params: Record<string, string> };
  summary: string;
}

export function parseSessionState(auditLogPath: string): SessionState | null {
  if (!existsSync(auditLogPath)) {
    return null;
  }

  const content = readFileSync(auditLogPath, 'utf-8').trim();
  if (!content) return null;

  const lines = content.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return null;

  const lastLine = lines[lines.length - 1];

  try {
    const lastEntry = JSON.parse(lastLine);
    return {
      task: 'Resume previous session',
      lastTurn: lines.length,
      lastAction: lastEntry.action,
      summary: `Resumed from audit log (${lines.length} entries)`,
    };
  } catch {
    return null;
  }
}
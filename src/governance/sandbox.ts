import { resolve, sep, basename } from 'path';

export interface Sandbox {
  checkPath(path: string): { allowed: boolean; reason?: string };
  checkCommand(command: string): { allowed: boolean; reason?: string };
}

function splitCommands(command: string): string[] {
  const parts = command.split(/\s*(&&|\|\||[;|])\s*/);
  return parts.filter((p) => p.trim() && !['&&', '||', ';', '|'].includes(p));
}

function extractCommandName(cmd: string): string | null {
  if (/\$\(/.test(cmd) || /`/.test(cmd)) {
    return null;
  }
  const trimmed = cmd.trim();
  const firstWord = trimmed.split(/\s+/)[0];
  if (firstWord.includes('/') || firstWord.includes('\\')) {
    return basename(firstWord);
  }
  return firstWord;
}

export function createSandbox(
  allowedPaths: string[],
  allowedCommands: string[]
): Sandbox {
  const resolvedAllowedPaths = allowedPaths.map((p) => resolve(p));

  return {
    checkPath(path: string): { allowed: boolean; reason?: string } {
      const resolvedPath = resolve(path);
      for (const allowedPath of resolvedAllowedPaths) {
        if (resolvedPath.startsWith(allowedPath + sep) || resolvedPath === allowedPath) {
          return { allowed: true };
        }
      }
      return { allowed: false, reason: `Path "${path}" is outside allowed directories` };
    },

    checkCommand(command: string): { allowed: boolean; reason?: string } {
      const trimmed = command.trim();
      if (!trimmed) {
        return { allowed: false, reason: 'Empty command is not allowed' };
      }
      if (/\$\(/.test(trimmed) || /`/.test(trimmed)) {
        return { allowed: false, reason: 'Command substitution is not allowed' };
      }
      const subCommands = splitCommands(trimmed);
      for (const subCmd of subCommands) {
        const cmdName = extractCommandName(subCmd);
        if (!cmdName || !allowedCommands.includes(cmdName)) {
          const displayName = cmdName || subCmd.trim().split(/\s+/)[0];
          return { allowed: false, reason: `Command "${displayName}" is not in the allowed list` };
        }
      }
      return { allowed: true };
    },
  };
}
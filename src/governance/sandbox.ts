import { resolve, sep } from 'path';

export interface Sandbox {
  checkPath(path: string): { allowed: boolean; reason?: string };
  checkCommand(command: string): { allowed: boolean; reason?: string };
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
      const firstWord = trimmed.split(/\s+/)[0];
      if (allowedCommands.includes(firstWord)) {
        return { allowed: true };
      }
      return { allowed: false, reason: `Command "${firstWord}" is not in the allowed list` };
    },
  };
}
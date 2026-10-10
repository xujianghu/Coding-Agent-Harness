import { relative, resolve } from 'path';
import { realpathSync } from 'fs';
import { isWithinDirectory, resolveWorkspacePath } from '../tools/path';

export interface Sandbox {
  checkPath(path: string): { allowed: boolean; reason?: string; normalizedPath?: string };
  checkCommand(command: string): { allowed: boolean; reason?: string };
}

/** 只解析受限命令链，不把白名单误当作解释器的执行隔离。 */
function commandNames(command: string): string[] {
  if (/[\r\n`$%!^]/.test(command)) throw new Error('Command substitution or expansion is not allowed');
  // 跨平台转义规则不同，保守拒绝会改变引号/分隔符语义的反斜杠。
  if (/\\["';&|<>()[\]{}\s]/.test(command)) throw new Error('Escaped shell syntax is not allowed');
  const segments: string[] = [];
  let quote: string | undefined;
  let segment = '';
  for (let index = 0; index < command.length; index++) {
    const character = command[index];
    if (quote) {
      segment += character;
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      segment += character;
      continue;
    }
    if (/[<>()[\]{}]/.test(character)) throw new Error('Shell redirection or grouping is not allowed');
    if (character === '&' || character === '|' || character === ';') {
      if (character === '&' && command[index + 1] !== '&') throw new Error('Background execution is not allowed');
      if (!segment.trim()) throw new Error('Empty command segment is not allowed');
      segments.push(segment.trim());
      segment = '';
      if (command[index + 1] === character && character !== ';') index++;
      continue;
    }
    segment += character;
  }
  if (quote || !segment.trim()) throw new Error('Invalid command quoting or empty segment');
  segments.push(segment.trim());
  return segments.map((part) => {
    const name = part.split(/\s+/)[0];
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error(`Command "${name}" must be a bare executable name`);
    return name;
  });
}

export function createSandbox(
  allowedPaths: string[],
  allowedCommands: string[],
  workspaceRoot = process.cwd()
): Sandbox {
  const root = resolve(workspaceRoot);
  return {
    checkPath(path: string) {
      try {
        const target = resolveWorkspacePath(root, path);
        for (const allowedPath of allowedPaths) {
          const allowed = resolveWorkspacePath(root, allowedPath);
          if (isWithinDirectory(allowed, target)) return { allowed: true, normalizedPath: relative(realpathSync(root), target).replace(/\\/g, '/') || '.' };
        }
        return { allowed: false, reason: `Path "${path}" is outside allowed directories` };
      } catch (error) {
        return { allowed: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },
    checkCommand(command: string) {
      if (typeof command !== 'string' || !command.trim()) return { allowed: false, reason: 'Empty command is not allowed' };
      try {
        for (const name of commandNames(command)) {
          if (!allowedCommands.includes(name)) return { allowed: false, reason: `Command "${name}" is not in the allowed list` };
        }
        return { allowed: true };
      } catch (error) {
        return { allowed: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

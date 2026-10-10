import { lstatSync, realpathSync } from 'fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'path';

/** 对大小写不敏感，避免 Windows 上通过路径拼写绕过保护。 */
export function isSensitivePath(filePath: string): boolean {
  const components = filePath.replace(/\\/g, '/').split('/');
  return components.some((component) =>
    /^(?:\.git|\.harness|\.env(?:\..+)?|\.aws|\.ssh)$/i.test(component)
    || /\.(?:key|pem|p12|pfx)$/i.test(component)
  );
}

export function isWithinDirectory(directory: string, target: string): boolean {
  const remaining = relative(directory, target);
  return remaining === '' || (!isAbsolute(remaining) && remaining !== '..' && !remaining.startsWith(`..${sep}`));
}

/** 新文件也检查最近的现有祖先，从而阻止符号链接目录逃逸。 */
function resolveExistingAncestor(target: string): string {
  let ancestor = target;
  while (true) {
    try {
      const stat = lstatSync(ancestor);
      // 硬链接的另一名称可能在工作区外或指向凭据，无法仅靠 realpath 判断。
      if (stat.isFile() && stat.nlink > 1) throw new Error('Hard-linked files are not allowed');
      return resolve(realpathSync(ancestor), relative(ancestor, target));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}

export function resolveWorkspacePath(workspaceRoot: string, filePath: string): string {
  if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('Path is required');
  if (filePath.includes('\0')) throw new Error('Invalid path');
  // Windows 的流名称与尾部空格/点会被文件系统特殊解释，统一拒绝。
  if (process.platform === 'win32') {
    const withoutDrive = filePath.replace(/^[A-Za-z]:/, '');
    if (withoutDrive.includes(':') || withoutDrive.split(/[\\/]/).some((part) =>
      part !== '.' && part !== '..' && (/[. ]$/.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part))
    )) {
      throw new Error('Invalid Windows path');
    }
  }
  const root = resolve(workspaceRoot);
  const lexicalTarget = resolve(root, filePath);
  if (!isWithinDirectory(root, lexicalTarget)) throw new Error('Path traversal detected: outside workspace');
  if (isSensitivePath(relative(root, lexicalTarget))) throw new Error(`Sensitive path is blocked: ${filePath}`);
  const canonicalRoot = realpathSync(root);
  const canonicalTarget = resolveExistingAncestor(lexicalTarget);
  if (!isWithinDirectory(canonicalRoot, canonicalTarget)) throw new Error('Path traversal detected: symlink escapes workspace');
  if (isSensitivePath(relative(canonicalRoot, canonicalTarget))) throw new Error(`Sensitive path is blocked: ${filePath}`);
  return canonicalTarget;
}

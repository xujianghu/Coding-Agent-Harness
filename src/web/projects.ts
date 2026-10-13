import { createHash, randomUUID } from 'crypto';
import { accessSync, constants, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'path';
import { initializeWorkspace, workspaceConfiguration } from '../config/initialize';
import { isSensitivePath } from '../tools/path';
import { createRunManager, WebApiError } from './manager';
import { readBounded, statePath } from './storage';
import type { WebProject, WebProjectDirectory, WebProjects } from './types';

const MAX_PATH_LENGTH = 4096;
const MAX_RECENT = 20;
type RunManager = ReturnType<typeof createRunManager>;

function protectedDirectory(path: string): boolean {
  return isSensitivePath(path) || path.replace(/\\/g, '/').split('/').some(part =>
    /^\.(?:env.*|agents|codex)$/i.test(part) || /^(?:credentials?|secrets?)(?:\.|$)/i.test(part));
}

/** 项目入口是显式的宿主路径授权，仍拒绝链接、设备路径和凭据目录。 */
export function canonicalProjectDirectory(input: unknown): string {
  if (typeof input !== 'string' || !input || input.length > MAX_PATH_LENGTH || /[\x00-\x1f]/.test(input) || !isAbsolute(input)
    || (process.platform === 'win32' && (!/^[a-zA-Z]:[\\/]/.test(input) || input.slice(2).includes(':')))) {
    throw new WebApiError('项目需要有效的本地绝对目录路径', 400, 'INVALID_PROJECT_PATH');
  }
  const components = input.replace(/^[a-zA-Z]:/, '').split(/[\\/]/).filter(Boolean);
  if (process.platform === 'win32' && components.some(part => part !== '.' && part !== '..'
    && (/[. ]$/.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)))) {
    throw new WebApiError('项目路径包含设备名、流名称或尾部空格和点', 400, 'INVALID_PROJECT_PATH');
  }
  const destination = resolve(input);
  if (protectedDirectory(destination)) throw new WebApiError('内部状态和凭据目录不能作为项目打开', 403, 'INVALID_PROJECT_PATH');
  try {
    let cursor = parse(destination).root;
    for (const component of relative(cursor, destination).split(sep).filter(Boolean)) {
      cursor = join(cursor, component);
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new WebApiError('项目路径只能包含普通目录，不能经过链接', 403, 'INVALID_PROJECT_PATH');
    }
    if (!lstatSync(destination).isDirectory()) throw new WebApiError('项目路径不是目录', 400, 'INVALID_PROJECT_PATH');
    accessSync(destination, constants.R_OK);
    const canonical = realpathSync(destination);
    if (protectedDirectory(canonical)) throw new WebApiError('项目路径属于受保护目录', 403, 'INVALID_PROJECT_PATH');
    return canonical;
  } catch (error) {
    if (error instanceof WebApiError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new WebApiError('项目目录不存在', 404, 'PROJECT_NOT_FOUND');
    throw new WebApiError('项目目录无法读取', 403, 'PROJECT_UNREADABLE');
  }
}

export function projectId(path: string): string {
  return createHash('sha256').update(process.platform === 'win32' ? path.toLowerCase() : path).digest('hex').slice(0, 32);
}

function roots(): WebProjectDirectory['roots'] {
  const candidates = process.platform === 'win32' ? Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index) + ':\\') : ['/'];
  return candidates.flatMap(path => {
    try { const canonical = canonicalProjectDirectory(path); readdirSync(canonical); return [{ name: path, path: canonical }]; }
    catch { return []; }
  });
}

export function browseProjectDirectories(input: unknown, workspace: string): WebProjectDirectory {
  const path = canonicalProjectDirectory(input === undefined ? dirname(workspace) : input);
  let names: string[];
  try { names = readdirSync(path).sort((left, right) => left.localeCompare(right)); }
  catch { throw new WebApiError('无法列出目录', 403, 'PROJECT_UNREADABLE'); }
  const entries: WebProjectDirectory['entries'] = [];
  let examined = 0;
  for (const name of names) {
    if (++examined > 5000 || entries.length >= 500) break;
    if (name.length > 255 || protectedDirectory(name)) continue;
    try {
      const canonical = canonicalProjectDirectory(join(path, name));
      entries.push({ name, path: canonical });
    } catch { /* 文件、链接和不可读目录不参与目录选择。 */ }
  }
  let parent: string | null = dirname(path) === path ? null : dirname(path);
  if (parent) { try { parent = canonicalProjectDirectory(parent); } catch { parent = null; } }
  return { path, parent, entries, roots: roots(), truncated: examined < names.length || entries.length >= 500 };
}

/** 服务保持监听和静态资源不变，运行管理器及历史始终绑定具体项目。 */
export function createProjectHost(options: { workspace: string; configPath?: string }, onSwitch: (previous: RunManager) => void = () => {}) {
  const startupWorkspace = canonicalProjectDirectory(resolve(options.workspace));
  const startupProjectId = projectId(startupWorkspace);
  let manager = createRunManager({ ...options, workspace: startupWorkspace, projectId: startupProjectId });
  let switched = false;
  let closed = false;
  const recent = new Map<string, { path: string; lastOpenedAt: number }>();
  const recentPath = () => statePath(startupWorkspace, 'web-projects.json');
  try {
    const path = recentPath();
    if (existsSync(path)) {
      const document = JSON.parse(readBounded(path, 128 * 1024)) as { projects?: unknown };
      if (Array.isArray(document.projects)) for (const entry of document.projects.slice(0, MAX_RECENT)) {
        if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' || !Number.isFinite(entry.lastOpenedAt) || entry.lastOpenedAt < 0 || entry.lastOpenedAt > Date.now()) continue;
        try { const canonical = canonicalProjectDirectory(entry.path); recent.set(projectId(canonical), { path: canonical, lastOpenedAt: entry.lastOpenedAt }); } catch { /* 索引不能替代当前目录校验。 */ }
      }
    }
  } catch { /* 无效最近项目索引不影响当前启动目录，也不会被自动打开或初始化。 */ }
  recent.set(startupProjectId, { path: startupWorkspace, lastOpenedAt: Date.now() });
  if (recent.size > MAX_RECENT) {
    const oldest = [...recent.entries()].filter(([id]) => id !== startupProjectId).sort((left, right) => left[1].lastOpenedAt - right[1].lastOpenedAt)[0];
    if (oldest) recent.delete(oldest[0]);
  }

  function getProject(path: string, lastOpenedAt: number, current = false): WebProject {
    const initialized = current ? manager.getWorkspace().initialized === true : workspaceConfiguration(path).initialized;
    return { id: projectId(path), name: basename(path) || path, path, initialized, lastOpenedAt };
  }
  function assertContext(value: string | undefined): RunManager {
    if (closed) throw new WebApiError('服务正在关闭', 503, 'CLOSING');
    if (!value && switched) throw new WebApiError('项目已切换，请刷新页面后重试', 409, 'PROJECT_REQUIRED');
    if (value && value !== projectId(manager.workspace)) throw new WebApiError('此页面属于其他项目，请刷新后重试', 409, 'PROJECT_CHANGED');
    return manager;
  }
  function list(): WebProjects {
    const id = projectId(manager.workspace);
    const projects = [...recent.values()].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt).slice(0, MAX_RECENT).flatMap(entry => {
      try { const canonical = canonicalProjectDirectory(entry.path); return [getProject(canonical, entry.lastOpenedAt, projectId(canonical) === id)]; } catch { return []; }
    });
    return { activeProjectId: id, projects, canSwitch: !manager.hasActiveRun(), ...(manager.hasActiveRun() ? { blockedReason: '任务正在执行或等待审批，请完成或取消后切换项目' } : {}) };
  }
  function open(input: unknown, expected: string | undefined) {
    assertContext(expected);
    if (manager.hasActiveRun()) throw new WebApiError('任务正在执行或等待审批，请完成或取消后切换项目', 409, 'RUN_ACTIVE');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new WebApiError('项目请求必须是对象');
    const record = input as Record<string, unknown>;
    if (Object.keys(record).some(key => !['path', 'initialize'].includes(key)) || (record.initialize !== undefined && typeof record.initialize !== 'boolean')) throw new WebApiError('项目只接受 path 与布尔 initialize');
    const path = canonicalProjectDirectory(record.path);
    const id = projectId(path);
    // 即使无需配置，也先检查现有配置和状态路径；显式初始化不会改写原文件。
    try { workspaceConfiguration(path); if (record.initialize === true) initializeWorkspace(path); }
    catch (error) { throw new WebApiError(error instanceof Error ? error.message : '项目配置无效', 409, 'INVALID_PROJECT_CONFIGURATION'); }
    const candidate = createRunManager({ workspace: path, projectId: id, ...(id === startupProjectId && options.configPath ? { configPath: options.configPath } : {}) });
    let workspace;
    try { workspace = candidate.getWorkspace(); }
    catch (error) { void candidate.close(); throw new WebApiError(error instanceof Error ? error.message : '项目配置无效', 409, 'INVALID_PROJECT_CONFIGURATION'); }
    const lastOpenedAt = Date.now();
    const nextRecent = new Map(recent); nextRecent.set(id, { path, lastOpenedAt });
    const stored = [...nextRecent.values()].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt).slice(0, MAX_RECENT);
    try {
      const destination = recentPath();
      mkdirSync(dirname(destination), { recursive: true });
      const temporary = destination + '.' + randomUUID() + '.tmp';
      writeFileSync(temporary, JSON.stringify({ projects: stored }), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, destination);
    } catch (error) { void candidate.close(); throw new WebApiError(error instanceof Error ? error.message : '最近项目保存失败', 409, 'PROJECT_STORAGE_ERROR'); }
    // 验证、持久化和切换间没有 await，旧标签页不能在此间隙提交到新管理器。
    const previous = manager; manager = candidate;
    if (projectId(previous.workspace) !== id) switched = true;
    recent.clear(); for (const entry of stored) recent.set(projectId(entry.path), entry);
    onSwitch(previous); void previous.close();
    return { project: { id, name: basename(path) || path, path, initialized: workspace.initialized === true, lastOpenedAt }, workspace };
  }
  return { get manager() { return manager; }, list, open, assertContext, browse(input?: string) { return browseProjectDirectories(input, manager.workspace); },
    async close() { closed = true; await manager.close(); } };
}

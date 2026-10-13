import { ArrowLeft, ChevronRight, Folder, FolderOpen, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { request, staleRequest, type DirectoryListing, type ProjectListing } from '../api';

interface Props {
  workspace: string;
  initialized: boolean;
  busy: boolean;
  blockedReason?: string;
  onOpen: (path: string, initialize: boolean) => Promise<void>;
  onClose: () => void;
  onRestoreFocus: () => void;
}

export function ProjectDialog({ workspace, initialized, busy, blockedReason, onOpen, onClose, onRestoreFocus }: Props) {
  const [path, setPath] = useState(workspace);
  const [initialize, setInitialize] = useState(false);
  const [projects, setProjects] = useState<ProjectListing | null>(null);
  const [directories, setDirectories] = useState<DirectoryListing | null>(null);
  const [directoryPath, setDirectoryPath] = useState<string | undefined>(workspace || undefined);
  const [browseVersion, setBrowseVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef({ busy, onClose });
  const pathEdits = useRef(0);
  latest.current = { busy, onClose };
  const switchReason = blockedReason || (projects && !projects.canSwitch ? projects.blockedReason || '任务执行中，请等待完成或先停止执行。' : undefined);

  useEffect(() => {
    input.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!latest.current.busy) latest.current.onClose(); }
      if (event.key !== 'Tab') return;
      const items = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
      if (!items?.length) return;
      const first = items[0]; const last = items[items.length - 1];
      const outside = !dialog.current?.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); onRestoreFocus(); };
  }, [onRestoreFocus]);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const refresh = () => {
      if (pending || latest.current.busy) return;
      pending = true;
      void request<ProjectListing>('/projects', { signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setProjects(data); }).catch((cause: unknown) => { if (!controller.signal.aborted && !staleRequest(cause)) setError(cause instanceof Error ? cause.message : '无法读取最近项目。'); }).finally(() => { pending = false; });
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setDirectories(null);
    const edits = pathEdits.current;
    const query = directoryPath ? `?${new URLSearchParams({ path: directoryPath })}` : '';
    request<DirectoryListing>(`/projects/directories${query}`, { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return;
      setDirectories(data); setError('');
      if (data.path && edits === pathEdits.current) setPath(data.path);
    }).catch((cause: unknown) => { if (!controller.signal.aborted && !staleRequest(cause)) setError(cause instanceof Error ? cause.message : '无法浏览目录。'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [directoryPath, browseVersion]);

  const browse = (value?: string) => { input.current?.focus(); pathEdits.current += 1; if (value) setPath(value); setDirectoryPath(value); setBrowseVersion((current) => current + 1); };
  const open = async (value: string, shouldInitialize: boolean) => {
    if (busy || switchReason) return;
    if (!value.trim()) { setError('请输入本机代码目录的绝对路径。'); input.current?.focus(); return; }
    setError('');
    try { await onOpen(value.trim(), shouldInitialize); }
    catch (cause) { if (!staleRequest(cause)) setError(cause instanceof Error ? cause.message : '打开项目失败。'); }
  };

  return <div className="dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><div ref={dialog} className="new-dialog project-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title"><header><h2 id="project-dialog-title"><FolderOpen size={20} aria-hidden="true" />打开本地项目</h2><button className="icon-button" aria-label="关闭项目选择" disabled={busy} onClick={onClose}><X size={20} aria-hidden="true" /></button></header><p className="dialog-mode-note">选择运行本地服务这台电脑上的代码文件夹。打开后即可浏览源码，新会话使用所选项目。</p><form onSubmit={(event) => { event.preventDefault(); void open(path, initialize); }}><label className="field-label" htmlFor="project-path">代码目录的绝对路径</label><div className="project-path-input"><input ref={input} id="project-path" value={path} maxLength={4096} disabled={busy} onChange={(event) => { pathEdits.current += 1; setPath(event.target.value); setError(''); }} placeholder="例如：D:\projects\my-app" /><button className="button subtle" type="button" disabled={busy || loading} onClick={() => browse(path.trim() || undefined)}>浏览</button></div><div className="directory-browser"><div className="directory-toolbar"><strong title={directories?.path}>{directories?.path || '本机目录'}</strong><button className="text-button" type="button" disabled={busy || loading || !directories?.parent} onClick={() => browse(directories?.parent ?? undefined)}><ArrowLeft size={15} aria-hidden="true" />上一级</button><button className="text-button" type="button" disabled={busy || loading} onClick={() => browse(undefined)}>盘符与根目录</button></div>{loading ? <p className="loading-text" role="status"><LoaderCircle size={17} className="spin" aria-hidden="true" />读取目录…</p> : directories && <><div className="directory-roots">{directories.roots.map((root) => <button className="button subtle" type="button" key={root.path} disabled={busy} onClick={() => browse(root.path)}>{root.name}</button>)}</div><div className="directory-entries">{directories.entries.map((entry) => <button className="file-entry" type="button" key={entry.path} disabled={busy} onClick={() => browse(entry.path)}><Folder size={17} aria-hidden="true" /><span>{entry.name}</span><ChevronRight size={14} aria-hidden="true" /></button>)}{!directories.entries.length && <p className="inspector-caption">没有可浏览的子目录，可打开当前目录。</p>}</div>{directories.truncated && <p className="inspector-caption">目录较多，仅展示部分子目录；可以直接输入目标路径。</p>}</>}</div><label className="project-initialize"><input type="checkbox" checked={initialize} disabled={busy} onChange={(event) => setInitialize(event.target.checked)} /><span><strong>初始化 Harness 配置（仅创建缺失文件）</strong><small>默认只打开目录。启用此项才会在目标项目创建缺失的配置；已有文件保留。</small></span></label>{!initialized && path === workspace && <p className="dialog-mode-note">当前项目尚未初始化，可以先浏览源码或运行机制演示。使用真实模型前请勾选初始化，再配置模型凭据。</p>}{switchReason && <p className="project-notice" role="status">{switchReason}</p>}{error && <p className="field-error project-error" role="alert">{error}</p>}<footer><button className="button subtle" type="button" disabled={busy} onClick={onClose}>取消</button><button className="button primary" type="submit" disabled={busy || !!switchReason || !path.trim()}>{busy ? '打开中…' : initialize ? '初始化并打开' : '打开项目'}</button></footer></form>{!!projects?.projects.length && <section className="recent-projects" aria-labelledby="recent-projects-title"><h3 id="recent-projects-title">最近项目</h3>{projects.projects.map((project) => <button className="recent-project" key={project.id} disabled={busy || !!switchReason} onClick={() => void open(project.path, false)}><FolderOpen size={17} aria-hidden="true" /><span><strong>{project.name}{project.id === projects.activeProjectId ? ' · 当前' : ''}</strong><small>{project.path}</small></span><span className="small-tag">{project.initialized ? '已初始化' : '只读浏览可用'}</span></button>)}</section>}</div></div>;
}

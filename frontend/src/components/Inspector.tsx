import { ArrowLeft, ChevronRight, FileCode2, Files, Folder, GitCompareArrows, LoaderCircle, PanelRightClose, Terminal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { request, type FileContent, type FileListing, type Run } from '../api';
import { RunDetails, RunStats } from './RunDetails';

type InspectorTab = 'changes' | 'files' | 'run';
const tabs = [{ id: 'changes' as const, title: '代码差异', icon: GitCompareArrows }, { id: 'files' as const, title: '文件', icon: Files }, { id: 'run' as const, title: '执行详情', icon: Terminal }];
type DiffLine = { kind: 'same' | 'removed' | 'added'; value: string; before?: number; after?: number };

function diffLines(before: string | null, after: string | null): DiffLine[] {
  const left = before === null ? [] : before.split('\n');
  const right = after === null ? [] : after.split('\n');
  if (left.length * right.length > 250000) return [...left.map((value, index): DiffLine => ({ kind: 'removed', value, before: index + 1 })), ...right.map((value, index): DiffLine => ({ kind: 'added', value, after: index + 1 }))];
  const table = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const result: DiffLine[] = [];
  let i = 0; let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) { result.push({ kind: 'same', value: left[i], before: ++i, after: ++j }); }
    else if (i < left.length && (j === right.length || table[i + 1][j] >= table[i][j + 1])) { result.push({ kind: 'removed', value: left[i], before: ++i }); }
    else { result.push({ kind: 'added', value: right[j], after: ++j }); }
  }
  return result;
}

export function DiffView({ run }: { run: Run | null }) {
  const changes = run?.changes ?? [];
  if (!changes.length) return <div className="inspector-empty"><GitCompareArrows size={25} aria-hidden="true" /><p>{run ? '本轮暂无可展示的代码改动' : '执行后的代码改动会显示在这里'}</p></div>;
  return <div className="diff-list"><p className="inspector-caption">当前轮次 · {changes.length} 个文件 · 查看修改前后的差异</p>{changes.map((change) => {
    const lines = diffLines(change.before, change.after);
    return <details className="diff-file" open key={change.path}><summary><FileCode2 size={15} aria-hidden="true" /><span>{change.path}</span><span className="diff-count"><b className="addition">+{lines.filter((line) => line.kind === 'added').length}</b><b className="deletion">−{lines.filter((line) => line.kind === 'removed').length}</b></span></summary><div className="diff-scroll" tabIndex={0} aria-label={`${change.path} 代码差异`}><pre>{lines.slice(0, 800).map((line, index) => <span className={`diff-line diff-${line.kind}`} key={index}><span className="line-number">{line.before ?? ''}</span><span className="line-number">{line.after ?? ''}</span><span className="diff-marker" aria-label={line.kind === 'removed' ? '删除' : line.kind === 'added' ? '新增' : undefined}>{line.kind === 'removed' ? '−' : line.kind === 'added' ? '+' : ' '}</span><span>{line.value || ' '}</span>{'\n'}</span>)}</pre></div>{lines.length > 800 && <p className="inspector-caption">仅展示前 800 行差异</p>}</details>;
  })}</div>;
}

function FileBrowser({ conversationId, runId }: { conversationId: string | null; runId?: string }) {
  const [path, setPath] = useState('');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [listing, setListing] = useState<FileListing | null>(null);
  const [file, setFile] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setPath(''); setFilePath(null); setListing(null); setFile(null); setError(''); }, [conversationId]);
  useEffect(() => {
    if (!conversationId) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    const query = new URLSearchParams({ conversationId, path: filePath ?? path });
    const promise = filePath === null ? request<FileListing>(`/files?${query}`, { signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setListing(data); }) : request<FileContent>(`/file?${query}`, { signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setFile(data); });
    promise.catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法读取文件。'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [conversationId, path, filePath, runId]);
  if (!conversationId) return <div className="inspector-empty"><Files size={25} aria-hidden="true" /><p>选择一段会话后浏览它的工作目录</p></div>;
  const segments = path.split('/').filter(Boolean);
  return <div className="file-browser"><div className="file-breadcrumb"><button onClick={() => { setPath(''); setFilePath(null); }} aria-label="返回工作区根目录"><Folder size={15} aria-hidden="true" />工作区</button>{segments.map((segment, index) => <span key={index}><ChevronRight size={12} aria-hidden="true" /><button onClick={() => { setPath(segments.slice(0, index + 1).join('/')); setFilePath(null); }}>{segment}</button></span>)}</div><p className="inspector-caption">只读文件浏览 · 敏感文件与越界路径受保护</p>{error && <p className="file-error" role="alert">{error}</p>}{loading ? <p className="loading-text" role="status"><LoaderCircle size={18} className="spin" aria-hidden="true" />读取中…</p> : filePath && file ? <><button className="file-back" onClick={() => setFilePath(null)}><ArrowLeft size={15} aria-hidden="true" />返回目录</button><div className="code-file-title"><FileCode2 size={16} aria-hidden="true" /><strong>{file.path}</strong><span>{file.size.toLocaleString('zh-CN')} 字节</span></div><div className="code-view" tabIndex={0} aria-label={`${file.path} 文件内容`}><pre>{file.content.split('\n').map((line, index) => <span className="code-line" key={index}><span className="line-number">{index + 1}</span><span>{line || ' '}</span>{'\n'}</span>)}</pre></div></> : listing && <div className="file-list">{path && <button className="file-entry" onClick={() => { setPath(segments.slice(0, -1).join('/')); setFilePath(null); }}><ArrowLeft size={16} aria-hidden="true" /><span>返回上一级</span></button>}{listing.entries.map((entry) => <button className="file-entry" key={entry.path} onClick={() => { if (entry.kind === 'directory') { setPath(entry.path); setFilePath(null); } else { setFile(null); setFilePath(entry.path); } }}>{entry.kind === 'directory' ? <Folder size={17} aria-hidden="true" /> : <FileCode2 size={17} aria-hidden="true" />}<span>{entry.name}</span>{entry.kind === 'directory' ? <ChevronRight size={13} aria-hidden="true" /> : <small>{entry.size === undefined ? '' : entry.size < 1024 ? `${entry.size} B` : `${(entry.size / 1024).toFixed(1)} KB`}</small>}</button>)}{!listing.entries.length && <p className="inspector-caption">这个目录中没有可展示的文件</p>}{listing.truncated && <p className="inspector-caption">目录较大，仅展示部分文件</p>}</div>}</div>;
}

export function Inspector({ conversationId, run, busy, onClose, onCancel, onResume, onApprove, onRestart }: { conversationId: string | null; run: Run | null; busy: boolean; onClose: () => void; onCancel: () => void; onResume: () => void; onApprove: (id: string, approved: boolean) => void; onRestart: () => void }) {
  const [tab, setTab] = useState<InspectorTab>('changes');
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return <aside className="inspector" aria-label="工作区查看器"><header className="inspector-header"><div role="tablist" aria-label="查看内容">{tabs.map(({ id, title, icon: Icon }, index) => <button ref={(element) => { buttons.current[index] = element; }} key={id} id={`inspector-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`inspector-panel-${id}`} tabIndex={tab === id ? 0 : -1} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)} onKeyDown={(event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length; setTab(tabs[next].id); buttons.current[next]?.focus(); }}><Icon size={15} aria-hidden="true" /><span>{title}</span></button>)}</div><button className="icon-button" aria-label="收起查看器" onClick={onClose}><PanelRightClose size={18} aria-hidden="true" /></button></header><div className="inspector-body" id={`inspector-panel-${tab}`} role="tabpanel" aria-labelledby={`inspector-tab-${tab}`}>{tab === 'changes' && <DiffView run={run} />}{tab === 'files' && <FileBrowser key={conversationId} conversationId={conversationId} runId={run?.id + ':' + run?.status} />}{tab === 'run' && <><RunStats run={run} /><RunDetails run={run} busy={busy} onCancel={onCancel} onApprove={onApprove} onResume={onResume} onRestart={onRestart} /></>}</div></aside>;
}

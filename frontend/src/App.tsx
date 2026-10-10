import { Activity, ArrowUpRight, CheckCircle2, ChevronRight, CircleHelp, FileChartColumn, FolderOpen, History, LayoutDashboard, Menu, RefreshCw, Settings2, Terminal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isActive, request, statusText, timeLabel, type Evaluation, type NewRunInput, type Run, type WorkspaceInfo } from './api';
import { Composer } from './components/Composer';
import { Changes, RunDetails, RunStats } from './components/RunDetails';
import { EvaluationsView, HistoryView, SystemView } from './components/Views';

type Page = 'workbench' | 'history' | 'evaluations' | 'system';
const pages = [
  { id: 'workbench' as const, title: '任务工作台', icon: LayoutDashboard },
  { id: 'history' as const, title: '运行记录', icon: History },
  { id: 'evaluations' as const, title: '评测报告', icon: FileChartColumn },
  { id: 'system' as const, title: '系统信息', icon: Settings2 },
];

export function App() {
  const [page, setPage] = useState<Page>('workbench');
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [reports, setReports] = useState<Evaluation[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 720px)').matches);
  const [composerVersion, setComposerVersion] = useState(0);
  const [restartTask, setRestartTask] = useState<string>();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeMenuButton = useRef<HTMLButtonElement>(null);
  const menuWasOpen = useRef(false);
  const returnFocus = useRef<'menu' | 'heading'>('menu');
  const mutationVersion = useRef(0);
  const currentSelection = useRef(selectedId);
  currentSelection.current = selectedId;

  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px)');
    const update = () => { setMobile(media.matches); if (!media.matches) setMenuOpen(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!(mobile && menuOpen)) {
      if (menuWasOpen.current) {
        menuWasOpen.current = false;
        if (!mobile || returnFocus.current === 'heading') pageHeading.current?.focus();
        else menuButton.current?.focus();
      }
      return;
    }
    menuWasOpen.current = true;
    closeMenuButton.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); returnFocus.current = 'menu'; setMenuOpen(false);
      } else if (event.key === 'Tab') {
        const buttons = sidebar.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        if (!buttons?.length) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        const outside = !sidebar.current?.contains(document.activeElement);
        if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [mobile, menuOpen]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all([request<WorkspaceInfo>('/workspace', { signal: controller.signal }), request<{ runs: Run[] }>('/runs', { signal: controller.signal })])
      .then(([workspace, history]) => { setInfo(workspace); setRuns(history.runs); setConnected(true); setError(''); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : '无法连接本地服务。'); setConnected(false); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshVersion]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      request<{ runs: Run[] }>('/runs', { signal: controller.signal }).then((data) => { setRuns(data.runs); setConnected(true); }).catch(() => { if (!controller.signal.aborted) setConnected(false); });
    }, 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!selectedId) { setRun(null); return; }
    const controller = new AbortController();
    let timer: number | undefined;
    const poll = async () => {
      const version = mutationVersion.current;
      try {
        const data = await request<Run>(`/runs/${encodeURIComponent(selectedId)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (version === mutationVersion.current) setRun(data);
        setConnected(true);
        if (isActive(data.status)) timer = window.setTimeout(poll, 1000);
      } catch (cause) {
        if (!controller.signal.aborted) { setConnected(false); setError(cause instanceof Error ? cause.message : '无法读取运行记录。'); timer = window.setTimeout(poll, 3000); }
      }
    };
    void poll();
    return () => { controller.abort(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [selectedId, refreshVersion]);

  useEffect(() => {
    if (page !== 'evaluations') return;
    const controller = new AbortController();
    setReportsLoading(true);
    request<{ reports: Evaluation[] }>('/evaluations', { signal: controller.signal }).then((data) => setReports(data.reports)).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法读取评测报告。'); }).finally(() => { if (!controller.signal.aborted) setReportsLoading(false); });
    return () => controller.abort();
  }, [page, refreshVersion]);

  const closeMenu = () => { returnFocus.current = 'menu'; setMenuOpen(false); };
  const navigate = (next: Page) => {
    if (mobile && menuOpen) returnFocus.current = 'heading';
    setPage(next); setMenuOpen(false);
  };
  const selectRun = (id: string) => {
    if (id !== selectedId) { setRun(null); setSelectedId(id); }
    setError(''); navigate('workbench');
  };
  const submit = async (input: NewRunInput) => {
    setBusy(true); setError(''); mutationVersion.current += 1;
    try {
      const created = await request<Run>('/runs', { method: 'POST', body: JSON.stringify(input) });
      setRun(created); setSelectedId(created.id); setRuns((current) => [created, ...current.filter((item) => item.id !== created.id)]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '创建任务失败。'); }
    finally { setBusy(false); }
  };

  const action = async (suffix: string, body?: unknown) => {
    if (!run || busy) return;
    const id = run.id;
    setBusy(true); setError(''); mutationVersion.current += 1;
    try {
      const result = await request<Run>(`/runs/${encodeURIComponent(id)}/${suffix}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
      if (currentSelection.current === id) { setRun(result); setSelectedId(result.id); setRefreshVersion((value) => value + 1); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作未完成。'); }
    finally { setBusy(false); }
  };

  const restart = (task: string) => { setRestartTask(task); setComposerVersion((version) => version + 1); setSelectedId(null); setRun(null); pageHeading.current?.focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const active = runs.some((item) => isActive(item.status)) || !!(run && isActive(run.status));
  const currentPage = pages.find((item) => item.id === page)!;
  const workspaceName = info?.workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? '当前工作区';
  const stateAnnouncement = run ? `${statusText[run.status]}${run.pendingApproval ? '，有一条操作等待审批' : ''}${run.verified ? '，验收通过' : ''}` : '';

  return <div className="app-shell">
    <a className="skip-link" href="#main-content" inert={mobile && menuOpen}>跳到主内容</a>
    {mobile && menuOpen && <button className="sidebar-backdrop" tabIndex={-1} aria-label="关闭导航" onClick={closeMenu} />}
    <aside id="primary-sidebar" ref={sidebar} className={`sidebar ${menuOpen ? 'open' : ''}`} inert={mobile && !menuOpen} aria-hidden={mobile && !menuOpen ? true : undefined}>
      <div className="brand"><span className="brand-mark"><Terminal size={21} aria-hidden="true" /></span><div>Harness <strong>Studio</strong><span>AGENT WORKSPACE</span></div><button ref={closeMenuButton} className="mobile-close icon-button" aria-label="关闭导航" onClick={closeMenu}><X size={20} aria-hidden="true" /></button></div>
      <div className="sidebar-section-label">工作空间</div>
      <nav aria-label="主要导航">{pages.map(({ id, title, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={18} aria-hidden="true" /><span>{title}</span>{id === 'history' && <span className="nav-count">{runs.length}</span>}</button>)}</nav>
      <div className="sidebar-workspace"><div className="sidebar-section-label">已连接的项目</div><div className="workspace-item"><FolderOpen size={16} aria-hidden="true" /><span title={info?.workspace}>{workspaceName}</span></div><p>本地工作区</p></div>
      <div className="sidebar-bottom"><div className="sidebar-boundary"><ShieldIcon /><span>操作受策略保护</span></div><div className="sidebar-version"><span>Harness Studio</span><span>v1.1</span></div></div>
    </aside>
    <div className="main-shell" inert={mobile && menuOpen}><header className="topbar"><div className="breadcrumb"><button ref={menuButton} className="mobile-menu icon-button" aria-label="打开导航" aria-expanded={menuOpen} aria-controls="primary-sidebar" onClick={() => { returnFocus.current = 'menu'; setMenuOpen(true); }}><Menu size={21} aria-hidden="true" /></button><FolderOpen size={15} aria-hidden="true" /><span title={info?.workspace}>{workspaceName}</span><ChevronRight size={13} aria-hidden="true" /><strong>{currentPage.title}</strong></div><div className="connection"><span className={`connection-dot ${connected ? 'online' : ''}`} />{loading ? '连接中' : connected ? '本地服务在线' : '服务未连接'}<button className="icon-button refresh-button" aria-label="刷新工作区" onClick={() => setRefreshVersion((value) => value + 1)} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden="true" /></button></div></header>
      <main id="main-content" className="main-content"><div className="page-heading"><div><div className="eyebrow">HARNESS STUDIO <span>/</span> {page === 'workbench' ? 'WORKBENCH' : page === 'history' ? 'HISTORY' : page === 'evaluations' ? 'EVALUATIONS' : 'SYSTEM'}</div><h1 tabIndex={-1} ref={pageHeading}>{currentPage.title}</h1><p>{page === 'workbench' ? '从任务到验收，掌握每一步执行。' : page === 'history' ? '回看任务、操作轨迹和最终结果。' : page === 'evaluations' ? '用可复现的任务检验 Agent 表现。' : '查看模型、预算与工具执行边界。'}</p></div>{page === 'workbench' && <span className="page-badge"><Activity size={14} aria-hidden="true" />{run && isActive(run.status) ? '运行进行中' : '就绪'}</span>}</div>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{stateAnnouncement}</div>
        {error && <div className="error-banner" role="alert"><CircleHelp size={18} aria-hidden="true" /><p>{error}</p><button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={17} aria-hidden="true" /></button></div>}
        {page === 'workbench' && <div className="workbench-grid"><div className="workspace-main"><Composer key={composerVersion} onSubmit={submit} busy={busy} active={active} initialTask={restartTask} /><RunDetails run={run} loading={!!selectedId && !run} busy={busy} onCancel={() => void action('cancel')} onApprove={(approvalId, approved) => void action('approve', { approvalId, approved })} onResume={() => void action('resume')} onRestart={restart} /></div><div className="workspace-side"><RunStats run={run} /><Changes run={run} /><section className="recent-panel panel"><div className="section-heading"><h2>最近运行</h2><button className="icon-button" aria-label="查看全部运行记录" onClick={() => navigate('history')}><ArrowUpRight size={17} aria-hidden="true" /></button></div>{runs.length ? <div className="recent-list">{runs.slice(0, 4).map((item) => <button key={item.id} onClick={() => selectRun(item.id)}><span className={`recent-dot recent-${item.status}`} /><span><strong>{item.task}</strong><small>{timeLabel(item.startedAt)} · {statusText[item.status]}</small></span>{item.verified && <CheckCircle2 size={14} className="verified-icon" aria-label="验收通过" />}</button>)}</div> : <p className="recent-empty">还没有运行记录</p>}</section></div></div>}
        {page === 'history' && <HistoryView runs={runs} selectedId={selectedId} onSelect={selectRun} />}
        {page === 'evaluations' && <EvaluationsView reports={reports} loading={reportsLoading} />}
        {page === 'system' && <SystemView info={info} />}
        <footer className="page-footer"><span><span className="footer-dot" /> 所有记录保存在本地工作区</span><span>Harness Studio · Agent 工程工作台</span></footer>
      </main>
    </div>
  </div>;
}

function ShieldIcon() { return <CheckCircle2 size={15} aria-hidden="true" />; }

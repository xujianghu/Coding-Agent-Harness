import { CheckCircle2, ChevronDown, CircleHelp, FileChartColumn, FolderOpen, History, Menu, MessageSquare, PanelRightOpen, Plus, RefreshCw, Settings2, Terminal, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { bindProject, getProjectGeneration, isActive, request, staleRequest, statusText, timeLabel, type Conversation, type ConversationDetail, type Evaluation, type NewConversationInput, type Project, type ProjectListing, type Run, type WorkspaceInfo } from './api';
import { ConversationView, NewConversationDialog } from './components/Conversation';
import { Inspector } from './components/Inspector';
import { EvaluationsView, HistoryView, SystemView } from './components/Views';
import { ProjectDialog } from './components/ProjectDialog';

type Page = 'conversations' | 'history' | 'evaluations' | 'system';
const pages = [{ id: 'history' as const, title: '运行记录', icon: History }, { id: 'evaluations' as const, title: '评测报告', icon: FileChartColumn }, { id: 'system' as const, title: '系统信息', icon: Settings2 }];

export function App() {
  const [page, setPage] = useState<Page>('conversations');
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [standaloneRun, setStandaloneRun] = useState<Run | null>(null);
  const [reports, setReports] = useState<Evaluation[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [streamError, setStreamError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newDialog, setNewDialog] = useState(false);
  const [projectDialog, setProjectDialog] = useState(false);
  const [projectChanged, setProjectChanged] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const sidebar = useRef<HTMLElement>(null);
  const main = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const inspectorButton = useRef<HTMLButtonElement>(null);
  const dialogReturnFocus = useRef<HTMLElement | null>(null);
  const closeMenuButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const selectedConversation = useRef(selectedConversationId);
  const selectedRun = useRef(selectedRunId);
  const streamingRun = useRef<string | undefined>(undefined);
  const mutationVersion = useRef(0);
  const busyRef = useRef(false);
  const menuWasOpen = useRef(false);
  const focusTarget = useRef<'menu' | 'heading'>('menu');
  const project = useRef<string | null>(null);
  const stream = useRef<EventSource | null>(null);
  selectedConversation.current = selectedConversationId;
  selectedRun.current = selectedRunId;
  const run = conversation?.runs.find((item) => item.id === selectedRunId) ?? (standaloneRun?.id === selectedRunId ? standaloneRun : null);
  const latestRun = conversation?.runs.at(-1) ?? null;
  const activeRun = runs.find((item) => isActive(item.status));
  const globalActive = !!activeRun || !!conversation?.runs.some((item) => isActive(item.status));

  const clearProjectState = useCallback(() => {
    mutationVersion.current += 1;
    stream.current?.close(); stream.current = null;
    selectedConversation.current = null; selectedRun.current = null; streamingRun.current = undefined; project.current = null;
    setInfo(null); setConversations([]); setConversation(null); setSelectedConversationId(null); setRuns([]); setSelectedRunId(null); setStandaloneRun(null); setReports([]);
    setConversationLoading(false); setReportsLoading(false); setStreamError(''); setNewDialog(false); setPage('conversations');
  }, []);

  const reloadProject = useCallback(() => {
    bindProject(null); clearProjectState(); setProjectChanged(false); setError(''); setRefreshVersion((value) => value + 1);
  }, [clearProjectState]);

  useEffect(() => {
    const changed = () => {
      bindProject(null); clearProjectState(); busyRef.current = false; setBusy(false); setLoading(false); setConnected(true); setProjectChanged(true); setProjectDialog(false);
    };
    window.addEventListener('harness-project-changed', changed);
    return () => window.removeEventListener('harness-project-changed', changed);
  }, [clearProjectState]);

  const upsertConversation = useCallback((item: Conversation) => setConversations((current) => [item, ...current.filter((entry) => entry.id !== item.id)].sort((a, b) => b.updatedAt - a.updatedAt)), []);
  const upsertRun = useCallback((item: Run) => {
    setRuns((current) => [item, ...current.filter((entry) => entry.id !== item.id)].sort((a, b) => b.startedAt - a.startedAt));
    setConversation((current) => current && current.id === item.conversationId ? { ...current, canSend: isActive(item.status) ? false : current.canSend, runs: [...current.runs.filter((entry) => entry.id !== item.id), item].sort((a, b) => a.startedAt - b.startedAt) } : current);
    setStandaloneRun((current) => current?.id === item.id ? item : current);
  }, []);

  const readConversation = useCallback(async (id: string, signal?: AbortSignal) => {
    const version = mutationVersion.current;
    const generation = getProjectGeneration();
    const detail = await request<ConversationDetail>(`/conversations/${encodeURIComponent(id)}`, { signal });
    if (signal?.aborted || version !== mutationVersion.current || generation !== getProjectGeneration()) return;
    upsertConversation(detail);
    if (selectedConversation.current === id) {
      setConversation(detail);
      setSelectedRunId((current) => detail.runs.some((item) => item.id === current) ? current : detail.runs.at(-1)?.id ?? null);
    }
    setRuns((current) => [...current.filter((item) => !detail.runIds.includes(item.id)), ...detail.runs].sort((a, b) => b.startedAt - a.startedAt));
  }, [upsertConversation]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => { setMobile(media.matches); if (!media.matches) setMenuOpen(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!(mobile && menuOpen)) {
      if (menuWasOpen.current) { menuWasOpen.current = false; (focusTarget.current === 'heading' ? heading.current : menuButton.current)?.focus(); }
      return;
    }
    menuWasOpen.current = true;
    closeMenuButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); focusTarget.current = 'menu'; setMenuOpen(false); }
      if (event.key !== 'Tab') return;
      const items = sidebar.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if (!items?.length) return;
      const first = items[0]; const last = items[items.length - 1];
      const outside = !sidebar.current?.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [mobile, menuOpen]);

  useEffect(() => {
    const controller = new AbortController();
    let generation = getProjectGeneration();
    setLoading(true);
    void (async () => {
      const projects = await request<ProjectListing>('/projects', { signal: controller.signal });
      if (controller.signal.aborted || generation !== getProjectGeneration()) return;
      bindProject(projects.activeProjectId); generation = getProjectGeneration(); project.current = projects.activeProjectId;
      const workspace = await request<WorkspaceInfo>('/workspace', { signal: controller.signal });
      if (controller.signal.aborted || generation !== getProjectGeneration()) return;
      if (workspace.projectId !== projects.activeProjectId) { window.dispatchEvent(new CustomEvent('harness-project-changed')); return; }
      const [history, chats] = await Promise.all([request<{ runs: Run[] }>('/runs', { signal: controller.signal }), request<{ conversations: Conversation[] }>('/conversations', { signal: controller.signal })]);
      if (controller.signal.aborted || generation !== getProjectGeneration()) return;
      project.current = workspace.projectId;
      setInfo(workspace); setRuns(history.runs); setConversations(chats.conversations); setConnected(true); setError('');
    })().catch((cause: unknown) => { if (!controller.signal.aborted && generation === getProjectGeneration() && !staleRequest(cause)) { setError(cause instanceof Error ? cause.message : '无法连接本地服务。'); setConnected(false); } }).finally(() => { if (!controller.signal.aborted && generation === getProjectGeneration()) setLoading(false); });
    return () => controller.abort();
  }, [refreshVersion]);

  useEffect(() => {
    if (!info || projectChanged) return;
    const controller = new AbortController();
    const generation = getProjectGeneration();
    let polling = false;
    const timer = window.setInterval(() => {
      if (polling || busyRef.current) return;
      polling = true;
      const version = mutationVersion.current;
      Promise.all([request<{ runs: Run[] }>('/runs', { signal: controller.signal }), request<{ conversations: Conversation[] }>('/conversations', { signal: controller.signal }), request<ProjectListing>('/projects', { signal: controller.signal })]).then(([history, chats, projects]) => {
        if (controller.signal.aborted || version !== mutationVersion.current || generation !== getProjectGeneration()) return;
        if (projects.activeProjectId !== project.current) { window.dispatchEvent(new CustomEvent('harness-project-changed')); return; }
        setRuns(history.runs); setConversations(chats.conversations); setConnected(true);
        setConversation((current) => {
          if (!current) return current;
          const summary = chats.conversations.find((item) => item.id === current.id);
          return summary ? { ...current, canSend: summary.canSend, blockedReason: summary.blockedReason } : current;
        });
      }).catch((cause: unknown) => { if (!controller.signal.aborted && generation === getProjectGeneration() && !staleRequest(cause)) setConnected(false); }).finally(() => { polling = false; });
    }, 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [info?.projectId, projectChanged]);

  useEffect(() => {
    if (!selectedConversationId) return;
    const controller = new AbortController();
    setConversationLoading(true);
    const generation = getProjectGeneration();
    readConversation(selectedConversationId, controller.signal).catch((cause: unknown) => { if (!controller.signal.aborted && generation === getProjectGeneration() && !staleRequest(cause)) setError(cause instanceof Error ? cause.message : '无法读取会话。'); }).finally(() => { if (!controller.signal.aborted && generation === getProjectGeneration()) setConversationLoading(false); });
    return () => controller.abort();
  }, [selectedConversationId, readConversation, info?.projectId]);

  useEffect(() => {
    if (selectedConversationId || !selectedRunId) return;
    const controller = new AbortController();
    const id = selectedRunId;
    const version = mutationVersion.current;
    const generation = getProjectGeneration();
    request<Run>(`/runs/${encodeURIComponent(id)}`, { signal: controller.signal }).then((detail) => {
      if (controller.signal.aborted || selectedRun.current !== id || selectedConversation.current !== null || version !== mutationVersion.current || generation !== getProjectGeneration()) return;
      setStandaloneRun((current) => {
        if (current?.id !== id) return current;
        const currentSequence = current.events?.at(-1)?.sequence ?? 0;
        const detailSequence = detail.events?.at(-1)?.sequence ?? 0;
        return currentSequence > detailSequence ? current : detail;
      });
      setConnected(true);
    }).catch((cause: unknown) => { if (!controller.signal.aborted && selectedRun.current === id && generation === getProjectGeneration() && !staleRequest(cause)) setError(cause instanceof Error ? cause.message : '无法读取历史运行详情。'); });
    return () => controller.abort();
  }, [selectedConversationId, selectedRunId, info?.projectId]);

  const streamedRunId = latestRun && isActive(latestRun.status) ? latestRun.id : run?.id;
  const streamActive = !!(latestRun && isActive(latestRun.status) || run && isActive(run.status));
  streamingRun.current = streamedRunId;
  useEffect(() => {
    setStreamError('');
    if (!streamedRunId || !streamActive || !info || projectChanged) return;
    const generation = getProjectGeneration();
    const source = new EventSource(`/api/runs/${encodeURIComponent(streamedRunId)}/events?${new URLSearchParams({ projectId: info.projectId })}`);
    stream.current = source;
    const controller = new AbortController();
    const handleRun = (event: MessageEvent<string>) => {
      if (controller.signal.aborted || streamingRun.current !== streamedRunId || generation !== getProjectGeneration()) return;
      try {
        const snapshot = JSON.parse(event.data) as Run;
        if (snapshot.id !== streamedRunId) return;
        upsertRun(snapshot); setConnected(true); setStreamError('');
      } catch { setStreamError('执行事件暂时无法读取，正在等待下一次更新。'); }
    };
    source.addEventListener('run', handleRun as EventListener);
    source.onopen = () => { if (!controller.signal.aborted && generation === getProjectGeneration()) { setStreamError(''); setConnected(true); } };
    source.onerror = () => { if (!controller.signal.aborted && generation === getProjectGeneration()) setStreamError('实时连接中断，正在自动重连。已显示的记录仍可查看。'); };
    return () => { controller.abort(); source.removeEventListener('run', handleRun as EventListener); source.close(); if (stream.current === source) stream.current = null; };
  }, [streamedRunId, streamActive, readConversation, upsertRun, info?.projectId, projectChanged]);

  useEffect(() => {
    if (!latestRun || isActive(latestRun.status) || !latestRun.conversationId) return;
    const controller = new AbortController();
    const generation = getProjectGeneration();
    readConversation(latestRun.conversationId, controller.signal).catch((cause: unknown) => { if (!controller.signal.aborted && generation === getProjectGeneration() && !staleRequest(cause)) setError(cause instanceof Error ? cause.message : '无法更新会话结果。'); });
    return () => controller.abort();
  }, [latestRun?.id, latestRun?.status, readConversation]);

  useEffect(() => {
    if (page !== 'evaluations' || !info || projectChanged) return;
    const controller = new AbortController();
    setReportsLoading(true);
    const generation = getProjectGeneration();
    request<{ reports: Evaluation[] }>('/evaluations', { signal: controller.signal }).then((data) => { if (!controller.signal.aborted && generation === getProjectGeneration()) setReports(data.reports); }).catch((cause: unknown) => { if (!controller.signal.aborted && generation === getProjectGeneration() && !staleRequest(cause)) setError(cause instanceof Error ? cause.message : '无法读取评测报告。'); }).finally(() => { if (!controller.signal.aborted && generation === getProjectGeneration()) setReportsLoading(false); });
    return () => controller.abort();
  }, [page, info?.projectId, projectChanged]);

  const closeNewDialog = useCallback(() => setNewDialog(false), []);
  const restoreDialogFocus = useCallback(() => {
    const target = dialogReturnFocus.current;
    if (target?.isConnected && !target.closest('[inert]')) target.focus();
    else (menuButton.current?.offsetParent ? menuButton.current : heading.current)?.focus();
  }, []);
  const closeInspector = () => { setInspectorOpen(false); inspectorButton.current?.focus(); };
  const refreshWorkspace = async () => {
    if (busyRef.current || loading) return;
    if (!info || projectChanged) { reloadProject(); return; }
    const generation = getProjectGeneration();
    const version = mutationVersion.current;
    setLoading(true); setError('');
    try {
      const workspace = await request<WorkspaceInfo>('/workspace');
      if (generation !== getProjectGeneration()) return;
      if (workspace.projectId !== project.current) { window.dispatchEvent(new CustomEvent('harness-project-changed')); return; }
      const [history, chats, evaluations] = await Promise.all([request<{ runs: Run[] }>('/runs'), request<{ conversations: Conversation[] }>('/conversations'), page === 'evaluations' ? request<{ reports: Evaluation[] }>('/evaluations') : Promise.resolve(null)]);
      if (generation !== getProjectGeneration() || version !== mutationVersion.current) return;
      setInfo(workspace); setRuns(history.runs); setConversations(chats.conversations); if (evaluations) setReports(evaluations.reports); setConnected(true);
      if (selectedConversation.current) await readConversation(selectedConversation.current);
      else if (selectedRun.current) {
        const id = selectedRun.current;
        const detail = await request<Run>(`/runs/${encodeURIComponent(id)}`);
        if (generation === getProjectGeneration() && selectedRun.current === id && !selectedConversation.current) setStandaloneRun(detail);
      }
    } catch (cause) { if (generation === getProjectGeneration() && !staleRequest(cause)) { setError(cause instanceof Error ? cause.message : '刷新工作区失败。'); setConnected(false); } }
    finally { if (generation === getProjectGeneration()) setLoading(false); }
  };
  const navigate = (next: Page) => { if (mobile && menuOpen) focusTarget.current = 'heading'; setPage(next); setMenuOpen(false); };
  const openNewDialog = () => { dialogReturnFocus.current = mobile && sidebar.current?.contains(document.activeElement) ? menuButton.current : document.activeElement as HTMLElement | null; setMenuOpen(false); setNewDialog(true); setError(''); };
  const openProjectDialog = () => { dialogReturnFocus.current = mobile && sidebar.current?.contains(document.activeElement) ? menuButton.current : document.activeElement as HTMLElement | null; setNewDialog(false); setMenuOpen(false); setProjectDialog(true); setError(''); };
  const openProject = async (path: string, initialize: boolean) => {
    if (busyRef.current || globalActive) throw new Error('任务执行中，请等待完成或先停止执行，再切换项目。');
    busyRef.current = true; setBusy(true); setError('');
    let generation = getProjectGeneration();
    try {
      const result = await request<{ project: Project; workspace: WorkspaceInfo }>('/projects/open', { method: 'POST', body: JSON.stringify({ path, initialize }) });
      if (generation !== getProjectGeneration()) return;
      clearProjectState(); bindProject(result.project.id); generation = getProjectGeneration(); project.current = result.project.id;
      setProjectChanged(false); setProjectDialog(false); setInfo(result.workspace); setInspectorOpen(true); setLoading(true);
      const [history, chats] = await Promise.all([request<{ runs: Run[] }>('/runs'), request<{ conversations: Conversation[] }>('/conversations')]);
      if (generation !== getProjectGeneration()) return;
      setRuns(history.runs); setConversations(chats.conversations); setConnected(true);
    } catch (cause) {
      if (generation === getProjectGeneration() && !staleRequest(cause)) { setError(cause instanceof Error ? cause.message : '无法读取项目。'); throw cause; }
    } finally {
      if (generation === getProjectGeneration()) { busyRef.current = false; setBusy(false); setLoading(false); }
    }
  };
  const selectConversation = (id: string, runId?: string) => {
    if (id !== selectedConversationId) { selectedConversation.current = id; setConversation(null); setSelectedConversationId(id); setStandaloneRun(null); }
    selectedRun.current = runId ?? null; setSelectedRunId(runId ?? null); setError(''); setStreamError(''); navigate('conversations');
  };
  const chooseRun = (id: string) => { selectedRun.current = id; setSelectedRunId(id); setInspectorOpen(true); setError(''); };
  const selectHistoryRun = (id: string) => {
    const item = runs.find((entry) => entry.id === id);
    if (!item) return;
    if (item.conversationId) { selectConversation(item.conversationId, id); setInspectorOpen(true); }
    else { selectedConversation.current = null; setSelectedConversationId(null); setConversation(null); setStandaloneRun((current) => current?.id === id ? current : item); chooseRun(id); navigate('conversations'); }
  };

  const createConversation = async (input: NewConversationInput) => {
    if (busyRef.current || !info || projectChanged) return;
    const generation = getProjectGeneration();
    busyRef.current = true; setBusy(true); setError(''); mutationVersion.current += 1;
    try {
      const created = await request<Conversation>('/conversations', { method: 'POST', body: JSON.stringify(input) });
      if (generation !== getProjectGeneration()) return;
      upsertConversation(created); selectedConversation.current = created.id; selectedRun.current = null;
      setConversation({ ...created, runs: [] }); setSelectedConversationId(created.id); setSelectedRunId(null); setStandaloneRun(null); setNewDialog(false); navigate('conversations');
    } catch (cause) { if (generation === getProjectGeneration() && !staleRequest(cause)) setError(cause instanceof Error ? cause.message : '创建会话失败。'); }
    finally { if (generation === getProjectGeneration()) { busyRef.current = false; setBusy(false); } }
  };

  const send = async (content: string): Promise<boolean> => {
    if (!conversation || busyRef.current || !conversation.canSend || globalActive) return false;
    const id = conversation.id;
    const generation = getProjectGeneration();
    busyRef.current = true; setBusy(true); setError(''); mutationVersion.current += 1;
    try {
      const result = await request<{ conversation: Conversation; run: Run }>(`/conversations/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ content }) });
      if (generation !== getProjectGeneration()) return false;
      upsertConversation(result.conversation); upsertRun(result.run);
      if (selectedConversation.current === id) { setConversation((current) => ({ ...result.conversation, runs: [...(current?.id === id ? current.runs : []).filter((item) => item.id !== result.run.id), result.run] })); selectedRun.current = result.run.id; setSelectedRunId(result.run.id); }
      return true;
    } catch (cause) { if (selectedConversation.current === id && generation === getProjectGeneration() && !staleRequest(cause)) setError(cause instanceof Error ? cause.message : '发送消息失败。'); return false; }
    finally { if (generation === getProjectGeneration()) { busyRef.current = false; setBusy(false); } }
  };

  const action = async (suffix: string, body?: unknown, target: Run | null = run) => {
    if (!target || busyRef.current) return;
    const id = target.id;
    const generation = getProjectGeneration();
    busyRef.current = true; setBusy(true); setError(''); mutationVersion.current += 1;
    try {
      const result = await request<Run>(`/runs/${encodeURIComponent(id)}/${suffix}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
      if (generation !== getProjectGeneration()) return;
      upsertRun(result);
      if (result.conversationId) await readConversation(result.conversationId);
    } catch (cause) { if ((selectedRun.current === id || selectedConversation.current === target.conversationId) && generation === getProjectGeneration() && !staleRequest(cause)) setError(cause instanceof Error ? cause.message : '操作未完成。'); }
    finally { if (generation === getProjectGeneration()) { busyRef.current = false; setBusy(false); } }
  };

  const currentTitle = page === 'conversations' ? conversation?.title ?? (standaloneRun ? '历史运行' : '编码会话') : pages.find((item) => item.id === page)!.title;
  const workspaceName = info?.workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? '当前项目';
  const announcedRun = latestRun ?? run;
  const stateAnnouncement = announcedRun ? `${statusText[announcedRun.status]}${announcedRun.pendingApproval ? '，有操作等待审批' : ''}${announcedRun.verified ? '，验收通过' : ''}` : '';
  const blocked = newDialog || projectDialog || mobile && menuOpen;

  return <><div className="app-shell" inert={newDialog || projectDialog}><a className="skip-link" href="#main-content" inert={blocked}>跳到主内容</a>{mobile && menuOpen && <button className="sidebar-backdrop" tabIndex={-1} aria-label="关闭导航" onClick={() => { focusTarget.current = 'menu'; setMenuOpen(false); }} />}
    <aside id="primary-sidebar" ref={sidebar} className={`sidebar ${menuOpen ? 'open' : ''}`} inert={mobile && !menuOpen} aria-hidden={mobile && !menuOpen ? true : undefined}><div className="brand"><Terminal size={20} aria-hidden="true" /><span>Harness <strong>Studio</strong></span><button ref={closeMenuButton} className="mobile-close icon-button" aria-label="关闭导航" onClick={() => { focusTarget.current = 'menu'; setMenuOpen(false); }}><X size={20} aria-hidden="true" /></button></div><button className="new-conversation" disabled={!info || loading || projectChanged} onClick={openNewDialog}><Plus size={17} aria-hidden="true" />新建对话</button><button className="workspace-block" aria-label="打开或切换本地项目" aria-haspopup="dialog" disabled={busy || loading || projectChanged} onClick={openProjectDialog}><FolderOpen size={17} aria-hidden="true" /><span title={info?.workspace}>{workspaceName}</span><ChevronDown size={13} aria-hidden="true" /></button><div className="sidebar-section-label">会话 <span>{conversations.length}</span></div><nav className="conversation-list" aria-label="项目会话">{conversations.map((item) => <button key={item.id} className={`conversation-item ${page === 'conversations' && selectedConversationId === item.id ? 'active' : ''}`} aria-current={page === 'conversations' && selectedConversationId === item.id ? 'page' : undefined} onClick={() => selectConversation(item.id)}><MessageSquare size={15} aria-hidden="true" /><span><strong>{item.title}</strong><small>{item.mock ? '机制演示' : '真实模型'} · {timeLabel(item.updatedAt)}</small></span>{runs.some((entry) => entry.conversationId === item.id && isActive(entry.status)) && <span className="active-dot" aria-label="运行中" />}</button>)}{!conversations.length && <p className="no-conversations">新建对话后，任务与追加需求会保存在这里。</p>}</nav><nav className="utility-nav" aria-label="其他功能">{pages.map(({ id, title, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={16} aria-hidden="true" /><span>{title}</span></button>)}</nav><div className="sidebar-bottom"><span className={`connection-dot ${connected ? 'online' : ''}`} />{loading ? '连接中' : connected ? '本地服务在线' : '服务未连接'}<button className="icon-button" aria-label="刷新工作区" disabled={loading || busy} onClick={() => void refreshWorkspace()}><RefreshCw size={15} className={loading ? 'spin' : ''} aria-hidden="true" /></button></div></aside>
    <div className="main-shell" ref={main} inert={mobile && menuOpen}><header className="topbar"><button ref={menuButton} className="mobile-menu icon-button" aria-label="打开导航" aria-expanded={menuOpen} aria-controls="primary-sidebar" onClick={() => { focusTarget.current = 'menu'; setMenuOpen(true); }}><Menu size={20} aria-hidden="true" /></button><div className="topbar-title"><h1 ref={heading} tabIndex={-1}>{currentTitle}</h1>{page === 'conversations' && conversation && <span>{conversation.mock ? '机制演示' : info?.config.llm?.model ?? '真实模型'}</span>}</div>{page === 'conversations' && <div className="topbar-actions">{run && <span className={`status-pill status-${run.status}`}>{run.verified && <CheckCircle2 size={12} aria-hidden="true" />}{statusText[run.status]}</span>}<button ref={inspectorButton} className={`icon-button ${inspectorOpen ? 'selected' : ''}`} aria-label={inspectorOpen ? '收起工作区查看器' : '打开工作区查看器'} aria-expanded={inspectorOpen} onClick={() => setInspectorOpen((value) => !value)}><PanelRightOpen size={19} aria-hidden="true" /></button></div>}</header><div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{stateAnnouncement}</div>{projectChanged && <div className="project-change-banner" role="alert"><p>另一个页面已切换本地项目。旧项目请求已停止，请重新载入当前项目。</p><button className="button subtle" disabled={busy || loading} onClick={reloadProject}>重新载入当前项目</button></div>}{error && <div className="error-banner" role="alert"><CircleHelp size={17} aria-hidden="true" /><p>{error}</p><button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={17} aria-hidden="true" /></button></div>}
      <main id="main-content" className={page === 'conversations' ? `coding-workspace ${inspectorOpen ? 'with-inspector' : ''}` : 'secondary-page'}>{page === 'conversations' && <>{standaloneRun ? <div className="legacy-run"><History size={24} aria-hidden="true" /><h2>历史运行</h2><p>{standaloneRun.task}</p><p className="muted">旧版单次运行可以回看详情与改动。新建对话后可连续追加需求。</p><button className="button primary" onClick={openNewDialog}><Plus size={16} aria-hidden="true" />新建对话</button></div> : <ConversationView key={selectedConversationId ?? "empty"} conversation={conversation} selectedRun={run} loading={conversationLoading || loading} busy={busy} globalActive={globalActive} streamError={streamError} onNew={openNewDialog} onOpenProject={openProjectDialog} workspace={info?.workspace} disabled={!info || projectChanged} onSend={send} onSelectRun={chooseRun} onCancel={() => void action('cancel', undefined, latestRun)} onResume={() => void action('resume', undefined, latestRun)} onApprove={(approvalId, approved) => void action('approve', { approvalId, approved }, latestRun)} />}{inspectorOpen && <Inspector key={info?.projectId ?? "unloaded"} projectId={info?.projectId ?? null} workspace={conversation?.workspace ?? info?.workspace} demo={conversation?.mock ?? false} conversationId={selectedConversationId} run={run} busy={busy} onClose={closeInspector} onCancel={() => void action('cancel')} onResume={() => void action('resume')} onApprove={(approvalId, approved) => void action('approve', { approvalId, approved })} onRestart={openNewDialog} />}</>}{page === 'history' && <HistoryView runs={runs} selectedId={selectedRunId} onSelect={selectHistoryRun} />}{page === 'evaluations' && <EvaluationsView reports={reports} loading={reportsLoading} />}{page === 'system' && <SystemView info={info} />}</main>
    </div></div>{projectDialog && <ProjectDialog workspace={info?.workspace ?? ""} initialized={info?.initialized ?? false} busy={busy} blockedReason={globalActive ? "任务执行中，请等待完成或先停止执行，再切换项目。" : undefined} onOpen={openProject} onClose={() => setProjectDialog(false)} onRestoreFocus={restoreDialogFocus} />}{newDialog && <><NewConversationDialog initialized={info?.initialized ?? false} onInitialize={openProjectDialog} busy={busy} onClose={closeNewDialog} onCreate={createConversation} onRestoreFocus={restoreDialogFocus} />{error && <div className="dialog-error" role="alert">{error}</div>}</>}</>;
}

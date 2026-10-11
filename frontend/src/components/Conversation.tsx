import { ArrowDown, ArrowUp, Check, CheckCheck, ChevronRight, FlaskConical, LoaderCircle, MessageSquare, Plus, RotateCcw, ShieldCheck, Square, Terminal, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isActive, statusText, timeLabel, type ConversationDetail, type NewConversationInput, type Run } from '../api';

export function Markdown({ content }: { content: string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={(url) => {
    const safe = defaultUrlTransform(url);
    return /^(https?:|mailto:)/i.test(safe) || /^(#|\/|\.\/|\.\.\/)/.test(safe) || !safe.includes(':') ? safe : '';
  }} components={{ a: ({ children, href }) => <a href={href || undefined} target="_blank" rel="noopener noreferrer">{children}</a>, img: ({ alt }) => <span className="image-placeholder">[图片：{alt || '未加载'}]</span> }}>{content}</ReactMarkdown></div>;
}

function modelText(run: Run) {
  const responses = (run.events ?? []).filter((event) => event.type === 'model_response');
  for (let index = responses.length - 1; index >= 0; index--) {
    const data = responses[index].data as { response?: { content?: string } } | undefined;
    const content = data?.response?.content?.trim();
    if (!content) continue;
    try {
      const decoded = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')) as { done?: boolean; summary?: string; action?: unknown; type?: string };
      if (decoded.done && typeof decoded.summary === 'string') return decoded.summary;
      if (decoded.action || decoded.type) continue;
    } catch { return content; }
  }
  return '';
}

function latestActivity(run: Run) {
  for (const event of [...(run.events ?? [])].reverse()) {
    if (!['tool_start', 'tool_result', 'policy', 'verification', 'verify', 'model_request'].includes(event.type)) continue;
    const data = event.data as { action?: { type?: string; params?: { path?: string; command?: string } }; passed?: boolean } | undefined;
    if (event.type === 'model_request') return '正在请求模型';
    if (event.type === 'verification' || event.type === 'verify') return data?.passed ? '验收已通过' : '正在检查验收结果';
    if (data?.action) return `${event.type === 'tool_result' ? '工具已返回' : '执行工具'}：${data.action.type ?? ''}${data.action.params?.path ? ` · ${data.action.params.path}` : ''}`;
  }
  return statusText[run.status];
}

export function Approval({ run, busy, onApprove }: { run: Run; busy: boolean; onApprove: (id: string, approved: boolean) => void }) {
  const approval = run.pendingApproval;
  if (!approval) return null;
  return <section className="approval-panel" aria-label="待审批操作"><div className="approval-heading"><ShieldCheck size={18} aria-hidden="true" /><h3>批准后继续执行</h3></div><p>{approval.reason ?? approval.reasons?.join('；') ?? '这项操作需要人工确认。'}</p><pre>{approval.action.type} · {Object.entries(approval.action.params).map(([key, value]) => `${key}: ${String(value)}`).join('\n')}</pre><div className="approval-actions"><button className="button subtle" disabled={busy} onClick={() => onApprove(approval.approvalId ?? approval.id ?? '', false)}><X size={15} aria-hidden="true" />拒绝</button><button className="button primary" disabled={busy} onClick={() => onApprove(approval.approvalId ?? approval.id ?? '', true)}><Check size={15} aria-hidden="true" />批准本次</button></div></section>;
}

interface ChatProps {
  conversation: ConversationDetail | null;
  selectedRun: Run | null;
  loading: boolean;
  busy: boolean;
  globalActive: boolean;
  streamError: string;
  onNew: () => void;
  onSend: (content: string) => Promise<boolean>;
  onSelectRun: (id: string) => void;
  onCancel: () => void;
  onResume: () => void;
  onApprove: (id: string, approved: boolean) => void;
}

export function ConversationView({ conversation, selectedRun, loading, busy, globalActive, streamError, onNew, onSend, onSelectRun, onCancel, onResume, onApprove }: ChatProps) {
  const [content, setContent] = useState('');
  const [validation, setValidation] = useState('');
  const [atBottom, setAtBottom] = useState(true);
  const scrollArea = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);
  const latestRun = conversation?.runs.at(-1) ?? null;
  const active = latestRun && isActive(latestRun.status);
  const canSend = !!conversation?.canSend && !busy && !globalActive;
  const messages = conversation?.messages ?? [];
  useEffect(() => { setContent(''); setValidation(''); setAtBottom(true); }, [conversation?.id]);
  useEffect(() => { if (atBottom) bottom.current?.scrollIntoView({ block: 'nearest' }); }, [messages.length, latestRun?.events?.length, latestRun?.status, atBottom]);
  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = 'auto';
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 180)}px`;
  }, [content]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend || submitting.current) return;
    const text = content.trim();
    if (!text) { setValidation('请先输入任务或追加要求。'); textarea.current?.focus(); return; }
    submitting.current = true;
    setValidation('');
    try { if (await onSend(text)) { setContent(''); setAtBottom(true); } }
    finally { submitting.current = false; }
  };

  if (!conversation) return <div className="conversation-pane"><div className="chat-empty">{loading ? <><LoaderCircle className="spin" size={24} aria-hidden="true" /><p role="status">正在读取会话…</p></> : <><div className="empty-mark"><Terminal size={27} aria-hidden="true" /></div><h1>开始一段编码会话</h1><p>提出任务，审查改动，然后继续追加要求。</p><button className="button primary" onClick={onNew}><Plus size={17} aria-hidden="true" />新建对话</button><span className="empty-hint">无需模型密钥即可运行两轮机制演示</span></>}</div></div>;

  return <div className="conversation-pane"><div className="chat-scroll" ref={scrollArea} onScroll={() => { const element = scrollArea.current; if (element) setAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 80); }}>
    {!messages.length && <div className="chat-intro"><MessageSquare size={24} aria-hidden="true" /><h1>{conversation.mock ? '试一试完整编码流程' : '描述你想完成的任务'}</h1><p>{conversation.mock ? '第一轮修复金额计算，第二轮继续补充说明文档并验证。工具会修改会话的演示目录，运行测试前需要你审批。' : 'Agent 将读取当前工作区、修改代码并执行验收。你可以在完成后继续追加要求。'}</p>{conversation.mock && <button className="suggestion" onClick={() => { setContent('修复金额计算错误，并运行测试验证。'); textarea.current?.focus(); }}><FlaskConical size={16} aria-hidden="true" />修复金额计算错误，并运行测试验证<ChevronRight size={16} aria-hidden="true" /></button>}</div>}
    <div className="message-list">{messages.map((message) => {
      const messageRun = conversation.runs.find((item) => item.id === message.runId);
      return <article key={message.id} className={`chat-message message-${message.role}`}><div className="message-meta"><span>{message.role === 'user' ? '你' : 'Harness'}</span><time dateTime={new Date(message.createdAt).toISOString()}>{timeLabel(message.createdAt)}</time></div>{message.role === 'user' ? <div className="user-content">{message.content}</div> : <Markdown content={message.content} />}{message.role === 'assistant' && messageRun && <button className={`run-inline-link ${messageRun.id === selectedRun?.id ? 'selected' : ''}`} onClick={() => onSelectRun(messageRun.id)}><CheckCheck size={15} aria-hidden="true" />{statusText[messageRun.status]} · {messageRun.verified ? '验收通过' : '未通过验收'} · {messageRun.changes?.length ?? 0} 个文件<ChevronRight size={14} aria-hidden="true" /></button>}</article>;
    })}
    {latestRun && !messages.some((message) => message.role === 'assistant' && message.runId === latestRun.id) && <article className="chat-message message-assistant live-response"><div className="message-meta"><span>Harness</span><span className={`status-pill status-${latestRun.status}`}>{active && <LoaderCircle size={12} className="spin" aria-hidden="true" />}{statusText[latestRun.status]}</span></div>{modelText(latestRun) ? <Markdown content={modelText(latestRun)} /> : <p className="muted">{active ? '正在执行任务，工具结果会实时更新。' : latestRun.summary || latestRun.stopReason || statusText[latestRun.status]}</p>}<button className="run-inline-link" onClick={() => onSelectRun(latestRun.id)}><Terminal size={15} aria-hidden="true" />{latestActivity(latestRun)}<ChevronRight size={14} aria-hidden="true" /></button></article>}
    {latestRun?.pendingApproval && <Approval run={latestRun} busy={busy} onApprove={onApprove} />}
    </div><div ref={bottom} />
  </div>
  {!atBottom && <button className="latest-message-button" onClick={() => { setAtBottom(true); bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}><ArrowDown size={14} aria-hidden="true" />最新消息</button>}
  <div className="chat-composer-area">{streamError && <div className="stream-warning" role="status">{streamError}</div>}{conversation.mock && <div className="demo-note"><FlaskConical size={14} aria-hidden="true" /><span>固定脚本机制演示 · 展示连续执行与审批流程，结果不代表真实模型能力</span></div>}
    {latestRun && ['cancelled', 'stopped', 'error'].includes(latestRun.status) && latestRun.resumable && <div className="resume-bar"><span>本轮已中断，恢复后再追加新需求。</span><button className="text-button" disabled={busy || globalActive} onClick={onResume}><RotateCcw size={15} aria-hidden="true" />恢复本轮</button></div>}
    <form className="chat-composer" onSubmit={(event) => void submit(event)}><label className="sr-only" htmlFor="chat-input">{messages.length ? '追加要求' : '任务描述'}</label><textarea ref={textarea} id="chat-input" value={content} onChange={(event) => { setContent(event.target.value); setValidation(''); }} placeholder={messages.length ? '追加要求，继续修改这个项目…' : '描述任务，或点击上方的演示任务…'} maxLength={16000} rows={2} disabled={busy || !!active} aria-invalid={!!validation} aria-describedby={validation ? 'composer-validation' : 'composer-help'} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} /><div className="composer-controls"><span>{conversation.mock ? '机制演示' : '真实模型'}<i>·</i>{conversation.execution === 'docker' ? 'Docker 隔离' : '本机执行'}<i>·</i>{conversation.verifier ? '已配置验收' : conversation.mock ? '固定测试验收' : '未配置验收'}</span>{active ? <button className="send-button stop-button" type="button" aria-label="停止当前执行" disabled={busy} onClick={onCancel}><Square size={16} fill="currentColor" aria-hidden="true" /></button> : <button className="send-button" type="submit" aria-label="发送消息" disabled={!canSend || !content.trim()}><ArrowUp size={20} aria-hidden="true" /></button>}</div></form>
    {validation && <p id="composer-validation" className="field-error" role="alert">{validation}</p>}<div id="composer-help" className="composer-help"><span>{active ? '本轮执行中，可查看右侧详情或停止执行' : !conversation.canSend ? conversation.blockedReason || '当前会话暂时不能发送新消息' : globalActive ? '另一个任务正在执行，请等待完成' : 'Enter 发送 · Shift+Enter 换行'}</span><span>{conversation.mock ? '独立演示目录' : '当前仓库'}</span></div>
  </div></div>;
}

export function NewConversationDialog({ busy, onClose, onCreate, onRestoreFocus }: { busy: boolean; onClose: () => void; onCreate: (input: NewConversationInput) => Promise<void>; onRestoreFocus: () => void }) {
  const [mock, setMock] = useState(true);
  const [execution, setExecution] = useState<'local' | 'docker'>('docker');
  const [title, setTitle] = useState('');
  const [verify, setVerify] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const busyState = useRef(busy);
  const close = useRef(onClose);
  busyState.current = busy;
  close.current = onClose;
  useEffect(() => {
    firstInput.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!busyState.current) close.current(); }
      if (event.key !== 'Tab') return;
      const items = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)');
      if (!items?.length) return;
      const first = items[0]; const last = items[items.length - 1];
      const outside = !dialog.current?.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); onRestoreFocus(); };
  }, []);
  return <div className="dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><div ref={dialog} className="new-dialog" role="dialog" aria-modal="true" aria-labelledby="new-dialog-title"><header><h2 id="new-dialog-title">新建对话</h2><button className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭新建对话"><X size={20} aria-hidden="true" /></button></header><form onSubmit={(event) => { event.preventDefault(); void onCreate({ title: title.trim() || undefined, mock, execution: mock ? 'local' : execution, verify: mock ? undefined : verify.trim() || undefined }); }}><label className="field-label" htmlFor="conversation-title">对话名称 <span>可选，首条任务会自动命名</span></label><input ref={firstInput} id="conversation-title" maxLength={120} value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} placeholder="例如：修复订单金额计算" /><fieldset className="mode-selection"><legend>执行模式</legend><label className={mock ? 'selected' : ''}><input type="radio" name="conversation-mode" checked={mock} disabled={busy} onChange={() => setMock(true)} /><span><strong>机制演示</strong><small>固定两轮脚本，不需要模型密钥</small></span></label><label className={!mock ? 'selected' : ''}><input type="radio" name="conversation-mode" checked={!mock} disabled={busy} onChange={() => setMock(false)} /><span><strong>真实模型</strong><small>使用当前工作区配置的模型</small></span></label></fieldset>{mock ? <p className="dialog-mode-note">演示在独立目录完成金额修复、追加说明与测试；流程包含人工审批，不统计为真实模型效果。</p> : <><label className="field-label" htmlFor="execution-mode">工具执行环境</label><select id="execution-mode" value={execution} disabled={busy} onChange={(event) => setExecution(event.target.value as 'local' | 'docker')}><option value="docker">Docker 隔离</option><option value="local">本机执行</option></select><label className="field-label" htmlFor="verifier">验收命令 <span>可选</span></label><input id="verifier" value={verify} disabled={busy} maxLength={4000} onChange={(event) => setVerify(event.target.value)} placeholder="例如：npm test" /><p className="dialog-mode-note">模式与验收命令在创建后固定。{execution === 'local' ? '本机模式直接在当前工作区执行命令。' : 'Docker 模式使用已配置的镜像与执行边界。'}</p></>}<footer><button className="button subtle" type="button" disabled={busy} onClick={onClose}>取消</button><button className="button primary" disabled={busy} type="submit">{busy ? '创建中…' : '创建对话'}</button></footer></form></div></div>;
}

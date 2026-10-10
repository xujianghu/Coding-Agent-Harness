import { Check, CheckCheck, ChevronDown, Circle, CircleCheck, Clock3, FileCode2, GitBranch, ListChecks, LoaderCircle, ShieldCheck, Square, Terminal, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatNumber, isActive, runModeText, shortId, statusText, type Run, type RunEvent } from '../api';

interface Props {
  run: Run | null;
  busy: boolean;
  onCancel: () => void;
  onApprove: (approvalId: string, approved: boolean) => void;
  onResume: () => void;
  onRestart: (task: string) => void;
  loading?: boolean;
}

const labels: Record<string, string> = {
  started: '任务已启动', start: '任务已启动', model: '模型响应', model_request: '请求模型', model_response: '模型响应',
  tool_start: '执行工具', tool_result: '工具返回', tool: '工具调用', action: '工具操作',
  governance: '策略检查', policy: '策略检查', approval_requested: '请求审批', approval_resolved: '审批结果', approval: '人工审批',
  verification: '执行验收', verify: '执行验收', turn: '执行轮次', checkpoint: '保存检查点',
  completed: '执行完成', finished: '执行结束', stop: '执行已停止', error: '执行错误', state: '状态更新',
  cancelled: '已取消执行', cancel_requested: '正在取消', resumed: '继续执行', resume: '继续执行',
  message: '更新上下文', messages: '更新上下文', action_result: '操作结果',
  policy_recheck: '审批后复查策略', workspace_changes: '记录文件改动', model_error: '模型请求失败', run_error: '执行错误',
};

function eventSummary(event: RunEvent): string {
  if (typeof event.data === 'string') return event.data;
  if (!event.data || typeof event.data !== 'object') return '';
  const data = event.data as Record<string, unknown>;
  if (typeof data.approved === 'boolean') return data.approved ? '已批准本次操作' : '已拒绝本次操作';
  if (typeof data.error === 'string') return data.error;
  if (typeof data.summary === 'string') return data.summary;
  if (typeof data.message === 'string') return data.message;
  if (event.type === 'model_request' && typeof data.callId === 'number') return `第 ${data.callId} 次模型调用`;
  if (event.type === 'model_response' && data.response && typeof data.response === 'object') {
    const response = data.response as { content?: string; toolCalls?: { name: string }[] };
    if (response.toolCalls?.length) return `请求工具：${response.toolCalls.map((call) => call.name).join('、')}`;
    if (response.content) return response.content;
  }
  if (event.type === 'workspace_changes' && Array.isArray(data.paths)) return data.paths.join('、');
  const action = (data.action ?? data) as Record<string, unknown>;
  if (typeof action.type === 'string' && action.params && typeof action.params === 'object') {
    const params = action.params as Record<string, unknown>;
    const detail = params.command ?? params.path ?? params.query ?? '';
    const result = data.result as { success?: boolean; allowed?: boolean; reason?: string; output?: unknown; error?: string } | undefined;
    const output = typeof result?.output === 'string' ? result.output : result?.error ?? result?.reason;
    return `${action.type}${detail ? ` · ${String(detail)}` : ''}${result?.success === undefined ? '' : result.success ? '\n操作成功' : '\n操作未成功'}${result?.allowed === undefined ? '' : result.allowed ? '\n策略允许' : '\n策略限制'}${output ? `\n${String(output).slice(0, 1600)}` : ''}`;
  }
  if (typeof data.reason === 'string') return data.reason;
  if (typeof data.passed === 'boolean') return data.passed ? '验收通过' : '验收未通过';
  if (typeof data.success === 'boolean') return data.success ? '操作成功' : '操作未成功';
  if (typeof data.turn === 'number') return `第 ${data.turn} 轮`;
  if (typeof data.state === 'string') return statusText[data.state as Run['status']] ?? data.state;
  if (typeof data.status === 'string') return `${statusText[data.status as Run['status']] ?? data.status}${data.verified ? ' · 验收通过' : ''}`;
  return '';
}

function EventIcon({ type }: { type: string }) {
  if (type.includes('approval') || type === 'policy' || type === 'governance') return <ShieldCheck size={15} aria-hidden="true" />;
  if (type.includes('tool') || type === 'action') return <Terminal size={15} aria-hidden="true" />;
  if (type.includes('verif') || type.includes('complete') || type === 'finished') return <CheckCheck size={15} aria-hidden="true" />;
  return <Circle size={12} aria-hidden="true" />;
}

function elapsed(run: Run | null) {
  if (!run) return '—';
  const seconds = Math.max(0, Math.floor((new Date(run.finishedAt ?? Date.now()).getTime() - new Date(run.startedAt).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function RunStats({ run }: { run: Run | null }) {
  const tokens = run?.usage?.totalTokens ?? (run?.usage ? (run.usage.promptTokens ?? run.usage.inputTokens ?? 0) + (run.usage.completionTokens ?? run.usage.outputTokens ?? 0) : undefined);
  return <section className="stats-panel panel" aria-labelledby="stats-title">
    <div className="section-heading"><h2 id="stats-title">执行概览</h2><GitBranch size={17} aria-hidden="true" /></div>
    <dl className="stats-grid">
      <div><dt>执行轮次</dt><dd>{run ? run.turns : '—'}<span>轮</span></dd></div>
      <div><dt>运行时长</dt><dd>{elapsed(run)}</dd></div>
      <div className="token-stat"><dt>Token {run?.usageEstimated && <span className="small-tag">估算</span>}</dt><dd>{formatNumber(tokens)}</dd></div>
    </dl>
    <div className={`verification-status ${run?.verified ? 'verified' : ''}`}><ShieldCheck size={18} aria-hidden="true" /><div><strong>{run?.verified ? '验收通过' : run && isActive(run.status) ? '等待验收' : '尚未通过验收'}</strong><p>{run?.verified ? '验收命令已成功完成' : run ? '完成执行后依据命令结果判定' : '提交任务后记录验收结果'}</p></div></div>
    {run && <dl className="metadata"><div><dt>运行编号</dt><dd title={run.id}>{shortId(run.id)}</dd></div><div><dt>模型模式</dt><dd>{runModeText(run)}</dd></div>{run.source && <div><dt>运行来源</dt><dd>{run.source === 'cli' ? '命令行' : '工作台'}</dd></div>}<div><dt>工作区</dt><dd className="path-text" title={run.workspace}>{run.workspace}</dd></div></dl>}
  </section>;
}

export function RunDetails({ run, busy, onCancel, onApprove, onResume, onRestart, loading }: Props) {
  const latest = useRef<HTMLDivElement>(null);
  const [showRaw, setShowRaw] = useState(false);
  const events = run?.events ?? [];
  const approval = run?.pendingApproval;
  const active = run && isActive(run.status);
  return <section className="activity-panel panel" aria-labelledby="activity-title">
    <div className="section-heading"><div><span className="eyebrow">执行轨迹</span><h2 id="activity-title">{run ? '当前运行' : '等待第一条任务'}</h2></div>
      {run && <span className={`status-pill status-${run.status}`}>{active && run.status !== 'awaiting_approval' ? <LoaderCircle size={12} className="spin" aria-hidden="true" /> : run.status === 'completed' ? <CircleCheck size={12} aria-hidden="true" /> : <Circle size={8} fill="currentColor" aria-hidden="true" />}{statusText[run.status]}</span>}
    </div>
    {!run ? loading ? <p className="loading-text" role="status">正在读取执行轨迹…</p> : <div className="empty-timeline"><div className="empty-icon"><ListChecks size={28} strokeWidth={1.5} aria-hidden="true" /></div><h3>每一步执行，都可以追踪</h3><p>提交任务后，这里会显示模型响应、<br />工具执行、策略检查与验收结果。</p><div className="empty-flow"><span>规划</span><i /><span>执行</span><i /><span>验收</span></div></div> : <>
      <div className="run-task"><p>{run.task}</p><div className="run-actions">{active && <button className="button subtle danger" onClick={onCancel} disabled={busy}><Square size={13} aria-hidden="true" />{busy ? '正在处理…' : '停止执行'}</button>}{['error', 'stopped', 'cancelled'].includes(run.status) && <>{run.resumable && <button className="button subtle" onClick={onResume} disabled={busy}><PlayIcon />恢复会话</button>}<button className="text-button" onClick={() => onRestart(run.task)} disabled={busy}>重新填写</button></>}</div></div>
      <div className="run-steps" aria-label="执行阶段"><span className="step done"><Check size={12} aria-hidden="true" />任务准备</span><span className={`step ${events.some((event) => event.type === 'tool_result') ? 'done' : ''}`}><Terminal size={12} aria-hidden="true" />工具执行</span><span className={`step ${run.verified ? 'done' : ''}`}><ShieldCheck size={12} aria-hidden="true" />结果验收</span></div>
      {approval && <div className="approval-panel" aria-labelledby="approval-title"><div className="approval-heading"><ShieldCheck size={18} aria-hidden="true" /><h3 id="approval-title">这一步需要你的审批</h3></div><p>{approval.reason ?? approval.reasons?.join('；') ?? '确认操作后，Agent 将继续执行。'}</p><code>{approval.action.type} · {Object.entries(approval.action.params).map(([key, value]) => `${key}: ${String(value)}`).join('\n')}</code><div className="approval-actions"><button className="button subtle" disabled={busy} onClick={() => onApprove(approval.approvalId ?? approval.id ?? '', false)}><X size={14} aria-hidden="true" />拒绝</button><button className="button amber" disabled={busy} onClick={() => onApprove(approval.approvalId ?? approval.id ?? '', true)}><Check size={14} aria-hidden="true" />批准本次</button></div></div>}
      <div className="timeline-toolbar"><span>{events.length} 条事件</span><label className="raw-toggle"><input type="checkbox" checked={showRaw} onChange={(event) => setShowRaw(event.target.checked)} />显示原始详情</label></div>
      <ol className="timeline">{events.map((event) => <li className={`event event-${event.type}`} key={event.sequence}><div className="event-icon"><EventIcon type={event.type} /></div><div className="event-body"><div className="event-heading"><strong>{labels[event.type] ?? '运行事件'}</strong><time dateTime={new Date(event.timestamp).toISOString()}>{new Date(event.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</time></div>{eventSummary(event) && <p>{eventSummary(event)}</p>}{showRaw && <details><summary>JSON 详情 <ChevronDown size={12} aria-hidden="true" /></summary><pre>{JSON.stringify(event.data, null, 2)}</pre></details>}</div></li>)}</ol>
      {events.length > 4 && <button className="jump-button" onClick={() => latest.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}><ChevronDown size={14} aria-hidden="true" />跳到最新事件</button>}
      <div ref={latest} />
      {!active && <div className={`run-outcome ${run.status === 'error' ? 'outcome-error' : ''}`}><strong>{run.verified ? '任务已完成，验收通过' : statusText[run.status]}</strong>{run.summary && <p>{run.summary}</p>}{run.stopReason && <p className="mono-text">{run.stopReason}</p>}</div>}
    </>}
  </section>;
}

function PlayIcon() { return <Clock3 size={14} aria-hidden="true" />; }

export function Changes({ run }: { run: Run | null }) {
  const changes = run?.changes ?? [];
  return <section className="changes-panel panel" aria-labelledby="changes-title"><div className="section-heading"><h2 id="changes-title">文件改动</h2><span className="count-tag">{changes.length}</span></div>{changes.length ? <div className="changes-list">{changes.map((change) => <details key={change.path} open={changes.length === 1}><summary><FileCode2 size={15} aria-hidden="true" /><span>{change.path}</span><ChevronDown size={14} aria-hidden="true" /></summary><div className="diff-columns"><div className="diff-before"><div className="diff-label">修改前</div><pre>{change.before ?? '（新建文件）'}</pre></div><div className="diff-after"><div className="diff-label">修改后</div><pre>{change.after ?? '（已删除文件）'}</pre></div></div></details>)}</div> : <div className="empty-changes"><FileCode2 size={23} strokeWidth={1.5} aria-hidden="true" /><p>{run ? '本次运行暂无文件改动' : '运行中的代码改动会显示在这里'}</p></div>}</section>;
}

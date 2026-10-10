import { ArrowUpRight, FlaskConical, Play, Sparkles, Terminal, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import type { NewRunInput } from '../api';

interface Props {
  onSubmit: (input: NewRunInput) => Promise<void>;
  busy: boolean;
  active: boolean;
  initialTask?: string;
}

const examples = [
  { name: '金额计算修复', task: '修复演示工作区中的金额计算函数，并运行测试确认结果。' },
  { name: '检查执行流程', task: '检查金额计算函数，定位计算错误，以最小补丁修复并通过验收。' },
];

export function Composer({ onSubmit, busy, active, initialTask }: Props) {
  const [task, setTask] = useState(initialTask ?? examples[0].task);
  const [verify, setVerify] = useState('');
  const [mock, setMock] = useState(true);
  const [execution, setExecution] = useState<'docker' | 'local'>('docker');
  const [validation, setValidation] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!task.trim()) {
      setValidation('请先描述要完成的任务。');
      return;
    }
    setValidation('');
    await onSubmit({ task: task.trim(), verify: mock ? undefined : verify.trim() || undefined, mock, execution: mock ? 'local' : execution });
  };

  return <section className="composer panel" aria-labelledby="new-task-title">
    <div className="section-heading">
      <div><span className="eyebrow">新任务</span><h2 id="new-task-title">准备开始一次执行</h2></div>
      <span className="small-tag"><Sparkles size={13} aria-hidden="true" /> 可验证的执行</span>
    </div>
    <form onSubmit={submit}>
      <label className="field-label" htmlFor="task">任务描述</label>
      <textarea id="task" value={task} onChange={(event) => setTask(event.target.value)} rows={4}
        placeholder="描述目标、相关文件和预期结果…" required maxLength={12000}
        aria-describedby={validation ? 'task-validation' : 'task-help'} disabled={busy} />
      {validation && <p id="task-validation" role="alert" className="field-error">{validation}</p>}
      <div className="examples" id="task-help"><span>快速填入</span>{examples.map((example) =>
        <button type="button" className="example-button" key={example.name} onClick={() => { setTask(example.task); setMock(true); }} disabled={busy}>
          {example.name}<ArrowUpRight size={12} aria-hidden="true" />
        </button>)}</div>
      <div className="form-row">
        <div className="field verify-field"><label className="field-label" htmlFor="verify"><Terminal size={14} aria-hidden="true" /> 验收命令 <span className="optional">选填</span></label>
          <input id="verify" value={verify} onChange={(event) => setVerify(event.target.value)} placeholder={mock ? '演示自动执行内置测试' : '例如 npm test 或 mvn test'} disabled={busy || mock} aria-describedby="verify-help" />
          <p className="field-help" id="verify-help">{mock ? '在独立示例工作区修复金额计算并运行测试。' : '命令退出码为 0 才会标记为通过验收。'}</p>
        </div>
        <div className="field execution-field"><label className="field-label" htmlFor="execution">执行环境</label>
          <select id="execution" value={mock ? 'local' : execution} onChange={(event) => setExecution(event.target.value as 'docker' | 'local')} disabled={busy || mock} aria-describedby="execution-help">
            <option value="docker">Docker 隔离</option><option value="local">本机执行</option>
          </select><p className={mock || execution === 'local' ? 'field-help warning-text' : 'field-help'} id="execution-help">{mock ? '演示在独立工作区本机执行。' : execution === 'local' ? '本机模式没有容器隔离。' : '限制网络、权限与执行资源。'}</p>
        </div>
      </div>
      <div className="composer-footer">
        <fieldset className="mode-picker"><legend className="sr-only">模型模式</legend>
          <label className={mock ? 'selected' : ''}><input type="radio" name="model-mode" checked={mock} onChange={() => setMock(true)} disabled={busy} /><FlaskConical size={15} aria-hidden="true" /> 机制演示</label>
          <label className={!mock ? 'selected' : ''}><input type="radio" name="model-mode" checked={!mock} onChange={() => setMock(false)} disabled={busy} /><Sparkles size={15} aria-hidden="true" /> 真实模型</label>
        </fieldset>
        <button className="button primary" type="submit" disabled={busy || active}>{busy ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Play size={15} fill="currentColor" aria-hidden="true" />}{busy ? '正在创建…' : active ? '当前任务正在执行' : '开始执行'}</button>
      </div>
      <p className="mode-note">{mock ? '演示使用固定模型响应，产生真实的工具执行与验收记录。' : '使用当前工作区与已配置的模型提供商。'}</p>
    </form>
  </section>;
}

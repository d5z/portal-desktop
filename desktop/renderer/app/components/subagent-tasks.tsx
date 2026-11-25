import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AppModel } from '../models/app';
import type { SceneTask, SceneTaskSnapshot, SubagentTaskDetail } from '../../../shared/types';
import { Icon } from '../../shared/icons/icon';
import { ActivityIcon } from '../../shared/icons/activity';
import { Markdown } from '../../shared/components/markdown';
import { WorkspaceDrawer } from '../../shared/components/workspace-drawer';
import { PanelResizeHandle, usePanelWidth } from '../../shared/components/panel-resize';
import styles from './subagent-tasks.module.scss';

const labels: Record<SceneTask['status'], string> = {
  queued: '排队中', running: '执行中', done: '已完成', failed: '执行失败',
  cancelled: '已取消', interrupted: '已中断', budget_exhausted: '已达限额', timeout: '已超时',
};
const activeStatuses = new Set<SceneTask['status']>(['running', 'queued']);

export function SubagentTasks({ app }: { app: AppModel }) {
  const [snapshot, setSnapshot] = useState<SceneTaskSnapshot>();
  const [details, setDetails] = useState<SubagentTaskDetail[]>([]);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const endpoint = app.snapshot?.settings.endpoint;
  const ids = app.subagentTaskIds;
  useEffect(() => {
    let disposed = false;
    const update = (next: SceneTaskSnapshot) => { if (!disposed && next.endpoint === endpoint) setSnapshot(next); };
    const stop = app.api.onSceneTasks?.(update);
    void app.api.sceneTasks?.().then(update).catch(() => {});
    return () => { disposed = true; stop?.(); };
  }, [app, endpoint, app.snapshot?.settings.portalConfigPath, app.snapshot?.portal.pid]);
  useEffect(() => {
    if (!ids.length || !endpoint || app.view !== 'chat') return;
    let disposed = false;
    void app.api.subagentTaskDetails?.(endpoint, ids).then(next => {
      if (!disposed) { setDetails(next); setError(''); }
    }, () => { if (!disposed) setError('执行记录读取失败，请重试。'); });
    return () => { disposed = true; };
  }, [app, app.view, endpoint, ids, snapshot, retry]);
  const tasks = snapshot && snapshot.endpoint === endpoint ? snapshot.tasks.filter(task => ids.includes(task.id)) : [];
  return ids.length && app.view === 'chat' ? <SubagentTaskPanel key={`${ids.join(',')}:${app.subagentSelectedTaskId || ''}`} initialSelectedId={app.subagentSelectedTaskId} tasks={tasks} details={details} error={error}
    onWork={id => app.openWork(id)} onRetry={() => setRetry(value => value + 1)} onClose={app.closeSubagentTasks} /> : null;
}

export function SubagentTaskPanel({ tasks, details, error, onRetry, onClose, initialSelectedId, onWork }: {
  onWork?: (id?: string) => void;
  initialSelectedId?: string;
  tasks: SceneTask[]; details: SubagentTaskDetail[]; error: string; onRetry: () => void; onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [width, setWidth] = usePanelWidth('subagent', 420);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialSelectedId);
  const [now, setNow] = useState(Date.now);
  const active = tasks.filter(task => activeStatuses.has(task.status)).length;
  const failed = tasks.filter(task => ['failed', 'cancelled', 'interrupted', 'budget_exhausted', 'timeout'].includes(task.status)).length;
  const completed = tasks.filter(task => task.status === 'done').length;
  const overviewStatus = active ? `${active} 个执行中` : failed ? `${failed} 个未完成` : tasks.length ? `${completed} 个已完成` : '等待状态同步';
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    const node = panel.current;
    window.dispatchEvent(new CustomEvent('beings:side-panel-open', { detail: node }));
    const replace = (event: Event) => { if ((event as CustomEvent).detail !== node) onClose(); };
    window.addEventListener('beings:side-panel-open', replace);
    return () => window.removeEventListener('beings:side-panel-open', replace);
  }, [onClose]);
  const selected = tasks.find(task => task.id === selectedId);
  const detail = details.find(item => item.taskId === selectedId);
  const steps = detail?.steps || [];
  const resultStep = !selected || activeStatuses.has(selected.status) ? undefined : steps.filter(step => step.kind === 'message').at(-1);
  const execution = steps.filter((step, index) => ['tool', 'tool-result', 'message', 'thinking'].includes(step.kind) && step !== resultStep && !(step.kind === 'tool-result' && steps.some(call => call.kind === 'tool' && call.callId === step.callId)) && !(step.kind === 'thinking' && steps[index - 1]?.kind === 'thinking'));
  const ordered = [...tasks].sort((a, b) => Number(activeStatuses.has(b.status)) - Number(activeStatuses.has(a.status)) || b.createdAt - a.createdAt);
  function elapsed(task: SceneTask) {
    return `${Math.max(0, Math.floor(((task.endedAt || (activeStatuses.has(task.status) ? now : task.createdAt)) - task.createdAt) / 1000))} 秒`;
  }
  function phase(task: SceneTask) {
    if (task.status !== 'running') return labels[task.status];
    const activity = details.find(item => item.taskId === task.id)?.steps || [];
    const pending = activity.filter(step => step.kind === 'tool' && !activity.some(result => result.kind === 'tool-result' && result.callId === step.callId));
    const last = activity.filter(step => !['started', 'finished'].includes(step.kind)).at(-1);
    return pending.length ? `正在运行 ${pending.map(step => step.name).join('、')}` : last?.kind === 'message' ? '正在整理结果' : '正在思考';
  }
  return <WorkspaceDrawer ref={panel} className={`client-file-viewer ${styles.panel}`} id="subagent-task-panel"
    style={{ '--file-preview-width': `${width}px` } as CSSProperties} aria-label="子智能体侧栏"
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <PanelResizeHandle panel={panel} label="调整子智能体侧栏宽度" width={width} onResize={setWidth} initial={420} min={280} max={800} reserve={320} />
    <header>
      {selected && <button type="button" aria-label="返回子智能体列表" onClick={() => setSelectedId(undefined)}><Icon name="back" width="18" height="18" /></button>}
      <strong>{selected ? '执行详情' : '子智能体'}</strong>
      <button type="button" aria-label="关闭子智能体侧栏" autoFocus onClick={onClose}><Icon name="close" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" /></button>
    </header>
    <div className={styles.body} key={selectedId || 'list'}>
      {error && <p role="alert">{error} <button onClick={onRetry}>重试</button></p>}
      {!selected ? <>
        <div className={styles.overview} role="status">
          <strong>{tasks.length} 个子任务</strong>
          <span className={failed ? styles.overviewError : undefined}>{overviewStatus}</span>
        </div>
        {!tasks.length && <p>暂无本轮任务记录</p>}
        <ul className={styles.list}>{ordered.map(task => <li key={task.id}>
          <button type="button" className={styles.task} data-status={task.status} onClick={() => setSelectedId(task.id)} aria-label={`查看子任务：${task.brief || task.id}`}>
            <span className={styles.taskIcon}><Icon name="activity-tool" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" /></span>
            <span className={styles.taskText}><strong>{task.brief?.split('\n')[0] || '后台子任务'}</strong><span className={styles.status}>{phase(task)}</span></span>
            <small>{elapsed(task)}</small>
          </button>
        </li>)}</ul>
      </> : <>
        <h2 className={styles.taskTitle}>{selected.brief?.split('\n')[0] || '子智能体'}</h2>
        <div className={styles.detailStatus} data-status={selected.status} role="status">
          <span className={styles.phase}><ActivityIcon name={selected.status === 'done' ? 'check' : selected.status === 'cancelled' ? 'stop' : activeStatuses.has(selected.status) ? 'think' : 'error'} /><strong>{labels[selected.status]}</strong></span>
          <span>{elapsed(selected)}{selected.turns ? ` · ${selected.turns} 轮` : ''}</span>
        </div>
        <details className={styles.brief}><summary><span>任务说明</span><ActivityIcon name="chevron" /></summary><p>{steps.find(step => step.kind === 'started')?.input || selected.brief}</p></details>
        {onWork && <button type="button" onClick={() => onWork(selected.id)}>在 Work 中继续对话</button>}
        {selected.error && <p className={styles.error} role="alert">{selected.error}</p>}
        <details className={styles.steps} aria-label="子智能体思考过程">
          <summary className={styles.processSummary}>
            <ActivityIcon name={activeStatuses.has(selected.status) ? 'think' : 'check'} />
            <span>{activeStatuses.has(selected.status) ? phase(selected) : '思考过程'}</span>
            <small>{steps.filter(step => step.kind === 'tool').length} 次工具调用</small>
            <ActivityIcon name="chevron" />
          </summary>
          {!detail ? <p role="status">正在读取执行记录…</p> : !steps.length ? <p>该任务未保存执行步骤。新任务会实时显示。</p> :
            <ol>{execution.map((step, index) => {
              const outcome = step.kind === 'tool' ? steps.find(item => item.kind === 'tool-result' && item.callId === step.callId) : undefined;
              const ended = !!outcome;
              const failed = step.failed || outcome?.failed;
              const running = selected.status === 'running' && (step.kind === 'tool' ? !ended : step.kind === 'thinking' && index === execution.length - 1);
              const icon = failed ? 'error' : step.kind === 'thinking' ? 'think' : step.kind === 'tool' ? 'tool' : 'check';
              return <li key={`${step.at}-${index}`} data-running={running} data-failed={failed}>
                <div className={styles.stepHeading}>
                  <span className={styles.stepIcon}><ActivityIcon name={icon} /></span>
                  <strong>{step.kind === 'tool' ? step.name : step.kind === 'tool-result' ? `${step.name} · ${step.failed ? '失败' : '完成'}` : step.kind === 'message' ? '子智能体回复' : running ? '正在思考' : '思考'}</strong>
                  <time>{new Date(step.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time>
                </div>
                <div className={styles.stepContent}>
                  {step.kind === 'tool' && <small>{failed ? '执行失败' : ended ? '已完成' : running ? '正在执行' : '结果未确认'}</small>}
                  {step.input && <><h4>参数</h4><pre>{step.input}</pre></>}
                  {outcome?.output && <><h4>{failed ? '错误输出' : '输出'}</h4><pre>{outcome.output}</pre></>}
                  {step.output && (step.kind === 'message' ? <Markdown content={step.output} className={styles.markdown} /> : <><h4>输出</h4><pre>{step.output}</pre></>)}
                </div>
              </li>;
            })}</ol>}
        </details>
        {resultStep?.output && <section className={styles.result}><h3>执行结果</h3><Markdown content={resultStep.output} className={styles.markdown} /></section>}

      </>}
    </div>
  </WorkspaceDrawer>;
}

import { useState, type FormEvent } from 'react';
import type { WorkItem, WorkProjectRules, WorkRule, WorkWakeupTrigger } from '../../../shared/work';
import type { WorkProject } from '../../../shared/types';
import type { WorkModel } from '../models/work';
import styles from './work.module.scss';

const stateLabel: Record<WorkRule['status'], string> = { armed: '等待触发', starting: '正在启动', started: '已派发', failed: '启动失败' };

export function WorkProjectAutomation({ project, work }: { project: WorkProject; work: WorkModel }) {
  const [executor, setExecutor] = useState(project.rules?.executor || '');
  const [reviewer, setReviewer] = useState(project.rules?.handoff?.executor || '');
  const [instruction, setInstruction] = useState(project.rules?.handoff?.instruction || '');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const choices = work.executorChoices;
  const executorAvailable = !executor || choices.some(agent => agent.id === executor);
  const reviewerAvailable = !reviewer || choices.some(agent => agent.id === reviewer);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setNotice(undefined);
    try {
      const rules: WorkProjectRules = { executor, ...(reviewer ? { handoff: { executor: reviewer, instruction } } : {}) };
      await work.workRequest(`projects/${project.id}`, 'PATCH', rules, 'subagent');
      await work.refresh();
      setNotice({ text: '已保存项目规则' });
    } catch (error) { setNotice({ text: (error as Error).message, error: true }); }
    finally { setSaving(false); }
  };
  return <details className={styles.automationRule}>
    <summary>项目规则</summary>
    <form aria-label="项目规则" onSubmit={save}>
      <label>默认执行器<select value={executorAvailable ? executor : '__unavailable'} onChange={event => setExecutor(event.target.value)}>
        {!executorAvailable && <option value="__unavailable" disabled hidden>当前执行器不可用</option>}
        <option value="">由 Being 按任务选择</option>
        {choices.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
      </select></label>
      <label>默认审核执行器<select value={reviewerAvailable ? reviewer : '__unavailable'} onChange={event => setReviewer(event.target.value)}>
        {!reviewerAvailable && <option value="__unavailable" disabled hidden>当前执行器不可用</option>}
        <option value="">关闭默认审核</option>
        {choices.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
      </select></label>
      {reviewer && <label>默认审核指令<textarea value={instruction} required maxLength={1000} rows={2} onChange={event => setInstruction(event.target.value)} /></label>}
      <p>任务自己的执行器和审核规则优先。默认审核在任务执行成功后自动交接一次。</p>
      <button type="submit" className={styles.primaryButton} disabled={saving || !executorAvailable || !reviewerAvailable}>保存项目规则</button>
      {notice && <p role={notice.error ? 'alert' : 'status'} className={notice.error ? styles.itemError : undefined}>{notice.text}</p>}
    </form>
  </details>;
}

export function WorkAutomation({ item, work, sceneId, kind }: {
  item: WorkItem; work: WorkModel; sceneId: string; kind: 'handoff' | 'wakeup';
}) {
  const rule = item[kind];
  const [executor, setExecutor] = useState(rule?.executor || item.executor);
  const [instruction, setInstruction] = useState(rule?.instruction || '');
  const [trigger, setTrigger] = useState<WorkWakeupTrigger['kind']>(item.wakeup?.kind || 'children_done');
  const [dependency, setDependency] = useState(item.wakeup?.kind === 'task_done' ? item.wakeup.itemId : '');
  const [at, setAt] = useState(() => {
    if (item.wakeup?.kind !== 'at') return '';
    const date = new Date(item.wakeup.at);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choices = work.executorChoices;
  const executorAvailable = !executor || choices.some(agent => agent.id === executor);

  const save = async (enabled: boolean) => {
    setError('');
    setBusy(true);
    const fields = { executor, instruction };
    const value = kind === 'handoff' ? fields : {
      ...fields, kind: trigger, ...(trigger === 'at' ? { at: Date.parse(at) } : trigger === 'task_done' ? { itemId: dependency } : {}),
    };
    try {
      await work.workRequest(`items/${item.id}/automation`, 'POST', { scene_id: sceneId, [kind]: enabled ? value : null });
      await work.refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void save(true); };
  const title = kind === 'handoff' ? '审核交接' : '自动唤醒';
  return <details className={styles.automationRule}>
    <summary>{title}<span>{rule ? stateLabel[rule.status] : '未启用'}</span></summary>
    {rule?.error && <p role="status" className={styles.itemError}>{rule.error}</p>}
    {rule?.runId && <button type="button" onClick={() => work.select(rule.runId!)}>打开本次运行</button>}
    <form onSubmit={submit} aria-label={title}>
      <p>{kind === 'handoff' ? '任务进入待审核时，将当前结果交给指定执行器。' : '待办或阻塞的任务在满足条件时自动启动一次。'}</p>
      {kind === 'wakeup' && <label>触发条件
        <select aria-label="触发条件" value={trigger} onChange={event => setTrigger(event.target.value as WorkWakeupTrigger['kind'])}>
          <option value="children_done">全部子任务完成</option>
          <option value="task_done">指定任务完成</option>
          <option value="at">到达指定时间</option>
        </select>
      </label>}
      {kind === 'wakeup' && trigger === 'task_done' && <label>等待任务
        <select required aria-label="等待任务" value={dependency} onChange={event => setDependency(event.target.value)}>
          <option value="">选择同项目任务</option>
          {work.snapshot?.items?.filter(row => row.id !== item.id && row.projectId === item.projectId).map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
        </select>
      </label>}
      {kind === 'wakeup' && trigger === 'at' && <label>唤醒时间
        <input required type="datetime-local" value={at} onChange={event => setAt(event.target.value)} />
      </label>}
      <label>执行器
        <select aria-label={title + '执行器'} value={executorAvailable ? executor : '__unavailable'} onChange={event => setExecutor(event.target.value)}>
          {!executorAvailable && <option value="__unavailable" disabled hidden>当前执行器不可用</option>}
          <option value="">选择执行器</option>
          {choices.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select>
      </label>
      <label>本轮指令<textarea required maxLength={1000} rows={3} value={instruction} onChange={event => setInstruction(event.target.value)} /></label>
      {error && <p role="alert" className={styles.itemError}>{error}</p>}
      <div className={styles.itemActions}>
        <button type="submit" className={styles.primaryButton} disabled={busy || !sceneId || !item.projectId || !executor || !executorAvailable || rule?.status === 'starting'}>启用一次</button>
        {(rule || (kind === 'handoff' && !item.projectHandoffDisabled && work.projects.find(project => project.id === item.projectId)?.rules?.handoff)) &&
          <button type="button" disabled={busy || !sceneId || rule?.status === 'starting'} onClick={() => void save(false)}>{rule ? '移除规则' : '跳过项目默认审核'}</button>}
      </div>
    </form>
  </details>;
}

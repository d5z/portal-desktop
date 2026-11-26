import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../shared/icons/icon';
import type { WorkGoal, WorkGoalFields } from '../../../shared/work';
import type { WorkProject } from '../../../shared/types';
import type { WorkModel } from '../models/work';
import styles from './work.module.scss';

export function WorkGoalsPanel({ work, projects, addDirectory, discuss, toastError }: {
  work: WorkModel;
  projects: Array<WorkProject & { total: number; completed: number }>;
  addDirectory: (goalId: string) => void;
  discuss: (goal?: WorkGoal) => void;
  toastError: (error: unknown) => void;
}) {
  const goal = work.goal;
  const dialog = useRef<HTMLDialogElement>(null);
  const [editor, setEditor] = useState<{ id: string; fields: WorkGoalFields; version?: number }>();
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const editing = !!editor;
  useEffect(() => {
    if (editing) dialog.current?.showModal();
    else dialog.current?.close();
  }, [editing]);

  const begin = (existing?: WorkGoal) => {
    setEditor(existing ? { id: existing.id, version: existing.version, fields: {
      title: existing.title, outcome: existing.outcome, acceptanceCriteria: existing.acceptanceCriteria, status: existing.status,
    } } : { id: '', fields: { title: '', outcome: '', acceptanceCriteria: [], status: 'active' } });
  };
  const update = (fields: Partial<WorkGoalFields>) => setEditor(current => current && { ...current, fields: { ...current.fields, ...fields } });
  const perform = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await operation(); }
    catch (error) { toastError(error); }
    finally { setBusy(false); }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (editor) void perform(async () => {
      await work.saveGoal(editor.id, editor.fields, editor.version);
      setEditor(undefined);
    });
  };
  const available = work.projects.filter(project => !project.goalId);
  const selectedProject = available.find(project => project.id === projectId);
  const fields = editor?.fields;
  const actions = <div className={styles.goalActions}>
    <button type="button" className={styles.secondaryButton} onClick={() => discuss(goal)}>{goal ? '与 Being 一起看' : '让 Being 建目标'}</button>
    <button type="button" className={styles.primaryButton} aria-haspopup="dialog" onClick={() => begin(goal)}>
      {goal ? '编辑目标' : '新建目标'}
    </button>
  </div>;
  return <section className={`${styles.itemsPanel} ${styles.goalPanel}`} aria-label="Work 目标">
    <div className={styles.goalContent}>
      {!goal && actions}
      {goal ? <>
        <section className={styles.goalOverview} aria-label="目标总览">
          <header className={styles.goalToolbar}>
            <div className={styles.goalMeta}><span>{goal.status === 'done' ? '已完成' : '进行中'}</span><span>目标 v{goal.version}</span></div>
            {actions}
          </header>
          {goal.outcome && <p className={styles.itemDescription}>{goal.outcome}</p>}
          {!!goal.acceptanceCriteria.length && <><h3>验收条件</h3><ul>{goal.acceptanceCriteria.map((value, index) => <li key={index}>{value}</li>)}</ul></>}
          {goal.history.length > 1 && <details className={styles.planHistory}>
            <summary>目标版本记录</summary>
            {goal.history.slice(0, -1).reverse().map(version => <details key={version.version}>
              <summary>v{version.version} · {version.title}</summary>
              {version.outcome && <p className={styles.itemDescription}>{version.outcome}</p>}
              {!!version.acceptanceCriteria.length && <ul>{version.acceptanceCriteria.map((value, index) => <li key={index}>{value}</li>)}</ul>}
            </details>)}
          </details>}
        </section>
        <section className={styles.goalProjects} aria-label="目标下的项目">
          <header><h2>项目</h2><button type="button" disabled={work.addingProject} onClick={() => addDirectory(goal.id)}>
            <Icon name="chat-plus" width="14" height="14" />{work.addingProject ? '正在添加…' : '添加项目目录'}
          </button></header>
          {projects.length ? <ul className={styles.goalRows}>{projects.map(project => <li key={project.id} className={styles.goalProjectRow}>
              <button type="button" className={styles.goalRowTitle} title={project.directory} onClick={() => work.selectProject(project.id)}>
                <Icon name="lucide-folder" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" /><span>{project.name}</span>
              </button>
              <span>{project.total ? `${project.completed} / ${project.total} 项已完成` : '暂无任务或会话'}</span>
              <button type="button" aria-label={`在 ${project.name} 中新建会话`} onClick={() => {
                work.selectProject(project.id);
                work.startNew(project.id);
              }}>新建会话</button>
            </li>)}</ul> : <p className={styles.hint}>这个目标下还没有项目。</p>}
          {!!available.length && <form className={styles.goalAttach} onSubmit={event => {
            event.preventDefault();
            if (selectedProject) void perform(async () => { await work.linkProject(selectedProject.id, goal.id); setProjectId(''); });
          }}>
            <select aria-label="已有项目" value={selectedProject?.id || ''} onChange={event => setProjectId(event.target.value)}>
              <option value="">选择已有项目</option>
              {available.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <button type="submit" disabled={busy || !selectedProject}>关联项目</button>
          </form>}
        </section>
      </> : work.goalId ? <p role="alert" className={styles.itemError}>找不到这个 Work 目标。</p>
        : work.goals.length ? <ul className={styles.goalRows}>{work.goals.map(row => <li key={row.id}>
          <button type="button" className={styles.goalListRow} onClick={() => { setProjectId(''); work.openGoals(row.id); }}>
            <span><strong>{row.title}</strong>{row.outcome && <small>{row.outcome}</small>}</span>
            <span className={styles.goalStatus}>
              {row.status === 'done' ? <Icon name="chat-check" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" />
                : <span className={styles.itemStageMark} aria-hidden="true" />}
              {row.status === 'done' ? '已完成' : '进行中'}
              <Icon className={styles.goalChevron} name="chat-chevron-right" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </span>
          </button>
        </li>)}</ul> : <p className={styles.hint}>还没有目标。可以从长期工作开始，也可以直接添加项目开工。</p>}
    </div>
    <dialog ref={dialog} className={styles.itemDialog} aria-labelledby="work-goal-editor-title"
      onCancel={event => { event.preventDefault(); if (!busy) setEditor(undefined); }}>
      {fields && <form className={`dialog-form ${styles.itemEditor}`} onSubmit={save}>
        <header className="dialog-heading"><h2 id="work-goal-editor-title">{editor.id ? '编辑目标' : '新建目标'}</h2></header>
        <div className={`dialog-body ${styles.itemEditorBody}`}>
          <label>标题<input autoFocus required maxLength={200} value={fields.title} onChange={event => update({ title: event.target.value })} /></label>
          <label>预期结果<textarea rows={3} value={fields.outcome} onChange={event => update({ outcome: event.target.value })} /></label>
          <label>验收条件<textarea rows={3} placeholder="每行一项" value={fields.acceptanceCriteria.join('\n')}
            onChange={event => update({ acceptanceCriteria: event.target.value.split('\n') })} /></label>
          {!!editor.id && <label>状态<select value={fields.status} onChange={event => update({ status: event.target.value as WorkGoalFields['status'] })}>
            <option value="active">进行中</option><option value="done">已完成</option>
          </select></label>}
        </div>
        <footer className="dialog-footer">
          <div className={styles.itemActions}>
            <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => setEditor(undefined)}>取消</button>
            <button type="submit" className={styles.primaryButton} disabled={busy || !fields.title.trim()}>{editor.id ? '保存修改' : '创建目标'}</button>
          </div>
        </footer>
      </form>}
    </dialog>
  </section>;
}

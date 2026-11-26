import { useMemo, useState } from 'react';
import type { WorkModel } from '../models/work';
import type { WorkImportCatalog } from '../../../shared/types';
import { Icon } from '../../shared/icons/icon';
import styles from './work.module.scss';

export function WorkImports({ work, catalog }: { work: WorkModel; catalog: WorkImportCatalog }) {
  const [projectIds, setProjectIds] = useState(() => new Set(catalog.projectIds));
  const [taskIds, setTaskIds] = useState(() => new Set(catalog.taskIds));
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [expanded, setExpanded] = useState<Record<string, number>>({});
  const groups = useMemo(() => {
    const search = query.toLowerCase().trim();
    const tasksByProject = new Map<string, typeof catalog.tasks>();
    for (const task of catalog.tasks) {
      const project = catalog.projects.find(project => project.id === task.projectId || (!task.projectId && project.executor === task.executor && project.directory === task.workdir));
      const key = project?.id || `${task.executor}_unassigned`;
      const tasks = tasksByProject.get(key) || [];
      tasks.push(task); tasksByProject.set(key, tasks);
    }
    return [...catalog.projects, ...catalog.agents.map(agent => ({ id: `${agent.id}_unassigned`, name: '未分配项目', directory: '', executor: agent.id }))]
      .filter(project => source === 'all' || project.executor === source)
      .map(project => ({ ...project, tasks: tasksByProject.get(project.id) || [] }))
      .filter(project => project.directory || project.tasks.length)
      .map(project => ({ ...project, tasks: `${project.name} ${project.directory}`.toLowerCase().includes(search) ? project.tasks : project.tasks.filter(task => (task.brief || '').toLowerCase().includes(search)) }))
      .filter(project => !search || project.tasks.length || `${project.name} ${project.directory}`.toLowerCase().includes(search));
  }, [catalog, query, source]);
  const visibleTasks = groups.flatMap(group => group.tasks);
  const visibleProjects = groups.filter(group => group.directory);
  const selectedCount = catalog.tasks.filter(task => taskIds.has(task.id)).length;
  const removedProjects = catalog.projectIds.filter(id => !projectIds.has(id)).length;
  const removedTasks = catalog.taskIds.filter(id => !taskIds.has(id)).length;
  const removing = removedProjects > 0 || removedTasks > 0;
  const change = (projects: string[], tasks: string[], checked: boolean) => {
    setProjectIds(previous => { const next = new Set(previous); for (const id of projects) { if (checked) next.add(id); else next.delete(id); } return next; });
    setTaskIds(previous => { const next = new Set(previous); for (const id of tasks) { if (checked) next.add(id); else next.delete(id); } return next; });
  };
  const allSelected = [...visibleProjects.map(project => projectIds.has(project.id)), ...visibleTasks.map(task => taskIds.has(task.id))];
  return <section className={styles.importPanel} aria-label="选择导入项目和会话">
    <header className={styles.importHeading}><div><h2>导入项目和会话</h2><p>选择额外同步的历史会话。Work 创建的会话会自动保留。</p></div><button className={styles.secondaryButton} disabled={work.importSaving} onClick={() => { work.importing = false; work.changed(); }}>取消</button></header>
    <div className={styles.importToolbar}>
      <label className={styles.searchField}>
        <Icon name="rail-search" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <input autoFocus type="search" aria-label="搜索导入项目和会话" placeholder="搜索项目、目录或会话" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <select aria-label="导入来源" value={source} onChange={event => setSource(event.target.value)}><option value="all">全部来源</option>{catalog.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
    </div>
    <div className={styles.importGroups}>
      {catalog.agents.filter(agent => !agent.available).map(agent => <div key={agent.id} className={styles.importNotice}><strong>{agent.name}</strong><span>{agent.message || '当前未连接，请连接后重试。'}</span>{agent.capabilities?.connect && <button onClick={() => void work.connectAgent(agent.id)}>连接 {agent.name}</button>}</div>)}
      {work.connectionNotice && <p className={styles.hint} role="status">{work.connectionNotice}</p>}
      {work.importError && <p className={styles.error} role="alert">{work.importError}</p>}
      <div className={styles.importSelectAll}><label><input type="checkbox" aria-label={query || source !== 'all' ? '全选当前结果' : '全选项目和会话'} checked={allSelected.length > 0 && allSelected.every(Boolean)} ref={el => { if (el) el.indeterminate = allSelected.some(Boolean) && !allSelected.every(Boolean); }} onChange={event => change(visibleProjects.map(project => project.id), visibleTasks.map(task => task.id), event.target.checked)} />{query || source !== 'all' ? '全选当前结果' : '全选项目和会话'}</label>
        <button onClick={() => change(
          visibleProjects.filter(project => !catalog.projectIds.includes(project.id)).map(project => project.id),
          visibleTasks.filter(task => !catalog.taskIds.includes(task.id)).map(task => task.id), false,
        )}>取消当前新增选择</button>
      </div>
      {!groups.length && <div className={styles.empty}><h3>{query ? '没有匹配的项目或会话' : '暂无可导入内容'}</h3><p>{query ? '试试其他搜索词。' : '连接 Codex 或 DeepSeek 后，刷新同步清单。'}</p><button onClick={() => void work.openImports()}>刷新清单</button></div>}
      {groups.map(group => {
        const selected = group.tasks.filter(task => taskIds.has(task.id)).length;
        const checked = (!group.directory || projectIds.has(group.id)) && selected === group.tasks.length;
        return <section key={group.id} className={styles.importGroup} aria-label={`${group.executor} ${group.name}`}>
          <label className={styles.importProject}><input type="checkbox" checked={checked} ref={el => { if (el) el.indeterminate = !checked && (selected > 0 || projectIds.has(group.id)); }} onChange={event => change(group.directory ? [group.id] : [], group.tasks.map(task => task.id), event.target.checked)} /><Icon name="lucide-folder" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" /><span><strong>{group.name}</strong><small>{group.directory || group.executor}</small></span><span>{group.executor === 'codex' ? 'Codex' : 'DeepSeek'} · {selected}/{group.tasks.length}</span></label>
          {group.tasks.slice(0, expanded[group.id] || 60).map(task => <label key={task.id} className={styles.importTask}><input type="checkbox" checked={taskIds.has(task.id)} onChange={event => change(event.target.checked && group.directory ? [group.id] : [], [task.id], event.target.checked)} /><span title={task.brief}>{task.brief || '未命名会话'}</span><time>{new Date(task.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</time></label>)}
          {group.tasks.length > (expanded[group.id] || 60) && <button className={styles.showMore} onClick={() => setExpanded(current => ({ ...current, [group.id]: (current[group.id] || 60) + 60 }))}>显示更多会话（还有 {group.tasks.length - (expanded[group.id] || 60)} 个）</button>}
          {!group.tasks.length && <p className={styles.projectEmpty}>项目中暂无会话</p>}
        </section>;
      })}
    </div>
    <footer className={styles.importFooter}>
      <span aria-live="polite">{removing ? `将从 Work 移出 ${removedProjects} 个项目、${removedTasks} 个会话`
        : `已选择 ${catalog.projects.filter(project => projectIds.has(project.id)).length} 个项目、${selectedCount} 个会话`}</span>
      <button className={styles.primaryButton} disabled={work.importSaving} onClick={() => void work.saveImports({ projectIds: [...projectIds], taskIds: [...taskIds] })}>
        {work.importSaving ? '正在同步…' : removing ? '同步并移出' : '同步所选内容'}
      </button>
    </footer>
  </section>;
}

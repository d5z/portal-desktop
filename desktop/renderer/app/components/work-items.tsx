import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type FormEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragMoveEvent } from '@dnd-kit/core';
import { workPriorities, workStages, type WorkItem, type WorkItemFields, type WorkPlanFields, type WorkResult, type WorkResultPage, type WorkStage } from '../../../shared/work';
import { workActive, workStatus, type WorkModel } from '../models/work';
import { Icon } from '../../shared/icons/icon';
import { IconButton } from '../../shared/components/icon-button';
import { LocalFileDirectory, LocalFileLink } from '../../shared/components/local-file-link';
import { ChatMessageMarkdown } from '../../shared/components/markdown';
import type { PlaceTarget } from '../../shared/lib/navigation';
import { cleanContent } from '../../shared/lib/clean-content';
import { WorkspaceDrawer } from '../../shared/components/workspace-drawer';
import { WorkAutomation, WorkProjectAutomation } from './work-automation';
import { WorkExecutorMark } from './work-executor-mark';
import { WorkModelPicker } from './work-model-picker';
import styles from './work.module.scss';

const stages = Object.keys(workStages) as WorkStage[];
const priorities = Object.keys(workPriorities) as WorkItemFields['priority'][];
const date = (value: number) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const cardFields = { project: '项目', executor: '执行器', priority: '优先级', due: '截止日期', labels: '标签', children: '子任务进度' } as const;
type CardField = keyof typeof cardFields;
type WorkView = { mode: 'board' | 'table' | 'swimlane'; executor: string; stage: string; sort: 'recent' | 'priority' | 'due' | 'manual'; group?: 'project' | 'executor' | 'priority'; hidden?: WorkStage[]; fields?: CardField[] };
const defaultView: WorkView = { mode: 'board', executor: '', stage: '', sort: 'manual' };
type DropPosition = { stage: WorkStage; before?: string; lane?: string };
type BoardTarget = { stage: WorkStage; lane: string; itemId?: string };
const arranging = (item: WorkItem) => item.launches?.at(-1)?.status === 'starting' || (!!item.dispatch && !item.dispatch.error && item.dispatch.expiresAt > Date.now());
const dispatchStatus = (item: WorkItem) => item.launches?.at(-1)?.status === 'starting' ? '正在等待执行器启动'
  : item.launches?.at(-1)?.status === 'unconfirmed' ? '启动回执尚未确认，请先核对已有运行'
  : item.dispatch?.error || (item.dispatch
  ? arranging(item) ? item.dispatch.queued ? 'Being 正在安排' : '正在确认接管请求' : '接管请求已过期，可重新准备安排'
  : item.stage === 'in_progress' && !item.runIds.length ? '尚未启动运行' : '');

const boardCollision: CollisionDetection = args => {
  const candidates = args.droppableContainers.filter(entry => entry.data.current?.lane === args.active.data.current?.lane);
  const matches = pointerWithin({ ...args, droppableContainers: candidates });
  const cards = matches.filter(match => String(match.id).startsWith('card:') && match.id !== args.active.id);
  return cards.length ? cards : matches.filter(match => String(match.id).startsWith('column:'));
};

function WorkBoardColumn({ stage, lane, active, children }: { stage: WorkStage; lane: string; active: boolean; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: `column:${lane}:${stage}`, data: { stage, lane } satisfies BoardTarget });
  return <section ref={setNodeRef} aria-label={workStages[stage]} data-stage={stage} data-drop-active={active}>{children}</section>;
}

type TaskMenuProps = Pick<ComponentProps<'button'>, 'onContextMenu' | 'onKeyDown' | 'aria-haspopup' | 'aria-keyshortcuts'>;

function WorkPlanContent({ plan }: { plan: WorkPlanFields }) {
  if (!plan.goal && !plan.specification && !plan.acceptanceCriteria?.length)
    return <p className={styles.hint}>尚未填写规格和验收标准。</p>;
  return <dl className={styles.planContent}>
    {plan.goal && <div><dt>任务目标</dt><dd>{plan.goal}</dd></div>}
    {plan.specification && <div><dt>规格</dt><dd>{plan.specification}</dd></div>}
    {!!plan.acceptanceCriteria?.length && <div><dt>验收标准</dt><dd>
      <ul>{plan.acceptanceCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul>
    </dd></div>}
  </dl>;
}

function WorkBoardCard({ item, lane, disabled, before, open, menu, children }: {
  item: WorkItem; lane: string; disabled: boolean; before: boolean; open: () => void; children: ReactNode;
  menu: TaskMenuProps;
}) {
  const id = `card:${item.id}`;
  const data = { stage: item.stage, lane, itemId: item.id } satisfies BoardTarget;
  const drag = useDraggable({ id, data, disabled });
  const target = useDroppable({ id, data });
  const { setNodeRef: setDraggable } = drag;
  const { setNodeRef: setDroppable } = target;
  const setRef = useCallback((node: HTMLElement | null) => { setDraggable(node); setDroppable(node); }, [setDraggable, setDroppable]);
  return <button ref={setRef} {...drag.listeners} {...menu} type="button" data-work-card={item.id} data-dragging={drag.isDragging} data-drop-before={before}
    className={styles.itemCard} onClick={open}>{children}</button>;
}

export function WorkItemsPanel({ work, sceneId, openArtifact, shareStatus, beingAction, inConversation, showDetails, closeDetails, onPlace, sendResult, taskMenuProps, openProjectTask }: {
  work: WorkModel; sceneId: string; openArtifact: (url: string) => void;
  shareStatus: (item: WorkItem) => void;
  beingAction?: { label: string; open: () => Promise<void> };
  inConversation: boolean; showDetails: boolean; closeDetails: () => void;
  onPlace: (target: PlaceTarget) => void;
  sendResult: (result: WorkResult, title: string) => Promise<unknown>;
  taskMenuProps: (item: WorkItem) => TaskMenuProps;
  openProjectTask: (item: WorkItem) => void;
}) {
  const items = work.snapshot?.items || [];
  const item = work.item;
  const editor = work.itemEditor;
  const editing = editor?.fields;
  const editorOpen = !!editor;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [created, setCreated] = useState<WorkItem>();
  const query = work.query;
  const project = work.projectId;
  const [checked, setChecked] = useState<string[]>([]);
  const [batch, setBatch] = useState<WorkStage>('todo');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  const [launchCheck, setLaunchCheck] = useState<{ itemId: string; text: string }>();
  const activeDrag = useRef('');
  const [draggedId, setDraggedId] = useState('');
  const [dropPosition, setDropPosition] = useState<DropPosition>();
  const [pendingMove, setPendingMove] = useState<(DropPosition & { id: string })>();
  const pan = useRef<{ pointer: number; x: number; scroll: number } | undefined>(undefined);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  useEffect(() => {
    const dialog = dialogRef.current;
    if (editorOpen) dialog?.showModal();
    else dialog?.close();
  }, [editorOpen]);
  const closeEditor = () => {
    work.itemEditor = undefined;
    setError('');
    work.changed();
  };
  const preferenceKey = 'town-work-views:' + work.endpoint;
  const [views, setViews] = useState<{ name: string; view: WorkView; project: string; query: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem(preferenceKey) || '[]'); } catch { return []; }
  });
  const [view, setView] = useState(defaultView);
  const [viewName, setViewName] = useState('');
  const projectRule = work.project?.id.startsWith('proj_') ? work.project : undefined;
  const threads = work.threads;
  const runs = item?.runIds.map(id => ({ id, task: threads.find(thread => thread.id === id)?.tasks.at(-1) }));
  const [earlierResults, setEarlierResults] = useState<WorkResultPage>();
  const [expandedResult, setExpandedResult] = useState('');
  const resultPage = work.snapshot?.results;
  const resultItems = [...new Map([...(earlierResults?.entries || []), ...(resultPage?.entries || [])].map(row => [row.id, row])).values()];
  const moreResults = earlierResults ? earlierResults.next : resultPage?.next;
  const itemProject = item && work.projects.find(project => project.id === item.projectId);
  const itemGoal = work.goalForProject(item?.projectId);
  const childItems = item ? items.filter(row => row.parentId === item.id) : [];
  const launchNotice = item && dispatchStatus(item);
  const editingGoal = work.goalForProject(editing?.projectId);
  const editingProject = work.projects.find(project => project.id === editing?.projectId);
  const preparingExecution = !!editor?.startAfterSave;
  const canPrepareExecution = (fields: WorkItemFields) => {
    const project = work.projects.find(row => row.id === fields.projectId);
    return !!project && !!(fields.executor || project.rules?.executor);
  };
  const ready = item && work.agents.some(agent => agent.id === (item.executor || itemProject?.rules?.executor) && agent.available && agent.canExecute !== false);
  const showDirectStart = item && (item.stage === 'todo' || item.stage === 'blocked' || (item.stage === 'in_progress' && !item.runIds.length));
  const canStart = showDirectStart && !busy && !arranging(item) && item.launches?.at(-1)?.status !== 'unconfirmed' &&
    sceneId && itemProject && !runs?.some(row => row.task && workActive(row.task));
  const liveRuns = new Map(threads.filter(thread => workActive(thread.tasks.at(-1)!)).map(thread => [thread.id, thread.tasks.at(-1)!]));
  const timeline: { key: string; at: number; text: string; result?: WorkResult }[] = item ? [
    { key: 'created', at: item.createdAt, text: '创建任务' },
    ...(item.stageHistory || []).map((entry, idx) => ({ key: `stage-${idx}`, at: entry.at, text: `${workStages[entry.from]} → ${workStages[entry.to]}` })),
    ...item.notes.map((entry, idx) => ({ key: `note-${idx}`, at: entry.at, text: entry.text })),
    ...resultItems.filter(result => item.runIds.includes(result.taskId) || runs?.some(run => threads.find(thread => thread.id === run.id)?.tasks.some(task => task.id === result.taskId)))
      .map(result => ({ key: result.id, at: result.at, text: result.summary || workStatus[result.status], result })),
  ].sort((a, b) => a.at - b.at) : [];
  const rows = useMemo(() => {
    const moved = pendingMove && items.find(row => row.id === pendingMove.id);
    const displayed = moved ? items.filter(row => row.id !== moved.id) : items;
    if (moved && pendingMove) {
      const before = displayed.findIndex(row => row.id === pendingMove.before);
      displayed.splice(before < 0 ? displayed.length : before, 0, { ...moved, stage: pendingMove.stage, updatedAt: Date.now() });
    }
    const search = query.trim().toLowerCase();
    return displayed.filter(row =>
      (!project || (row.projectId || 'unassigned') === project) && (!view.executor || row.executor === view.executor) &&
      (!view.stage || row.stage === view.stage) &&
      [row.title, row.description, ...row.labels].some(value => value.toLowerCase().includes(search))
    ).sort((a, b) => {
      if (view.sort === 'priority') return priorities.indexOf(b.priority) - priorities.indexOf(a.priority) || b.updatedAt - a.updatedAt;
      if (view.sort === 'due') return (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || b.updatedAt - a.updatedAt;
      return view.sort === 'manual' ? 0 : b.updatedAt - a.updatedAt;
    });
  }, [items, pendingMove, project, query, view]);
  const rowSelection = rows.filter(row => checked.includes(row.id)).map(row => row.id);

  async function perform(operation: () => Promise<unknown>) {
    if (busy) return;
    setError('');
    setBusy(true);
    try { await operation(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  const openItem = (row: WorkItem, preferConversation = false) => {
    setNote('');
    setLink('');
    setError('');
    if (preferConversation && row.projectId) openProjectTask(row);
    else work.select(row.id);
  };
  const update = (fields: Partial<WorkItemFields>) => {
    work.itemEditor = { ...editor!, fields: { ...editing!, ...fields } };
    work.changed();
  };
  const start = async (target: WorkItem) => {
    const launch = target.launches?.at(-1);
    const requestId = launch?.status === 'starting' || launch?.status === 'unconfirmed'
      ? launch.id : target.runIds.length ? crypto.randomUUID() : undefined;
    try {
      await work.workRequest(`items/${target.id}/runs`, 'POST', {
        scene_id: sceneId, request_id: requestId,
      });
    } finally {
      await work.refresh();
    }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!editor || !editing || (preparingExecution && !canPrepareExecution(editing))) return;
    const endpoint = work.endpoint;
    void perform(async () => {
      const saved = await work.saveItem(editor.id, editing, editor.expectedVersion, preparingExecution ? 'todo' : undefined);
      if (!editor.id) setCreated(saved);
      if (preparingExecution && endpoint === work.endpoint) await start(saved);
    });
  };
  const add = (event: FormEvent, action: 'notes' | 'artifacts') => {
    event.preventDefault();
    void perform(async () => {
      await work.workRequest(`items/${item!.id}/${action}`, 'POST', { value: action === 'notes' ? note : link });
      if (action === 'notes') setNote('');
      else setLink('');
      await work.refresh();
    });
  };
  const markResultRead = async ({ id, read }: WorkResult) => {
    if (!read) {
      await work.workRequest('results/read', 'POST', { id });
      setEarlierResults(page => page && { ...page, entries: page.entries.map(entry => entry.id === id ? { ...entry, read: true } : entry) });
    }
  };
  const openResult = (result: WorkResult) => void perform(async () => {
    await markResultRead(result);
    work.select(result.taskId, result.id);
    await work.refresh();
  });
  const groupKey = view.group === 'executor' ? 'executor' : view.group === 'priority' ? 'priority' : 'projectId';
  const clearDrag = () => { activeDrag.current = ''; setDraggedId(''); setDropPosition(undefined); };
  const getDropPosition = (target: BoardTarget, below: boolean, sourceId: string): DropPosition => {
    const position: DropPosition = { stage: target.stage, lane: target.lane };
    if (view.sort === 'manual' && target.itemId) {
      const index = rows.findIndex(row => row.id === target.itemId);
      position.before = below ? rows.slice(index + 1).find(row =>
        row.stage === target.stage && row.id !== sourceId && (view.mode !== 'swimlane' || row[groupKey] === target.lane))?.id : target.itemId;
    }
    return position;
  };
  const dragOver = ({ active, over }: DragMoveEvent) => {
    const target = over?.data.current as BoardTarget | undefined;
    const rect = active.rect.current.translated;
    const position = target && over ? getDropPosition(target, !!rect && rect.top + rect.height / 2 > over.rect.top + over.rect.height / 2, activeDrag.current) : undefined;
    setDropPosition(current => current?.stage === position?.stage && current?.before === position?.before && current?.lane === position?.lane ? current : position);
  };
  const drop = (event: PointerEvent<HTMLDivElement>, lane: string) => {
    if (!activeDrag.current) return;
    const source = rows.find(row => row.id === activeDrag.current);
    clearDrag();
    if (!source || (view.mode === 'swimlane' && source[groupKey] !== lane)) return;
    // A quick mouse release can arrive before the drag library updates its collision target.
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const column = hit?.closest<HTMLElement>('[data-stage]');
    if (column?.parentElement !== event.currentTarget) return;
    const card = hit?.closest<HTMLElement>('[data-work-card]');
    const itemId = card?.dataset.workCard;
    if (itemId === source.id) return;
    const bounds = card?.getBoundingClientRect();
    const position = getDropPosition({ stage: column.dataset.stage as WorkStage, lane, itemId }, !!bounds && event.clientY > bounds.top + bounds.height / 2, source.id);
    if (source.stage === position.stage && view.sort !== 'manual') return;
    if (source.stage === 'todo' && position.stage === 'in_progress') {
      if (canPrepareExecution(source)) void perform(() => start(source));
      else {
        setError('');
        work.itemEditor = { id: source.id, fields: source, expectedVersion: source.planHistory?.at(-1)?.version || 1, startAfterSave: true };
        work.changed();
      }
      return;
    }
    void perform(async () => {
      setPendingMove({ id: source.id, ...position });
      try {
        if (view.sort === 'manual') {
          await work.workRequest('items/order', 'POST', { id: source.id, stage: position.stage, before: position.before || '' });
          await work.refresh();
        } else await work.moveItems([source.id], position.stage);
      } finally { setPendingMove(undefined); }
    });
  };
  const visibleFields = view.fields || (Object.keys(cardFields) as CardField[]);
  const activeCard = rows.find(row => row.id === draggedId);
  const renderBoard = (cards: WorkItem[], lane = '', defaults: Partial<WorkItemFields> = {}) => <div className={styles.itemsBoard} role="group" aria-label="任务状态看板"
    onPointerUpCapture={event => drop(event, lane)}
    onPointerDown={event => {
      activeDrag.current = '';
      if (event.button !== 0 || (event.target as HTMLElement).closest('button') || event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
      pan.current = { pointer: event.pointerId, x: event.clientX, scroll: event.currentTarget.scrollLeft };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => {
      const start = pan.current;
      if (start?.pointer === event.pointerId) event.currentTarget.scrollLeft = start.scroll + start.x - event.clientX;
    }} onLostPointerCapture={() => { pan.current = undefined; }}>
    {stages.filter(stage => view.stage ? stage === view.stage : !(view.hidden || ['cancelled']).includes(stage)).map(stage => {
      const column = cards.filter(row => row.stage === stage);
      const active = dropPosition?.stage === stage && dropPosition.lane === lane;
      return <WorkBoardColumn key={stage} stage={stage} lane={lane} active={active}>
        <header><span className={styles.itemStageMark} aria-hidden="true" /><h3>{workStages[stage]} <span>{column.length}</span></h3>
          <IconButton label={`在「${workStages[stage]}」新建任务`} aria-haspopup="dialog" onClick={() => work.createItem({ stage, ...defaults })}>
            <Icon name="chat-plus" width="16" height="16" />
          </IconButton>
        </header>
        {column.map(row => {
          const children = visibleFields.includes('children') ? items.filter(candidate => candidate.parentId === row.id) : [];
          const run = row.runIds.map(id => liveRuns.get(id)).find(Boolean);
          return <WorkBoardCard key={row.id} item={row} lane={lane} disabled={busy} before={active && dropPosition?.before === row.id} open={() => openItem(row, true)} menu={taskMenuProps(row)}>
            <strong className={styles.executorTitle}>{visibleFields.includes('executor') && <WorkExecutorMark executor={row.executor} />}<span>{row.title}</span></strong>
            {run && <span className={styles.activeRun}>{workStatus[run.status]}</span>}
            {dispatchStatus(row) && <span className={row.dispatch?.error ? styles.itemError : undefined}>{dispatchStatus(row)}</span>}
            <span>{[
              visibleFields.includes('project') && work.projects.find(project => project.id === row.projectId)?.name,
              visibleFields.includes('priority') && row.priority !== 'none' && workPriorities[row.priority] + '优先级',
              visibleFields.includes('due') && row.dueDate,
              ...(visibleFields.includes('labels') ? row.labels : []),
              children.length && `子任务 ${children.filter(child => child.stage === 'done').length}/${children.length}`,
            ].filter(Boolean).join(' · ')}</span>
          </WorkBoardCard>;
        })}
        {!column.length && <p className={styles.columnEmpty}>暂无任务</p>}
        {active && !dropPosition?.before && <div className={styles.itemDropLine} />}
      </WorkBoardColumn>;
    })}
  </div>;

  const content = <>
    {error && !editorOpen && <p role="alert" className={styles.itemError}>{error}</p>}
    {work.panel === 'results' ? <div className={styles.resultInbox}>
      {!resultItems.length && <p className={styles.hint}>暂无新的完成或失败结果。</p>}
      {[...resultItems].sort((a, b) => b.at - a.at).map(result => {
        const title = items.find(row => row.runIds.includes(result.taskId))?.title || result.title.split('\n')[0];
        const expanded = expandedResult === result.id;
        const summary = expanded ? cleanContent(result.summary) : '';
        const detailsId = 'work-result-' + result.id;
        return <article className={styles.inboxResult} key={result.id} data-expanded={expanded}>
          <button className={styles.resultTitle} type="button" data-unread={!result.read} title={title}
            aria-expanded={expanded} aria-controls={detailsId} onClick={() => {
              setExpandedResult(expanded ? '' : result.id);
              if (!expanded && !result.read) void markResultRead(result).then(() => work.refresh()).catch(error => setError((error as Error).message));
            }}>
            <WorkExecutorMark executor={result.executor} />
            <span className={styles.resultName}>
              <span className={styles.resultText}>{!result.read && <span className={styles.srOnly}>未读 · </span>}{title}</span>
              <span className={styles.resultMeta}>
                <span>{workStatus[result.status]}</span>
                <time dateTime={new Date(result.at).toISOString()}>{date(result.at)}</time>
              </span>
            </span>
            <Icon className={styles.resultChevron} name={expanded ? 'chat-chevron-down' : 'chat-chevron-right'} width="14" height="14" />
          </button>
          <div id={detailsId} className={styles.resultPreview} hidden={!expanded}>
            {expanded && <>
              <div className={styles.resultActions}>
                <button type="button" disabled={busy} onClick={() => openResult(result)}>打开执行会话</button>
                <button className={styles.sendResult} type="button" disabled={busy} title="将结果填入 Being 对话，确认后发送"
                  onClick={() => void perform(() => sendResult(result, title))}>
                  <Icon name="rail-chat" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" />与 Being 一起看
                </button>
              </div>
              {summary ? <LocalFileDirectory.Provider value={work.snapshot?.tasks.find(task => task.id === result.taskId)?.workdir}>
                <ChatMessageMarkdown content={summary} className={styles.resultBody} onPlace={onPlace} />
              </LocalFileDirectory.Provider> : <p className={styles.hint}>这次执行没有结果正文。</p>}
            </>}
          </div>
        </article>;
      })}
      {moreResults && <button className={styles.moreResults} type="button" disabled={busy} onClick={() => void perform(async () => {
        const page = await work.workRequest<WorkResultPage>('results?before=' + encodeURIComponent(moreResults));
        setEarlierResults(previous => ({ ...page, entries: [...(previous?.entries || []), ...page.entries] }));
      })}>加载更早的结果</button>}
    </div> : <>
      {!item && <div className={styles.itemsOverview}>

        {created && <div className={styles.itemReceipt} role="status"><span>已创建「{created.title}」</span>
          <button type="button" onClick={() => { openItem(created); setCreated(undefined); }}>查看任务</button>
          <IconButton label="关闭创建提示" onClick={() => setCreated(undefined)}><Icon name="chat-close" width="14" height="14" /></IconButton>
        </div>}
        {work.itemId && !item && !work.loading && <p role="alert" className={styles.itemError}>此任务不存在或属于其他 Being。</p>}
        <div className={styles.boardToolbar}>
          <label className={styles.boardSearch}>
            <Icon name="rail-search" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <input type="search" aria-label="搜索任务" placeholder="搜索任务" value={query} onChange={event => { work.query = event.target.value; work.changed(); }} />
          </label>
          <IconButton label="筛选与排序" className={styles.filterTrigger} popoverTarget="work-board-filters" aria-haspopup="dialog">
            <Icon name="menu-settings" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <span>筛选</span>{(project || view.executor || view.stage || view.sort !== 'manual') && <span className={styles.filterDot} />}
          </IconButton>
          <select aria-label="任务视图" value={view.mode} onChange={event => setView({ ...view, mode: event.target.value as WorkView['mode'] })}><option value="board">看板</option><option value="table">表格</option><option value="swimlane">泳道</option></select>
          <div id="work-board-filters" className={styles.boardPopover} popover="auto" role="dialog" aria-label="筛选与排序">
            <label>项目<select aria-label="筛选项目" value={project} onChange={event => { work.projectId = event.target.value; work.changed(); }}><option value="">全部项目</option><option value="unassigned">未分配项目</option>{work.projects.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
            <label>执行器<select aria-label="筛选执行器" value={view.executor} onChange={event => setView({ ...view, executor: event.target.value })}><option value="">全部执行器</option>{work.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
            <label>状态<select aria-label="筛选状态" value={view.stage} onChange={event => setView({ ...view, stage: event.target.value })}><option value="">全部状态</option>{stages.map(stage => <option key={stage} value={stage}>{workStages[stage]}</option>)}</select></label>
            <label>排序<select aria-label="排序" value={view.sort} onChange={event => setView({ ...view, sort: event.target.value as WorkView['sort'] })}><option value="recent">最近更新</option><option value="priority">优先级</option><option value="due">截止日期</option><option value="manual">手动排序</option></select></label>
          </div>
          <IconButton label="视图设置" className={styles.viewTrigger} popoverTarget="work-board-display" aria-haspopup="dialog"><Icon name="chat-more" width="17" height="17" /></IconButton>
          <div id="work-board-display" className={styles.boardPopover} popover="auto" role="dialog" aria-label="视图设置">
            {view.mode !== 'table' && <details className={styles.savedWorkViews}>
              <summary>看板显示</summary>
              {view.mode === 'swimlane' && <label>泳道分组<select value={view.group || 'project'} onChange={event => setView({ ...view, group: event.target.value as WorkView['group'] })}>
                  <option value="project">项目</option><option value="executor">执行器</option><option value="priority">优先级</option>
                </select></label>}
              <fieldset className={styles.boardChoices}><legend>显示列</legend>{stages.map(stage => {
                const hidden = view.hidden || ['cancelled'];
                return <label key={stage}><input type="checkbox" checked={!hidden.includes(stage)} onChange={event => setView({ ...view,
                  hidden: event.target.checked ? hidden.filter(value => value !== stage) : [...hidden, stage],
                })} />{workStages[stage]}</label>;
              })}</fieldset>
              <fieldset className={styles.boardChoices}><legend>卡片字段</legend>{(Object.keys(cardFields) as CardField[]).map(field => <label key={field}>
                <input type="checkbox" checked={visibleFields.includes(field)} onChange={event => setView({ ...view,
                  fields: event.target.checked ? [...visibleFields, field] : visibleFields.filter(value => value !== field),
                })} />{cardFields[field]}
              </label>)}</fieldset>
            </details>}
            <details className={styles.savedWorkViews}><summary>保存的视图</summary>
              <div className={styles.itemActions}>
                {views.map(saved => <button key={saved.name} type="button" onClick={event => {
                  setView(saved.view); work.projectId = saved.project; work.query = saved.query; work.changed();
                  event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover();
                }}>{saved.name}</button>)}
                <input aria-label="视图名称" value={viewName} maxLength={40} placeholder="视图名称" onChange={event => setViewName(event.target.value)} />
                <button type="button" disabled={!viewName.trim()} onClick={() => {
                  const name = viewName.trim();
                  const next = [...views.filter(saved => saved.name !== name), { name, view, project, query }];
                  localStorage.setItem(preferenceKey, JSON.stringify(next));
                  setViews(next);
                  setViewName('');
                }}>保存当前视图</button>
              </div>
            </details>
            {projectRule && <WorkProjectAutomation key={projectRule.id} project={projectRule} work={work} />}
          </div>
        </div>
        {view.mode !== 'table' ? <DndContext sensors={sensors} collisionDetection={boardCollision} onDragStart={event => {
          activeDrag.current = String(event.active.data.current?.itemId || '');
          setDraggedId(activeDrag.current);
        }} onDragMove={dragOver} onDragOver={dragOver} onDragEnd={clearDrag} onDragCancel={clearDrag}>
          {view.mode === 'board' ? renderBoard(rows) : !rows.length ? <p className={styles.hint}>暂无符合条件的任务。</p> :
            [...new Set(rows.map(row => row[groupKey]))].map(id => <section className={styles.swimlane} key={id}>
              <h3>{groupKey === 'executor' ? work.agents.find(agent => agent.id === id)?.name || '未分配执行器' : groupKey === 'priority'
                ? workPriorities[id as keyof typeof workPriorities] : work.projects.find(row => row.id === id)?.name || '未分配项目'}</h3>
              {renderBoard(rows.filter(row => row[groupKey] === id), id, { [groupKey]: id })}
            </section>)}
          {createPortal(<DragOverlay dropAnimation={null} style={{ pointerEvents: 'none' }}>{activeCard && <div className={styles.dragPreview}>{activeCard.title}</div>}</DragOverlay>, document.body)}
        </DndContext> : !rows.length ? <p className={styles.hint}>暂无符合条件的任务。</p> : <>
            {rowSelection.length > 0 && <div className={styles.itemActions}><span>已选 {rowSelection.length} 项</span>
              <select aria-label="批量状态" value={batch} onChange={event => setBatch(event.target.value as WorkStage)}>{stages.map(stage => <option key={stage} value={stage}>{workStages[stage]}</option>)}</select>
              <button type="button" disabled={busy} onClick={() => void perform(async () => { await work.moveItems(rowSelection, batch); setChecked([]); })}>批量更新</button></div>}
            <div className={styles.itemsTable}><table><thead><tr><th><input type="checkbox" aria-label="全选当前任务" checked={rowSelection.length === rows.length} onChange={event => setChecked(event.target.checked ? rows.map(row => row.id) : [])} /></th>
              <th>标题</th><th>状态</th><th>优先级</th><th>截止日期</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}>
                <td><input type="checkbox" aria-label={`选择 ${row.title}`} checked={checked.includes(row.id)} onChange={event => setChecked(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id))} /></td>
                <td><button type="button" {...taskMenuProps(row)} onClick={() => openItem(row, true)}><span className={styles.executorTitle}><WorkExecutorMark executor={row.executor} /><span>{row.title}</span></span></button></td><td>{workStages[row.stage]}</td><td>{workPriorities[row.priority]}</td><td>{row.dueDate || '—'}</td>
              </tr>)}</tbody></table></div>
          </>}
      </div>}
      {item && <div id="work-item-details" className={styles.itemDetail} role="region" aria-label="任务详情">
        <header className={styles.itemDetailHeader}>
          <div>
            <h2>{item.title}</h2>
            {item.description && <p className={styles.itemDescription}>{item.description}</p>}
          </div>
          <div className={styles.itemHeaderActions}>
            <IconButton label="编辑任务" disabled={busy} onClick={() => {
              setError(''); work.itemEditor = { id: item.id, fields: item, expectedVersion: item.planHistory?.at(-1)?.version || 1 }; work.changed();
            }}><Icon name="chat-edit" width="16" height="16" strokeWidth="1.5" /></IconButton>
            {inConversation && <IconButton label="关闭任务详情" onClick={() => { closeDetails(); setError(''); }}><Icon name="chat-close" width="16" height="16" /></IconButton>}
          </div>
        </header>
        <div className={styles.itemDetailToolbar} role="group" aria-label="任务操作">
          <label className={styles.itemStageControl} data-stage={item.stage}>
            <span className={styles.itemStageMark} aria-hidden="true" />
            <select aria-label="任务状态" value={item.stage} disabled={busy} onChange={event => {
              const stage = event.target.value as WorkStage;
              void perform(() => work.moveItems([item.id], stage));
            }}>{stages.map(stage => <option key={stage} value={stage}>{workStages[stage]}</option>)}</select>
          </label>
          <div className={styles.itemDetailActions}>
            {beingAction && <button className={styles.beingTaskAction} type="button" disabled={busy} title="加入 Being 对话草稿" onClick={() => void perform(beingAction.open)}>{beingAction.label}</button>}
            {showDirectStart && <button type="button" disabled={!canStart || !ready} onClick={() => void perform(() => start(item))}>
              {item.runIds.length ? '重新执行' : '开始执行'}
            </button>}
            <button className={styles.shareStatus} type="button" onClick={() => shareStatus(item)}>
              <Icon name="rail-mail" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" />分享状态给其他 Being
            </button>
          </div>
        </div>
        {(launchNotice || launchCheck?.itemId === item.id) && <div className={styles.itemRunNotice}>
          {launchNotice && <p role="status">{launchNotice}</p>}
          {['starting', 'unconfirmed'].includes(item.launches?.at(-1)?.status || '') && <button type="button" disabled={busy} onClick={() => void perform(async () => {
            const reply = await work.workRequest<{ status: string }>(`items/${item.id}/dispatch`);
            setLaunchCheck({ itemId: item.id, text: reply.status === 'started' ? '已找到原执行会话。' : reply.status === 'starting' ? '原派发正在启动。'
              : reply.status === 'failed' ? '已确认原派发未启动，可以重试。' : '暂未查到原执行会话。' });
            await work.refresh();
          })}>查询原派发</button>}
          {launchCheck?.itemId === item.id && <p role="status">{launchCheck.text}</p>}
        </div>}
        <div className={styles.itemDetailLayout}>
          <div className={styles.itemDetailMain}>
            {!!item.executions?.length && <section className={styles.itemPlan} aria-label="执行与交付版本">
              <header><h3>执行与交付版本</h3>{item.acceptedDeliveryVersion && <span>已验收 v{item.acceptedDeliveryVersion}</span>}</header>
              <ol className={styles.deliveryHistory}>{item.executions.slice().reverse().map(run => <li key={run.resultId}>
                <div className={styles.deliveryHeading}>
                  <div>
                    <strong>{run.deliveryVersion ? `交付 v${run.deliveryVersion}` : workStatus[run.status]}</strong>
                    <span>{[run.goalRevision && `目标 v${run.goalRevision.version}`, run.planVersion && `要求 v${run.planVersion}`, run.deliveryVersion && workStatus[run.status], date(run.at)].filter(Boolean).join(' · ')}</span>
                  </div>
                  <button type="button" disabled={!threads.some(thread => thread.id === run.taskId || thread.tasks.some(task => task.id === run.taskId))}
                    onClick={() => work.select(run.taskId, run.resultId)}>查看执行</button>
                </div>
                {run.files?.length ? <ul>{run.files.map(file => <li key={file.source} title={`SHA-256 ${file.sha256}`}>
                  <LocalFileLink path={file.path}>{file.name}</LocalFileLink>
                </li>)}</ul> : <p className={styles.hint}>本轮没有归档文件。</p>}
              </li>)}</ol>
            </section>}
            <section className={styles.itemPlan} aria-label="任务总览">
              <header><h3>任务总览</h3><span>要求 v{item.planHistory?.at(-1)?.version || 1}</span></header>
              <WorkPlanContent plan={item} />
              {(item.planHistory?.length || 0) > 1 && <details className={styles.planHistory}>
                <summary>要求版本记录</summary>
                {item.planHistory!.slice().reverse().map(version => <details key={version.version}>
                  <summary>v{version.version} · {version.source === 'being' ? 'Being' : '用户'} · {date(version.at)}</summary>
                  {version.title !== item.title && <strong>{version.title}</strong>}
                  {version.description && version.description !== item.description && <p className={styles.itemDescription}>{version.description}</p>}
                  <WorkPlanContent plan={version} />
                </details>)}
              </details>}
            </section>
            {runs && (!inConversation || runs.length > 1) && <section className={styles.itemPlan} aria-label="执行会话">
              <header><h3>执行会话</h3></header>
              {runs.length ? runs.map(({ id, task }) => <div className={styles.resultRow} key={id}>
                <button type="button" disabled={!task} aria-current={inConversation && work.selected?.id === id ? 'true' : undefined} onClick={() => work.select(id)}>
                  {task ? <span className={styles.executorTitle}><WorkExecutorMark executor={task.executor || 'internal'} showName /> 打开执行会话</span> : '等待同步'}
                </button>
                {task && <span>{workStatus[task.status]} · {date(task.createdAt)}</span>}
              </div>) : <p className={styles.hint}>尚未启动运行。</p>}
            </section>}
            {!!childItems.length && <section className={styles.itemPlan} aria-label="子任务">
              <header><h3>子任务</h3></header>
              {childItems.map(row => <div className={styles.resultRow} key={row.id}>
                <button type="button" onClick={() => openItem(row)}><span className={styles.executorTitle}><WorkExecutorMark executor={row.executor} /><span>{row.title}</span></span></button>
                <span>{workStages[row.stage]}</span>
              </div>)}
            </section>}
            <section className={styles.itemPlan} aria-label="产物">
              <header><h3>产物</h3></header>
              {item.artifacts.map(url => <div className={styles.resultRow} key={url}>{url.startsWith('https://')
                ? <button type="button" onClick={() => openArtifact(url)}>{url}</button>
                : <LocalFileLink path={url}>{url}</LocalFileLink>}</div>)}
              <form className={styles.inlineItemForm} onSubmit={event => add(event, 'artifacts')}>
                <input aria-label="产物链接或路径" placeholder="链接或项目内文件路径" value={link} onChange={event => setLink(event.target.value)} required />
                <button type="submit" disabled={busy}>添加产物</button>
              </form>
            </section>
            <section className={styles.itemPlan} aria-label="任务动态">
              <header><h3>任务动态</h3></header>
              <ol className={styles.itemTimeline}>{timeline.map(entry => <li key={entry.key}>
                <time dateTime={new Date(entry.at).toISOString()}>{date(entry.at)}</time>
                {entry.result ? <button type="button" onClick={() => openResult(entry.result!)}>{workStatus[entry.result.status]} · 查看执行结果</button> : <p>{entry.text}</p>}
              </li>)}</ol>
              <form className={styles.inlineItemForm} onSubmit={event => add(event, 'notes')}>
                <input aria-label="工作备注" placeholder="添加备注" value={note} onChange={event => setNote(event.target.value)} required />
                <button type="submit" disabled={busy}>保存备注</button>
              </form>
            </section>
          </div>
          <aside className={styles.itemProperties} aria-label="任务属性">
            <section>
              <h3>任务属性</h3>
              <dl className={styles.itemFacts}>
                <div><dt>项目</dt><dd>{itemProject ? <button className={styles.factLink} type="button" onClick={() => work.selectProject(itemProject.id)}>{itemProject.name}</button> : '未分配'}</dd></div>
                {itemGoal && <div><dt>目标</dt><dd><button className={styles.factLink} type="button" onClick={() => work.openGoals(itemGoal.id)}>{itemGoal.title}</button></dd></div>}
                <div><dt>执行器</dt><dd><WorkExecutorMark executor={item.executor || itemProject?.rules?.executor || ''} showName /></dd></div>
                {item.modelSelection && <div><dt>模型</dt><dd>{item.modelSelection.model}</dd></div>}
                {item.priority !== 'none' && <div><dt>优先级</dt><dd>{workPriorities[item.priority]}</dd></div>}
                {item.dueDate && <div><dt>截止日期</dt><dd>{item.dueDate}</dd></div>}
                {item.labels.length > 0 && <div><dt>标签</dt><dd>{item.labels.join(' · ')}</dd></div>}
              </dl>
              <button className={styles.factLink} type="button" onClick={() => work.createItem({ projectId: item.projectId, executor: item.executor, parentId: item.id })}>
                <Icon name="chat-plus" width="14" height="14" />添加子任务
              </button>
            </section>
            <section className={styles.itemAutomation} aria-label="自动化">
              <h3>自动化</h3>
              <WorkAutomation key={item.id + ':handoff'} item={item} work={work} sceneId={sceneId} kind="handoff" />
              <WorkAutomation key={item.id + ':wakeup'} item={item} work={work} sceneId={sceneId} kind="wakeup" />
            </section>
          </aside>
        </div>
      </div>}
      <dialog ref={dialogRef} aria-labelledby="work-item-editor-title" className={styles.itemDialog}
        onCancel={event => { event.preventDefault(); if (!busy) closeEditor(); }}>
        {editing && <form className={`dialog-form ${styles.itemEditor}`} onSubmit={save}>
          <header className="dialog-heading"><h2 id="work-item-editor-title">{editor?.id ? '编辑任务' : '新建任务'}</h2></header>
          <div className={`dialog-body ${styles.itemEditorBody}`} role="region" aria-label="任务字段" tabIndex={0}>
            {preparingExecution && <p className={styles.editorGoal}>选择项目和执行器后即可启动。收到启动回执后，任务会进入「进行中」。</p>}
            <label>标题<input autoFocus={!preparingExecution} required maxLength={200} value={editing.title} onChange={event => update({ title: event.target.value })} /></label>
            {editingGoal && <p className={styles.editorGoal}>所属目标 · {editingGoal.title}</p>}
            <div className={styles.itemFields}>
              <label>项目<select aria-label="项目" value={editing.projectId} required={preparingExecution} autoFocus={preparingExecution && !editingProject}
                disabled={!!(editor?.id && items.find(row => row.id === editor.id)?.runIds.length) || !!editing.parentId} onChange={event => update({ projectId: event.target.value })}>
                <option value="">未分配项目</option>{work.projects.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
              <label>执行器<select aria-label="执行器" value={editing.executor} required={preparingExecution && !editingProject?.rules?.executor}
                autoFocus={preparingExecution && !!editingProject && !editing.executor} onChange={event => update({ executor: event.target.value, modelSelection: null })}>
                <option value="">{preparingExecution && editingProject?.rules?.executor ? '使用项目默认执行器' : '未分配'}</option>{work.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
              {(editing.executor === 'codex' || editing.executor === 'deepseek') && <label>模型
                <WorkModelPicker key={editing.executor} endpoint={work.endpoint} executor={editing.executor} value={editing.modelSelection}
                  disabled={busy} onChange={modelSelection => update({ modelSelection })} />
              </label>}
            </div>
            <label>描述<textarea rows={3} value={editing.description} onChange={event => update({ description: event.target.value })} /></label>
            <label>规格<textarea rows={3} value={editing.specification || ''} onChange={event => update({ specification: event.target.value })} /></label>
            <label>验收标准<textarea rows={3} placeholder="每行一项" value={editing.acceptanceCriteria?.join('\n') || ''}
              onChange={event => update({ acceptanceCriteria: event.target.value.split('\n') })} /></label>
            <div className={styles.itemFields}>
              <label>状态<select aria-label="状态" value={editing.stage} disabled={preparingExecution} onChange={event => update({ stage: event.target.value as WorkStage })}>
                {stages.map(stage => <option key={stage} value={stage}>{workStages[stage]}</option>)}</select></label>
              <label>优先级<select value={editing.priority} onChange={event => update({ priority: event.target.value as WorkItemFields['priority'] })}>
                {priorities.map(priority => <option key={priority} value={priority}>{workPriorities[priority]}</option>)}</select></label>
              <label>截止日期<input type="date" value={editing.dueDate} onChange={event => update({ dueDate: event.target.value })} /></label>
              <label>父任务<select value={editing.parentId} onChange={event => update({ parentId: event.target.value })}>
                <option value="">无</option>{items.filter(row => row.id !== editor?.id && row.projectId === editing.projectId).map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
            </div>
            <label>标签（逗号分隔）<input value={editing.labels.join(',')} onChange={event => update({ labels: event.target.value.split(/[,，]/) })} /></label>
          </div>
          <footer className="dialog-footer">
            {error && <p role="alert" className={styles.itemError}>{error}</p>}
            <div className={styles.itemActions}>
              <button type="button" onClick={closeEditor} disabled={busy}>取消</button>
              <button type="submit" className={styles.saveTask} disabled={busy || !editing.title.trim() || (preparingExecution && !canPrepareExecution(editing))}>
                {preparingExecution ? '保存并执行' : editor?.id ? '保存修改' : '创建任务'}
              </button>
            </div>
          </footer>
        </form>}
      </dialog>
    </>}
  </>;
  if (inConversation) return <WorkspaceDrawer as="section" className={styles.itemsPanel} aria-label="工作任务" aria-busy={busy}
    data-conversation="true" open={showDetails}>{content}</WorkspaceDrawer>;
  return <section className={styles.itemsPanel} aria-label={work.panel === 'results' ? '工作结果' : '工作任务'} aria-busy={busy}>{content}</section>;
}

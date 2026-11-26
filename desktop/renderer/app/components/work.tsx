import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AppModel } from '../models/app';
import type { SceneTask, SubagentStep } from '../../../shared/types';
import { workStages, type WorkAssignee, type WorkGoal, type WorkItem, type WorkResult, type WorkStage } from '../../../shared/work';
import { workImageAccept } from '../../../shared/work-attachments';
import { workActive, workStatus, workTurnRequest } from '../models/work';
import { useModel } from '../../shared/hooks/use-model';
import { useMenuDismiss } from '../../shared/hooks/use-menu-dismiss';
import { Icon, type IconName } from '../../shared/icons/icon';
import { IconButton } from '../../shared/components/icon-button';
import { Dialog } from '../../shared/components/dialog';
import { cleanContent } from '../../shared/lib/clean-content';
import { ChatMessageMarkdown } from '../../shared/components/markdown';
import { workDraftLink, type PlaceTarget } from '../../shared/lib/navigation';
import { LocalFileDirectory } from '../../shared/components/local-file-link';
import { RichComposer, type ComposerHandle } from '../../shared/components/rich-composer';
import { WorkspaceDrawer } from '../../shared/components/workspace-drawer';
import { PanelResizeHandle, usePanelWidth } from '../../shared/components/panel-resize';
import { ChatActivity } from '../../chat/components/messages';
import type { ActivityEntry } from '../../chat/models/chat';
import StatusMark from '../../shared/components/react-bits/status-mark/StatusMark';
import { SplitChatToggle } from './navigation';
import { WorkImports } from './work-imports';
import { WorkItemsPanel } from './work-items';
import { WorkGoalsPanel } from './work-goals';
import { WorkStatusShareDialog } from './work-status-share';
import { WorkExecutorMark } from './work-executor-mark';
import { WorkModelPicker } from './work-model-picker';
import { WorkAttachmentTile } from './work-attachment';
import styles from './work.module.scss';

const filters = [['all', '全部会话'], ['active', '进行中'], ['attention', '需关注'], ['done', '已完成']] as const;
const DEFAULT_SIDEBAR_WIDTH = 248;
type WorkMenuAction = { label: string; icon: IconName; run: () => void; danger?: boolean };
const beingTaskActions = {
  backlog: { label: '让 Being 梳理任务', draft: (task: string) => `帮我理一理 ${task} 要做什么，做到什么样就算好。` },
  todo: { label: '让 Being 安排执行', draft: (task: string) => `开始做 ${task} 吧。` },
  in_progress: { label: '让 Being 查看进度', draft: (task: string) => `帮我看看 ${task} 现在做到哪了。` },
  review: { label: '让 Being 评估结果', draft: (task: string) => `帮我看看 ${task} 做好的结果，符合之前说的要求吗？` },
  blocked: { label: '让 Being 排查阻塞', draft: (task: string) => `帮我看看 ${task} 卡在哪儿了，接下来怎么办？` },
  done: { label: '让 Being 总结交付', draft: (task: string) => `帮我看看 ${task} 最后做成了什么。` },
  cancelled: { label: '让 Being 回顾取消', draft: (task: string) => `说说 ${task} 取消前做了哪些事。` },
} satisfies Record<WorkStage, { label: string; draft: (task: string) => string }>;
function StatusIcon({ status }: { status: SceneTask['status'] }) {
  return <svg className={styles.statusIcon} data-status={status} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <circle cx="8" cy="8" r="5.7" />
    {status === 'done' && <path d="m5 8 2 2 4-4" />}
    {status === 'queued' && <path d="M8 4.5V8l2 1.5" />}
    {status === 'running' && <path d="M8 3a5 5 0 0 1 0 10Z" fill="currentColor" stroke="none" />}
    {(status === 'cancelled' || status === 'interrupted') && <path d="M5.5 8h5" />}
    {['failed', 'timeout', 'budget_exhausted'].includes(status) && <path d="M8 4.7v4M8 10.7v.6" />}
  </svg>;
}


const WorkTurn = memo(function WorkTurn({ task, steps, request, detail, endpoint, onPlace }: { task: SceneTask; steps: SubagentStep[]; request?: string; detail: boolean; endpoint: string; onPlace: (target: PlaceTarget) => void }) {
  const outcomes = new Map(steps.filter(step => step.kind === 'tool-result').map(step => [step.callId, step]));
  const lastToolIndex = steps.map(step => step.kind).lastIndexOf('tool');
  const codex = task.executor === 'codex';
  const firstUserIndex = codex ? steps.findIndex(step => step.kind === 'started') : -1;
  const active = workActive(task);
  const statusUnknown = task.status === 'unknown';
  const renderLocalImage = useCallback((reference: string, alt: string) => {
    const path = task.workdir && !/^(?:[\\/]|[a-z]:[\\/]|~\/)/i.test(reference) ? `${task.workdir.replace(/[\\/]$/, '')}/${reference}` : reference;
    return <WorkAttachmentTile source={{ type: 'localImage', path, name: alt || reference.split(/[\\/]/).pop()! }} endpoint={endpoint} inline />;
  }, [task.workdir, endpoint]);
  const userMessage = (text?: string, attachments: NonNullable<SubagentStep['attachments']> = [], key?: number) => (
    <div key={key} className={styles.userMessage} aria-label="你的消息">
      {attachments.length > 0 && <div className={styles.historyAttachments} role="group" aria-label="消息附件">
        {attachments.map((source, index) => <WorkAttachmentTile key={index} source={source} endpoint={endpoint} executor={task.executor} sessionId={task.nativeId} />)}
      </div>}
      {text && <ChatMessageMarkdown sent content={text} className={styles.bubble} onPlace={onPlace} />}
    </div>
  );
  const activity = <ChatActivity run={{
    kind: 'run', id: task.id, start: task.createdAt, end: active || statusUnknown ? undefined : task.endedAt || steps.at(-1)?.at || task.createdAt,
    label: active ? (task.status === 'queued' ? '排队中' : '思考中') : workStatus[task.status], hint: '', arg: '',
    waitingForReply: statusUnknown,
    status: statusUnknown ? 'waiting' : active ? (task.status === 'queued' ? 'queued' : 'thinking') : task.status === 'done' ? 'done' : task.status === 'cancelled' || task.status === 'interrupted' ? 'stopped' : 'error',
    entries: steps.flatMap<ActivityEntry>((step, index) => {
      if (step.kind === 'thinking' || (!codex && step.kind === 'message' && (active || index < lastToolIndex))) {
        const text = cleanContent(step.output || '');
        return text ? [{ type: 'think', text }] : [];
      }
      if (step.kind !== 'tool') return [];
      const outcome = outcomes.get(step.callId);
      return [{ type: 'tool', toolCallId: step.callId, name: step.name, arg: step.input?.split('\n')[0], inputDetail: step.input, resultDetail: outcome?.output, done: !!outcome, error: outcome?.failed }];
    }),
  }} />;
  const messages = steps.map((step, index) => {
    if (codex && step.kind === 'started' && index !== firstUserIndex)
      return userMessage(step.input, step.attachments, index);
    if (step.kind !== 'message' || (!codex && (active || index < lastToolIndex))) return null;
    const text = cleanContent(step.output || '');
    if (!text) return null;
    const reply = <ChatMessageMarkdown key={index} content={text} className={styles.bubble} onPlace={onPlace} renderLocalImage={renderLocalImage} />;
    return codex ? <div key={index} className={styles.assistantMessage} aria-label="Subagent 的消息">{reply}</div> : reply;
  });
  const notice = <>
    {task.error && <p className={styles.error} role="alert">{task.error}</p>}
    {!active && !statusUnknown && task.status !== 'done' && !task.error && <p className={styles.hint}>{workStatus[task.status]}</p>}
    {detail && !active && !statusUnknown && !steps.some(step => step.kind === 'message') && <p className={styles.hint}>本轮没有回复，可以继续发送消息。</p>}
  </>;
  return <LocalFileDirectory.Provider value={task.workdir}>
    <article className={styles.turn} aria-label="对话轮次" data-turn-id={task.id} tabIndex={-1}>
      {userMessage(request, codex ? steps[firstUserIndex]?.attachments : steps.flatMap(step => step.attachments || []))}
      {codex ? <div className={styles.codexHistory}>{activity}{messages}{notice}</div>
        : <div className={styles.assistantMessage} aria-label="Subagent 的消息">{activity}{messages}{notice}</div>}
    </article>
  </LocalFileDirectory.Provider>;
}, (previous, next) => previous.steps === next.steps && previous.request === next.request && previous.detail === next.detail && previous.endpoint === next.endpoint && previous.onPlace === next.onPlace && JSON.stringify(previous.task) === JSON.stringify(next.task));

export function Work({ app }: { app: AppModel }) {
  const work = useModel(app.work);
  const openPlace = useCallback(({ view, id }: PlaceTarget) => {
    if (view === 'work') app.openWork(id);
    else app.navigate(view, id);
  }, [app]);
  const rootRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [sidebarWidth, resizeSidebar] = usePanelWidth('work-navigation', DEFAULT_SIDEBAR_WIDTH);
  const [workWidth, setWorkWidth] = useState(Infinity);
  const [sidebarOverlay, setSidebarOverlay] = useState(false);
  const [detailsItemId, setDetailsItemId] = useState('');
  const [wideProperties, setWideProperties] = useState(true);
  const [narrowProperties, setNarrowProperties] = useState(false);
  const [sharing, setSharing] = useState<{ itemId: string; endpoint: string }>();
  const sharingItem = sharing?.endpoint === work.endpoint ? work.snapshot?.items?.find(item => item.id === sharing.itemId) : undefined;
  const selected = work.selected;
  const selectedItem = work.item;
  const selectedProjectId = selectedItem ? selectedItem.projectId || 'unassigned' : selected ? selected.tasks[0].projectId || 'unassigned' : '';
  const managing = work.panel !== 'sessions' && !work.importing;
  const goalView = work.panel === 'goals' && !work.importing;
  const goalContext = goalView ? work.goal : work.panel === 'results' || work.importing ? undefined
    : work.goalForProject(work.creating ? work.newProjectId : selectedProjectId || work.projectId);
  const hasStructuredPlan = !!(goalContext || selectedItem?.goal || selectedItem?.specification || selectedItem?.acceptanceCriteria?.length);
  const managedChat = managing && !!selectedItem && !!selected && (!hasStructuredPlan || !!work.selectedId);
  const showTaskDetails = detailsItemId === selectedItem?.id;
  const showProperties = workWidth > 1050 ? wideProperties : narrowProperties;
  const setShowProperties = workWidth > 1050 ? setWideProperties : setNarrowProperties;
  const sidebarReserve = managedChat && showTaskDetails ? 680
    : selected && work.panel === 'sessions' && !work.importing && showProperties ? 600 : 320;
  const compact = workWidth < 760 || workWidth - sidebarWidth < sidebarReserve;
  const sidebarOpen = compact ? sidebarOverlay : !work.sidebarCollapsed;
  useLayoutEffect(() => {
    const root = rootRef.current!;
    setWorkWidth(root.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWorkWidth(entry.contentRect.width));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!sidebarOverlay) return;
    if (!compact) { setSidebarOverlay(false); return; }
    const frame = requestAnimationFrame(() => sidebarRef.current?.querySelector('button')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [compact, sidebarOverlay]);
  const dismissSidebar = () => {
    setSidebarOverlay(false);
    sidebarToggle.current?.focus();
  };
  const navigateSidebar = (action: () => void) => {
    action();
    if (compact) {
      setSidebarOverlay(false);
      headingRef.current?.focus();
    }
  };
  const openProjectTask = (item: WorkItem) => {
    setDetailsItemId('');
    const latestRunId = item.runIds.at(-1);
    const session = latestRunId && work.threads.find(thread => thread.id === latestRunId);
    work.select(session ? session.id : item.id);
  };
  const endpoint = app.snapshot?.settings.endpoint || '';
  const menuRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ label: string; title: string; actions: WorkMenuAction[]; opener: HTMLButtonElement; x: number; y: number }>();
  const [deleting, setDeleting] = useState<{ item: WorkItem; endpoint: string }>();
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  useMenuDismiss(!!contextMenu, menuRef, () => setContextMenu(undefined), () => setContextMenu(undefined));
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || !contextMenu) return;
    menu.style.left = `${Math.max(8, Math.min(contextMenu.x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(contextMenu.y, window.innerHeight - menu.offsetHeight - 8))}px`;
    menu.querySelector('button')?.focus({ preventScroll: true });
  }, [contextMenu]);
  const menuProps = (label: string, title: string, actions: () => WorkMenuAction[]) => {
    const open = (event: MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const opener = event.currentTarget;
      const bounds = opener.getBoundingClientRect();
      setContextMenu({ label, title, actions: actions(), opener, x: 'clientX' in event ? event.clientX : bounds.left, y: 'clientY' in event ? event.clientY : bounds.bottom });
    };
    return { 'aria-haspopup': 'menu' as const, 'aria-keyshortcuts': 'Shift+F10', onContextMenu: open,
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) open(event);
      } };
  };
  const copy = (value: string, label: string) => void app.run(async () => {
    await app.api.copyText(value);
    app.toast(`${label}已复制`, true);
  });
  const taskMenuProps = (item: WorkItem) => menuProps('任务操作', item.title, () => [
    { label: '查看任务详情', icon: 'chat-external-link', run: () => navigateSidebar(() => {
      work.select(item.id);
      setDetailsItemId(item.id);
    }) },
    { label: beingTaskActions[item.stage].label, icon: 'rail-chat', run: () => void app.run(() => discussItem(item)) },
    { label: '分享状态给其他 Being', icon: 'rail-mail', run: () => setSharing({ itemId: item.id, endpoint }) },
    { label: '复制链接', icon: 'chat-copy', run: () => copy(`beings://work/${item.id}`, '任务链接') },
    { label: '复制任务 ID', icon: 'chat-copy', run: () => copy(item.id, '任务 ID') },
    { label: '删除任务', icon: 'lucide-trash', danger: true, run: () => {
      setDeleteError('');
      setDeleting({ item, endpoint });
    } },
  ]);
  const hiddenProjectSessions = work.snapshot?.hiddenProjectSessionIds;
  const sessionMenuProps = (id: string, title: string) => menuProps('会话操作', title, () => {
    const hidden = hiddenProjectSessions?.includes(id);
    const actions: WorkMenuAction[] = [
      { label: '打开会话', icon: 'chat-external-link', run: () => navigateSidebar(() => work.select(id)) },
      { label: '复制链接', icon: 'chat-copy', run: () => copy(`beings://work/${id}`, '会话链接') },
      { label: '复制会话 ID', icon: 'chat-copy', run: () => copy(id, '会话 ID') },
    ];
    if (!work.snapshot?.removedItemRunIds?.includes(id) && !work.snapshot?.items?.some(item => item.runIds.includes(id))) {
      actions.push({ label: hidden ? '显示在项目列表' : '移出项目列表', icon: hidden ? 'chat-plus' : 'chat-close',
        run: () => void app.run(async () => {
          await work.setProjectSessionVisible(id, !!hidden);
          app.toast(hidden ? '会话已显示在项目列表' : '会话已移出项目列表，可在「执行会话」中恢复');
        }) });
    }
    return actions;
  });
  async function deleteTask() {
    if (!deleting || deleting.endpoint !== endpoint || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await work.deleteItem(deleting.item.id);
      setDeleting(undefined);
      headingRef.current?.focus({ preventScroll: true });
    } catch (error) { setDeleteError((error as Error).message); }
    finally { setDeleteBusy(false); }
  }
  useEffect(() => {
    work.configure(endpoint);
    setContextMenu(undefined);
    setDeleting(undefined);
    void work.refresh();
    return work.watch(app.api);
  }, [work, app.api, endpoint]);
  const allThreads = work.threads;
  const threads = useMemo(() => allThreads.filter(thread => !work.projectId || (work.projectId === 'unassigned' ? !thread.tasks[0].projectId : thread.tasks[0].projectId === work.projectId)), [allThreads, work.projectId]);
  const project = work.project;
  const navigationError = work.snapshot && !work.loading && work.selectedId && !selected ? '此 Work 会话不存在或未同步，请通过「导入 / 同步」检查。' : '';
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const projectGroups = useMemo(() => {
    const items = work.snapshot?.items || [];
    const hiddenRuns = new Set([...(work.snapshot?.removedItemRunIds || []), ...(hiddenProjectSessions || [])]);
    const projectThreads = allThreads.filter(thread => !hiddenRuns.has(thread.id));
    const projects = [...work.projects];
    if (projectThreads.some(thread => !thread.tasks[0].projectId) || items.some(item => !item.projectId)) {
      projects.push({ id: 'unassigned', name: '未分配项目', directory: '', createdAt: 0 });
    }
    const query = work.query.toLowerCase();
    return projects.map(project => {
      const projectItems = items.filter(item => (item.projectId || 'unassigned') === project.id);
      const linkedRuns = new Set(projectItems.flatMap(item => item.runIds));
      const sessions = projectThreads.filter(thread => (thread.tasks[0].projectId || 'unassigned') === project.id && !linkedRuns.has(thread.id));
      return {
        ...project,
        items: projectItems,
        total: projectItems.length + sessions.length,
        completed: projectItems.filter(item => item.stage === 'done').length + sessions.filter(thread => thread.tasks.at(-1)!.status === 'done').length,
        threads: sessions.filter(thread => {
          const task = thread.tasks.at(-1)!;
          return (work.filter === 'all' || (work.filter === 'active' ? workActive(task) : work.filter === 'done' ? task.status === 'done' : !workActive(task) && task.status !== 'done'))
            && thread.tasks.some(turn => `${turn.brief || ''} ${turn.userMessage || ''}`.toLowerCase().includes(query));
        }),
      };
    });
  }, [work.projects, allThreads, work.filter, work.query, work.snapshot?.items, work.snapshot?.removedItemRunIds, hiddenProjectSessions]);
  const latest = selected?.tasks.at(-1);
  const groups = useMemo(() => filters.slice(1).map(([key, label]) => ({ key, label, threads: threads.filter(thread => {
    const task = thread.tasks.at(-1)!;
    return key === 'active' ? workActive(task) : key === 'done' ? task.status === 'done' : !workActive(task) && task.status !== 'done';
  }) })), [threads]);
  const visible = (work.filter === 'all' ? threads : groups.find(group => group.key === work.filter)?.threads || []).filter(thread =>
    thread.tasks.some(task => `${task.brief || ''} ${task.userMessage || ''}`.toLowerCase().includes(work.query.toLowerCase())));
  const filterLabel = project?.name || (work.projectId === 'unassigned' ? '未分配项目' : filters.find(([key]) => key === work.filter)?.[1] || '全部工作');
  const headingExecutor = selected ? work.currentExecutor : selectedItem?.executor;
  useEffect(() => {
    if (selectedProjectId) setExpandedProjects(current => ({ ...current, [selectedProjectId]: true }));
  }, [selectedItem?.id, selected?.id, selectedProjectId]);
  const title = selectedItem?.title || selected?.tasks[0].brief?.split('\n')[0] || '子智能体工作';
  const parentProject = work.projects.find(row => row.id === (work.creating ? work.newProjectId : selectedProjectId));
  const ancestors = goalView
    ? work.goalId ? [{ key: 'goals', title: '目标', open: () => work.openGoals() }] : []
    : [
      ...(goalContext ? [{ key: 'goal', title: goalContext.title, open: () => work.openGoals(goalContext.id) }] : []),
      ...(parentProject ? [{ key: 'project', title: parentProject.name, open: () => work.selectProject(parentProject.id) }] : []),
    ];
  const breadcrumbLinks = ancestors.map(entry => <span className={styles.pathStep} key={entry.key}>
    <button className={styles.pathButton} type="button" title={entry.title} onClick={entry.open}>{entry.title}</button>
    <Icon className={styles.pathArrow} name="chat-chevron-right" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </span>);
  const taskOverview = work.panel === 'items' && !work.importing && !work.itemId;
  const activeProjectId = !work.importing && (work.panel === 'items' || work.panel === 'sessions')
    ? (work.creating ? work.newProjectId : selectedProjectId || work.projectId) : '';
  const overview = !selected && !work.creating && !work.importing && !managing;
  const unread = work.snapshot?.results?.unread || 0;
  const inDetail = !!(work.selectedId || work.itemId || work.creating || work.importing || (goalView && work.goalId));
  const paneTitle = work.importing ? '导入 / 同步' : selectedItem || selected ? title
    : work.creating ? '新建执行会话' : goalView ? work.goal?.title || '目标' : work.panel === 'results' ? '工作结果'
    : work.itemId ? '任务详情' : work.selectedId ? '执行会话'
    : taskOverview ? project?.name || (work.projectId === 'unassigned' ? '未分配项目' : '全部任务') : filterLabel;
  const linkedItem = !selectedItem && selected ? work.snapshot?.items?.find(item => item.runIds.includes(selected.id)) : undefined;
  const conversationItem = selectedItem || linkedItem;
  const codexThread = selected?.tasks[0].executor === 'codex' ? selected.tasks[0].nativeId : undefined;
  const composerRef = useRef<ComposerHandle>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const conversationKey = work.creating ? 'new' : selected?.id;
  const [historyWindow, setHistoryWindow] = useState<{ id?: string; count: number }>({ count: 20 });
  const historyAnchor = useRef<{ height: number; top: number } | undefined>(undefined);
  const focusedResult = useRef('');
  const conversation = work.conversation;
  const resultIndex = work.resultTurnId ? conversation.findIndex(row => row.task.id === work.resultTurnId) : -1;
  const defaultHistoryStart = Math.max(0, conversation.length - (historyWindow.id === conversationKey ? historyWindow.count : 20));
  const historyEnd = resultIndex < 0 ? conversation.length : Math.min(conversation.length, resultIndex + 20);
  const historyStart = resultIndex < 0 ? defaultHistoryStart : Math.max(0, Math.min(resultIndex, historyEnd - 20));
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = historyAnchor.current;
    if (el && anchor) { el.scrollTop = anchor.top + el.scrollHeight - anchor.height; historyAnchor.current = undefined; }
  }, [historyStart]);
  useLayoutEffect(() => { followBottom.current = true; if (!work.resultTurnId) composerRef.current?.focus(); }, [conversationKey]);
  useLayoutEffect(() => {
    if (resultIndex >= 0 && focusedResult.current !== work.resultTurnId) {
      const turn = scrollRef.current?.querySelector<HTMLElement>(`[data-turn-id="${CSS.escape(work.resultTurnId)}"]`);
      if (turn) {
        focusedResult.current = work.resultTurnId;
        followBottom.current = false;
        turn.scrollIntoView({ block: 'start' });
        turn.focus({ preventScroll: true });
      }
      return;
    }
    if (!work.resultTurnId) focusedResult.current = '';
    if (followBottom.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [conversationKey, resultIndex, work.resultTurnId, work.details, work.sending, showTaskDetails, showProperties]);
  const draft = work.creating ? work.newDraft : selected ? work.drafts[selected.id] || '' : '';
  const draftAttachments = work.draftAttachments;
  const addAttachments = (files: FileList) => {
    if (!files.length || work.sending) return;
    try { work.addDraftAttachments(Array.from(files)); }
    catch (error) { app.toastError(error); }
  };
  const currentProject = work.creating ? work.projects.find(item => item.id === work.newProjectId) : work.projects.find(item => item.id === selected?.tasks[0].projectId);
  const sceneId = app.snapshot?.chatScene?.scene_id || '';
  const prepareStatusShare = (item: WorkItem, recipient: WorkAssignee, content: string) => {
    const link = workDraftLink(item.title, item.id, { kind: 'share', value: recipient.townId });
    const body = content.split('\n').map(line => `> ${line}`).join('\n');
    return app.draftWorkMessage(`请私信「${recipient.display || recipient.townId}」，分享 ${link} 的当前状态。\n\n${body}`);
  };
  const steering = latest?.status === 'running';
  const archiving = !work.creating && hasStructuredPlan && selectedItem?.stage === 'in_progress' && latest && !workActive(latest);
  const canSubmit = !work.sending && !archiving && (!!draft.trim() || draftAttachments.length > 0) &&
    (!draftAttachments.length || !!work.attachmentMode) && (!steering || work.currentAgent?.capabilities?.steer !== false) &&
    work.ready && (work.creating ? !!work.newProjectId && !!sceneId : latest?.status !== 'queued');
  useEffect(() => {
    if (app.view === 'work') app.workspace.scenes.update({ status: work.error ? 'error' : work.loading ? 'loading' : 'ready',
      scope: `Work；通过 portal_exec 的 @work 命令读取目标、项目和执行会话${goalContext ? `；当前目标 ${goalContext.title}，用 @work goal ${goalContext.id} 读取` : ''}${work.itemId ? `；当前任务 ID ${work.itemId}` : ''}${project && !goalView ? `；当前项目 ${project.name}，项目 ID ${project.id}，工作目录 ${project.directory}` : ''}`, count: threads.length });
  }, [app, goalContext, goalView, project, threads.length, work.error, work.loading, work.itemId]);
  const delegate = () => app.run(() => app.draftWorkMessage(project
    ? `帮我在 ${workDraftLink(project.name, project.id, { kind: 'project' })} 创建一个任务：`
    : '/work 帮我创建一个任务：'));
  const share = () => {
    if (latest) void app.run(() => app.draftWorkMessage(`一起看看 ${workDraftLink(title, latest.id)} 的执行情况。`, latest.sceneId));
  };
  const discussItem = (item: WorkItem) => {
    const { stage } = item;
    const { draft } = beingTaskActions[stage];
    if (stage === 'todo') {
      const previous = item.runIds.at(-1);
      const requestId = previous ? 'after-' + previous.slice(-70).replace(/[^a-zA-Z0-9-]/g, '-') : 'initial';
      return app.draftWorkMessage(draft(workDraftLink(item.title, item.id, { kind: 'run', value: requestId })));
    }
    const execution = stage === 'done' && item.acceptedDeliveryVersion
      ? item.executions?.find(row => row.deliveryVersion === item.acceptedDeliveryVersion) : item.executions?.at(-1);
    const runId = (stage === 'in_progress' ? item.activeRun?.taskId : undefined) || execution?.taskId || item.runIds.at(-1);
    const origin = work.snapshot?.tasks.find(task => task.id === runId)?.sceneId
      || work.snapshot?.results?.entries.find(result => result.id === execution?.resultId)?.sceneId || item.launches?.at(-1)?.sceneId;
    return app.draftWorkMessage(draft(workDraftLink(item.title, item.id, { kind: 'stage', value: stage })), origin);
  };
  const discussGoal = (goal?: WorkGoal) => app.draftWorkMessage(goal
    ? `一起看看 ${workDraftLink(goal.title, goal.id)} 的进度。`
    : '/work 帮我创建一个长期目标：').catch(app.toastError);
  const sendResult = (result: WorkResult, title: string) => app.draftWorkMessage(
    `一起看看 ${workDraftLink(title, result.taskId, { kind: 'result', value: result.id })} 的${result.deliveryVersion ? `第 ${result.deliveryVersion} 版结果` : '结果'}。`, result.sceneId,
  );
  const sessionChat = (selected || work.creating) ? <div className={styles.sessionChat}>
    <div className={styles.conversation} ref={scrollRef} onScroll={event => { const el = event.currentTarget; followBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      <div className={styles.document}>
        {work.creating && !work.sending && <div className={styles.newConversation}><h2>开始新对话</h2><p>{currentProject ? `在 ${currentProject.name} 中开始工作` : '选择项目，开始工作'}</p></div>}
        {work.detailLoading && <p role="status" className={styles.hint}>正在读取对话…</p>}
        {historyStart > 0 && !work.resultTurnId && <button className={styles.loadHistory} onClick={() => {
          const el = scrollRef.current;
          historyAnchor.current = el ? { height: el.scrollHeight, top: el.scrollTop } : undefined;
          followBottom.current = false;
          setHistoryWindow(current => ({ id: conversationKey, count: current.id === conversationKey ? current.count + 20 : 40 }));
        }}>显示更早的对话（还有 {historyStart} 轮）</button>}
        {conversation.slice(historyStart, historyEnd).map(({ task, steps }, index) => {
          const input = task.userMessage || steps.find(step => step.kind === 'started')?.input || task.brief;
          const firstRunId = historyStart + index === 0 ? selected?.id : undefined;
          return <WorkTurn key={task.id} task={task} steps={steps} request={workTurnRequest(input, conversationItem, firstRunId, work.goals)} detail={!work.detailLoading} endpoint={endpoint} onPlace={openPlace} />;
        })}
        {work.resultTurnId && <button className={styles.loadHistory} onClick={() => {
          work.resultTurnId = ''; followBottom.current = true; work.changed();
        }}>返回最近轮次</button>}
        {work.sending && (draft || draftAttachments.length > 0) && (!latest || !workActive(latest)) && <div className={styles.turn}>{draft && <div className={styles.userMessage}><ChatMessageMarkdown sent content={draft} className={styles.bubble} onPlace={openPlace} /></div>}<div className={styles.progress} role="status"><StatusMark status="running" size={14} color="currentColor" fillOpacity={0} /><span>正在发送…</span></div></div>}
      </div>
    </div>
    <div className={styles.composerDock}>
      <div className={styles.composerContext}>
        <Icon name="lucide-folder" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" />
        {work.creating && work.projects.length > 0 ? <select aria-label="会话项目" value={work.newProjectId} disabled={work.sending} onChange={event => { work.newProjectId = event.target.value; work.projectId = event.target.value; work.changed(); }}>{work.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          : <span title={currentProject?.directory || latest?.workdir}>{currentProject?.name || (work.creating ? '尚未选择项目' : '未分配项目')}</span>}
        {work.creating && <IconButton label="添加项目目录" disabled={work.addingProject || work.sending} onClick={() => void work.addProject(app.api).catch(app.toastError)}><Icon name="chat-plus" width="15" height="15" /></IconButton>}
      </div>
      <form className={styles.composer} onPasteCapture={event => {
        if (!event.clipboardData.files.length) return;
        event.preventDefault();
        event.stopPropagation();
        addAttachments(event.clipboardData.files);
      }} onDragOver={event => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }} onDrop={event => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        addAttachments(event.dataTransfer.files);
      }} onSubmit={event => {
        event.preventDefault();
        if (canSubmit) void (work.creating ? work.createTask(sceneId) : work.send(false, sceneId)).catch(app.toastError);
      }}>
        {draftAttachments.length > 0 && <div className={styles.draftAttachments} role="group" aria-label="待发送附件">
          {draftAttachments.map((source, index) => <WorkAttachmentTile key={index} source={source} endpoint={endpoint} disabled={work.sending}
            remove={() => work.removeDraftAttachment(index)} />)}
        </div>}
        <RichComposer key={conversationKey} textareaRef={composerRef} id="work-message" aria-label={work.creating ? '发送消息开始工作' : '继续与子智能体对话'} placeholder={steering ? '向本轮追加要求' : work.creating ? '描述要执行的工作' : '继续这项工作…'} value={draft} disabled={work.sending} onChange={value => { if (work.creating) work.newDraft = value; else if (selected) work.drafts[selected.id] = value; work.changed(); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.closest('form')?.requestSubmit(); } }} />
        <div className={styles.composerActions}>{work.creating ? <div className={styles.composerSelectors}>
          <select aria-label="执行器" value={work.currentExecutor} disabled={work.sending} onChange={event => { work.executor = event.target.value; work.newModel = null; work.changed(); }}>
            {!work.currentExecutor && <option value="" disabled hidden>选择可用执行器</option>}
            {work.executorChoices.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
          {work.currentAgent?.capabilities?.models && <WorkModelPicker key={work.executor} endpoint={endpoint}
            executor={work.executor} value={work.newModel} disabled={work.sending} onChange={model => { work.newModel = model; work.changed(); }} />}
        </div> : <WorkExecutorMark executor={work.currentExecutor} showName />}<div className={styles.runActions}>
          {work.attachmentMode && <>
            <input ref={attachmentInput} aria-label="选择附件" type="file" multiple hidden accept={work.attachmentMode === 'image' ? workImageAccept : undefined}
              onChange={event => {
                if (event.currentTarget.files) addAttachments(event.currentTarget.files);
                event.currentTarget.value = '';
              }} />
            <IconButton label={work.attachmentMode === 'image' ? '添加图片' : '添加附件'} disabled={work.sending} onClick={() => attachmentInput.current?.click()}>
              <Icon name="lucide-paperclip" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </IconButton>
          </>}
          {latest && workActive(latest) && <IconButton type="button" label="停止工作" disabled={work.sending} onClick={() => void work.send(true).catch(app.toastError)}><Icon name="chat-stop" width="17" height="17" /></IconButton>}
          {latest && !workActive(latest) && latest.status !== 'done' && latest.status !== 'unknown' && <button type="button" disabled={work.sending || !work.ready || archiving} onClick={() => void work.retry(latest, sceneId).catch(app.toastError)}>重试这次运行</button>}
          {(!latest || !workActive(latest) || steering) && <IconButton className={`${styles.send} ${styles.primaryButton}`} type="submit" label={work.sending ? '正在发送' : steering ? '追加指令' : '发送'} disabled={!canSubmit}><Icon name="chat-send" width="17" height="17" /></IconButton>}
        </div></div>
      </form>
      {archiving && <p role="status" className={styles.hint}>正在收集上一轮交付，完成后可继续。</p>}
      {!work.ready && <p className={styles.hint}>{work.currentAgent?.message || '执行器尚未就绪。'}{work.currentExecutor === 'internal' && <button type="button" onClick={() => app.openSubagentSettings()}>查看配置</button>}{work.currentAgent?.capabilities?.connect && !work.currentAgent.available && <button type="button" onClick={() => void work.connectAgent(work.currentExecutor)}>连接 {work.currentAgent.name}</button>}</p>}
      {work.connectionNotice && <p role="status" className={styles.hint}>{work.connectionNotice}</p>}
    </div>
  </div> : null;
  return <div className={styles.work} ref={rootRef} onKeyDown={event => {
    if (event.key === 'Escape' && compact && sidebarOverlay && !event.defaultPrevented) {
      event.preventDefault();
      dismissSidebar();
    }
  }}>
    <header className={styles.header}>
      {endpoint && <IconButton ref={sidebarToggle} className={styles.sidebarToggle} label={sidebarOpen ? '收起工作侧栏' : '展开工作侧栏'}
        aria-expanded={sidebarOpen} aria-controls="work-session-navigation" onClick={() => {
          if (compact) {
            if (sidebarOverlay) dismissSidebar();
            else setSidebarOverlay(true);
          } else {
            work.sidebarCollapsed = !work.sidebarCollapsed;
            work.changed();
          }
        }}><Icon name="panel-expand" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" /></IconButton>}
      {inDetail && <IconButton label="返回工作列表" onClick={() => work.back()}><Icon name="back" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" /></IconButton>}
      <div className={styles.breadcrumb}>
        {endpoint && <button type="button" className={styles.workspaceLabel} aria-label="Work 首页" onClick={() => navigateSidebar(() => work.selectProject(''))}>Work</button>}
        {endpoint && <Icon className={styles.breadcrumbArrow} name="chat-chevron-right" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" />}
        {!!ancestors.length && <nav className={styles.headerPath} aria-label="上级位置">{breadcrumbLinks}</nav>}
        {!work.importing && headingExecutor !== undefined && <WorkExecutorMark executor={headingExecutor} />}
        <h1 id="view-title" ref={headingRef} tabIndex={-1} title={endpoint ? paneTitle : undefined}>{endpoint ? paneTitle : 'Work'}</h1>
      </div>
      <div className={styles.headerActions}>
        {endpoint && selected && (!managing || managedChat) && !work.importing && !work.creating &&
          <IconButton className={styles.refreshSession} label="刷新会话状态" title={work.refreshingSession ? '正在刷新会话状态…' : undefined}
            aria-busy={work.refreshingSession} aria-disabled={work.refreshingSession} onClick={() => void work.refresh({ session: true }).then(() => {
              if (work.selected?.id !== selected.id) return;
              followBottom.current = true;
              if (work.resultTurnId) { work.resultTurnId = ''; work.changed(); }
              if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }).catch(app.toastError)}>
            <Icon name="lucide-refresh-cw" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </IconButton>}
        {endpoint && (overview || taskOverview) && <div className={styles.taskActions}>
          <IconButton label="让 Being 安排" className={styles.delegate} onClick={() => void delegate()}>
            <Icon name="chat-agent" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" /><span>让 Being 安排</span>
          </IconButton>
          {taskOverview && project && <IconButton label="新建执行会话" className={styles.newSession} onClick={() => work.startNew(project.id)}>
            <Icon name="rail-chat" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" /><span>新建会话</span>
          </IconButton>}
          <IconButton label="新建任务" className={`${styles.newTask} ${styles.primaryButton}`} aria-haspopup="dialog" onClick={() => work.createItem()}>
            <Icon name="chat-plus" width="16" height="16" /><span>新建任务</span>
          </IconButton>
        </div>}
        {endpoint && !work.importing && <>
          <IconButton className={styles.displayTrigger} label="更多工作操作" popoverTarget="work-display-settings" aria-haspopup="dialog"><Icon name="chat-more" width="17" height="17" /></IconButton>
          <div id="work-display-settings" className={styles.displayMenu} popover="auto" role="dialog" aria-label="更多工作操作"
            onToggle={event => {
              if (event.newState !== 'open') return;
              Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:enabled'))
                .find(button => button.getClientRects().length)?.focus();
            }}
            onClick={event => { if ((event.target as HTMLElement).closest('button:not(:disabled)')) event.currentTarget.hidePopover(); }}>
            {codexThread && <button type="button" onClick={() => void app.run(() => app.api.openCodexThread(codexThread))}>
              <Icon name="chat-external-link" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" />在 Codex 打开
            </button>}
            {linkedItem && <button type="button" onClick={() => work.select(linkedItem.id)}>打开所属任务</button>}
            {managedChat && hasStructuredPlan && <button type="button" onClick={() => work.select(selectedItem.id)}>查看任务总览</button>}
            {selected && <button type="button" disabled={work.detailLoading} onClick={conversationItem ? () => void app.run(() => discussItem(conversationItem)) : share}>
              <Icon name="rail-chat" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" />
              {conversationItem ? beingTaskActions[conversationItem.stage].label : '与 Being 一起看'}
            </button>}
            {(overview || taskOverview) && <button type="button" className={styles.compactAction} onClick={() => void delegate()}>
              <Icon name="chat-agent" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" />让 Being 安排
            </button>}
            {(overview || (taskOverview && project)) && <button type="button" className={overview ? undefined : styles.compactAction}
              onClick={() => work.startNew(project?.id)}><Icon name="chat-plus" width="16" height="16" />新建执行会话</button>}
            <button type="button" disabled={work.importLoading || work.importSaving} onClick={() => void work.openImports()}><Icon name="chat-download" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" />导入 / 同步</button>
            {work.panel !== 'results' && <button type="button" onClick={() => work.openPanel('results')}><Icon name="rail-mail" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" />工作结果{unread > 0 && <small>{unread} 未读</small>}</button>}
          </div>
        </>}
        {selected && (!managing || managedChat) && <IconButton className={styles.propertiesToggle}
          label={managedChat ? (showTaskDetails ? '收起任务详情' : '打开任务详情') : (showProperties ? '收起任务信息' : '展开任务信息')}
          aria-expanded={managedChat ? showTaskDetails : showProperties} aria-controls={managedChat ? 'work-item-details' : 'work-task-properties'}
          onClick={() => managedChat ? setDetailsItemId(showTaskDetails ? '' : selectedItem.id) : setShowProperties(!showProperties)}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M16 4v16" /></svg>
        </IconButton>}
        <SplitChatToggle expanded={app.chatSplitOpen} onToggle={app.toggleChatSplit} icon="rail-chat" />
        <IconButton label="关闭 Work" onClick={app.closePlace}><Icon name="chat-close" width="17" height="17" /></IconButton>
      </div>
    </header>
    {!!ancestors.length && <nav className={styles.compactPath} aria-label="上级位置">{breadcrumbLinks}</nav>}
    {(work.error || work.syncError || navigationError) && <div className={styles.error} role="alert">{work.error || work.syncError || navigationError}<button onClick={() => { work.error = ''; void work.refresh(); }}>重试</button></div>}
    {!endpoint ? <div className={styles.empty}><h2>连接 Being，开始工作</h2><button onClick={() => app.showSettings()}>连接 Being</button></div> : <div className={styles.columns} data-compact={compact}>
      <WorkspaceDrawer as="aside" ref={sidebarRef} edge="left" open={sidebarOpen} id="work-session-navigation" className={styles.sidebar} aria-label="工作导航"
        style={compact ? undefined : { width: sidebarWidth, flexBasis: sidebarWidth }}>
        <div className={styles.sidebarContent}>
          <section aria-labelledby="work-inbox-heading">
            <h2 id="work-inbox-heading" className={styles.sectionHeading}>收件箱</h2>
            <nav className={styles.filters} aria-labelledby="work-inbox-heading">
              <IconButton label="工作结果" title={unread ? `工作结果 · ${unread} 未读` : '工作结果'} aria-pressed={work.panel === 'results' && !work.importing} onClick={() => navigateSidebar(() => work.openPanel('results'))}>
                <Icon name="rail-mail" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <span>工作结果</span>{unread > 0 && <small className={styles.unreadCount}>{unread}</small>}
              </IconButton>
            </nav>
          </section>
          <section>
            <h2 className={styles.sectionHeading}>视图</h2>
            <nav className={styles.filters} aria-label="工作视图">
              <button aria-pressed={goalView} onClick={() => navigateSidebar(() => work.openGoals())}>
                <Icon name="rail-goal" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <span>目标</span>{work.goals.length > 0 && <small>{work.goals.length}</small>}
              </button>
              <button aria-pressed={taskOverview && !work.projectId} onClick={() => navigateSidebar(() => work.selectProject(''))}>
                <Icon name="rail-work" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <span>全部任务</span>{work.snapshot && <small>{work.snapshot.items?.length || 0}</small>}
              </button>
              <button aria-pressed={overview} onClick={() => navigateSidebar(() => work.openPanel('sessions'))}>
                <Icon name="rail-chat" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <span>执行会话</span>{work.snapshot && <small>{allThreads.length}</small>}
              </button>
            </nav>
          </section>
          <section className={styles.projects} aria-label="项目">
            <header><h2 className={styles.sectionHeading}>项目</h2><IconButton className={styles.secondaryButton} label={work.addingProject ? '正在添加项目' : '添加项目目录'} disabled={work.addingProject} onClick={() => void work.addProject(app.api).catch(app.toastError)}><Icon name="chat-plus" width="16" height="16" /></IconButton></header>
            <nav aria-label="项目与任务会话">{projectGroups.map(item => {
              const expanded = !!work.query || (expandedProjects[item.id] ?? (item.id === (selectedProjectId || work.projectId) || (item.id === 'unassigned' && !work.projects.length)));
              const toggleProject = () => setExpandedProjects(current => ({ ...current, [item.id]: !expanded }));
              const openProject = () => navigateSidebar(() => { setExpandedProjects(current => ({ ...current, [item.id]: true })); work.selectProject(item.id); });
              const newProjectTask = () => navigateSidebar(() => { work.selectProject(item.id); work.createItem(); });
              const entries = [
                ...item.items.filter(row => row.title.toLowerCase().includes(work.query.toLowerCase())).map(row => ({
                  id: row.id, title: row.title, status: workStages[row.stage], executor: row.executor,
                  statusKey: row.stage, item: row,
                })),
                ...item.threads.map(thread => ({
                  id: thread.id, title: thread.tasks[0].brief?.split('\n')[0] || '子智能体工作', executor: thread.tasks[0].executor || 'internal',
                  statusKey: thread.tasks.at(-1)!.status, status: workStatus[thread.tasks.at(-1)!.status], item: undefined,
                })),
              ];
              const shown = showAll[item.id] || work.query ? entries : entries.filter((entry, index) => index < 5 || entry.id === (selectedItem?.id || selected?.id));
              return <section className={styles.projectGroup} key={item.id} aria-label={item.name}>
                <div className={styles.projectRow} data-current={item.id === activeProjectId}>
                  <IconButton className={styles.projectToggle} label={`${expanded ? '收起' : '展开'} ${item.name}`} aria-expanded={expanded} aria-controls={`work-project-${item.id}`} disabled={!!work.query} onClick={toggleProject}>
                    <Icon name={expanded ? 'chat-chevron-down' : 'chat-chevron-right'} width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  </IconButton>
                  <button className={styles.projectName} aria-current={work.projectId === item.id && taskOverview ? 'page' : undefined} title={item.directory || item.name}
                    onClick={openProject} {...menuProps('项目操作', item.name, () => {
                      const actions: WorkMenuAction[] = [
                        { label: '打开项目', icon: 'lucide-folder', run: openProject },
                        { label: '新建任务', icon: 'chat-plus', run: newProjectTask },
                      ];
                      if (!work.query) actions.push({ label: expanded ? '收起项目' : '展开项目', icon: expanded ? 'chat-chevron-right' : 'chat-chevron-down', run: toggleProject });
                      if (item.directory) actions.push({ label: '复制项目路径', icon: 'chat-copy', run: () => copy(item.directory, '项目路径') });
                      return actions;
                    })}>
                    <Icon name="lucide-folder" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" /><span>{item.name}</span>
                  </button>
                  <small className={styles.projectCount}>{entries.length}</small>
                  <IconButton className={styles.projectNew} label={`在 ${item.name} 中新建任务`} aria-haspopup="dialog" onClick={newProjectTask}><Icon name="chat-plus" width="14" height="14" /></IconButton>
                </div>
                <div id={`work-project-${item.id}`} className={styles.projectSessions} hidden={!expanded}>
                  {shown.map(entry => <button className={styles.taskLink} key={entry.id} {...(entry.item ? taskMenuProps(entry.item) : sessionMenuProps(entry.id, entry.title))}
                    aria-current={selected?.id === entry.id || selectedItem?.id === entry.id ? 'page' : undefined} title={`${entry.title} · ${entry.status}`}
                    onClick={() => navigateSidebar(() => entry.item ? openProjectTask(entry.item) : work.select(entry.id))}>
                    <WorkExecutorMark executor={entry.executor} /><span className={styles.taskTitle}>{entry.title}</span>
                    <span className={styles.taskStatus} data-status={entry.statusKey}>{entry.status}</span>
                  </button>)}
                  {!work.query && entries.length > 5 && (showAll[item.id] || entries.length > shown.length) && <button className={styles.showMore} onClick={() => setShowAll(current => ({ ...current, [item.id]: !current[item.id] }))}>{showAll[item.id] ? '收起列表' : `查看其余 ${entries.length - shown.length} 项`}</button>}
                  {!entries.length && <p className={styles.projectEmpty}>{work.query ? '没有匹配的记录' : '暂无任务或会话'}</p>}
                </div>
              </section>;
            })}
            </nav>
            {work.snapshot && !work.projects.length && <button className={styles.addProject} disabled={work.addingProject} onClick={() => void work.addProject(app.api).catch(app.toastError)}>添加文件夹作为项目</button>}
          </section>
        </div>
        <PanelResizeHandle panel={sidebarRef} label="调整工作侧栏宽度" edge="right" width={sidebarWidth} onResize={resizeSidebar}
          initial={DEFAULT_SIDEBAR_WIDTH} min={200} max={360} reserve={sidebarReserve} disabled={compact || !sidebarOpen} />
      </WorkspaceDrawer>
      {compact && sidebarOverlay && <button className={styles.sidebarBackdrop} tabIndex={-1} aria-hidden="true" onClick={dismissSidebar} />}
      <section className={styles.detail} aria-label="工作对话" inert={compact && sidebarOverlay}>
        {work.loading && !work.snapshot ? <div className={styles.empty}><p role="status">正在读取 Work…</p></div>
          : goalView ? <WorkGoalsPanel key={work.endpoint} work={work} projects={projectGroups.filter(project => project.goalId === work.goalId)}
            addDirectory={goalId => void work.addProject(app.api, goalId).catch(app.toastError)} discuss={goal => void discussGoal(goal)} toastError={app.toastError} />
          : managing ? <div className={styles.sessionLayout}>
          {managedChat && sessionChat}
          <WorkItemsPanel key={work.endpoint} work={work} sceneId={sceneId}
            beingAction={selectedItem && { label: beingTaskActions[selectedItem.stage].label, open: () => discussItem(selectedItem) }}
            sendResult={sendResult} taskMenuProps={taskMenuProps} openProjectTask={openProjectTask} sessionMenuProps={sessionMenuProps}
            projectThreads={projectGroups.find(row => row.id === work.projectId)?.threads}
            shareStatus={item => setSharing({ itemId: item.id, endpoint })}
            inConversation={managedChat} showDetails={showTaskDetails} closeDetails={() => setDetailsItemId('')} onPlace={openPlace} openArtifact={url => void app.api.openBrowser(url)} />
        </div> : work.importing ? work.importCatalog ? <WorkImports key={work.endpoint} work={work} catalog={work.importCatalog} /> : <div className={styles.empty}><h2>{work.importLoading ? '正在读取同步清单…' : '无法读取同步清单'}</h2>{work.importError && <p role="alert">{work.importError}</p>}<button onClick={() => void work.openImports()} disabled={work.importLoading}>重试</button><button onClick={() => { work.importing = false; work.changed(); }}>返回</button></div> : !work.creating && (!selected || !latest) ? <div className={styles.overview}>
          {project && <p className={styles.overviewDirectory}><Icon name="lucide-folder" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" />{project.directory}</p>}
          <div className={styles.sessionFilters}>
            <label className={styles.searchField}>
              <Icon name="rail-search" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <input type="search" aria-label="搜索会话" placeholder="搜索会话" value={work.query} onChange={event => { work.query = event.target.value; work.changed(); }} />
            </label>
            <select aria-label="筛选会话状态" value={work.filter} onChange={event => { work.filter = event.target.value; work.changed(); }}>
              {filters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          {work.loading ? <p className={styles.hint} role="status">正在读取会话…</p> : !visible.length ? <div className={styles.empty}><h3>暂无会话</h3><p>运行记录和导入的会话会显示在这里。</p></div> : groups.map(group => {
            const rows = group.threads.filter(thread => visible.includes(thread));
            return rows.length > 0 && <section className={styles.group} key={group.key} aria-label={`${group.label}工作`}>
              <h3><StatusIcon status={group.key === 'active' ? 'running' : group.key === 'done' ? 'done' : 'failed'} />{group.label}<span>{rows.length}</span></h3>
              {rows.map(thread => { const task = thread.tasks.at(-1)!, title = thread.tasks[0].brief?.split('\n')[0] || '子智能体工作'; return <button key={thread.id} className={styles.overviewRow} {...sessionMenuProps(thread.id, title)} onClick={() => work.select(thread.id)}>
                <WorkExecutorMark executor={thread.tasks[0].executor || 'internal'} /><strong>{title}</strong>
                <span className={styles.overviewState}><StatusIcon status={task.status} />{workStatus[task.status]}</span>
                <time dateTime={new Date(task.createdAt).toISOString()}>{new Date(task.createdAt).toLocaleDateString('zh-CN', {month:'numeric',day:'numeric'})}</time>
              </button>; })}
            </section>;
          })}
        </div> : <div className={styles.sessionLayout}>{sessionChat}{selected && latest && <WorkspaceDrawer as="aside" id="work-task-properties" className={styles.properties} aria-label="任务信息" open={showProperties}>
          <header><h2>任务信息</h2><IconButton label="收起右侧任务信息" onClick={() => setShowProperties(false)}><Icon name="chat-close" width="15" height="15" /></IconButton></header>
          <dl>
            <div><dt>状态</dt><dd><StatusIcon status={latest.status} />{workStatus[latest.status]}</dd></div>
            <div><dt>执行器</dt><dd><WorkExecutorMark executor={work.currentExecutor} showName /></dd></div>
            <div><dt>项目</dt><dd><Icon name="lucide-folder" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" />{currentProject?.name || '未分配项目'}</dd></div>
            <div><dt>对话</dt><dd>{work.detailLoading ? '读取中…' : `${conversation.length} 轮`}</dd></div>
          </dl>
          {(latest.workdir || currentProject?.directory) && <section><h3>工作目录</h3><p>{latest.workdir || currentProject?.directory}</p></section>}
          <details><summary>会话信息</summary><h3>任务 ID</h3><code>{latest.id}</code>{latest.session && <><h3>Session</h3><code>{latest.session}</code></>}</details>
        </WorkspaceDrawer>}</div>}
      </section>
    </div>}
    {sharingItem && <WorkStatusShareDialog key={sharingItem.id} item={sharingItem} self={app.town.live?.beingId}
      close={() => setSharing(undefined)} prepare={(recipient, content) => prepareStatusShare(sharingItem, recipient, content)} />}
    {contextMenu && createPortal(<div ref={menuRef} className={`${styles.displayMenu} ${styles.contextMenu}`} role="menu" aria-label={contextMenu.label}
      onContextMenu={event => event.preventDefault()} onKeyDown={event => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault();
          event.stopPropagation();
          setContextMenu(undefined);
          contextMenu.opener.focus({ preventScroll: true });
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus({ preventScroll: true });
      }}>
      <div className={styles.contextMenuTitle} title={contextMenu.title}>{contextMenu.title}</div>
      {contextMenu.actions.map(action => <button key={action.label} type="button" role="menuitem" tabIndex={-1} data-danger={action.danger || undefined} onClick={() => {
        contextMenu.opener.focus({ preventScroll: true });
        setContextMenu(undefined);
        action.run();
      }}><Icon name={action.icon} width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" />{action.label}</button>)}
    </div>, document.body)}
    <Dialog className={`utility-dialog ${styles.deleteDialog}`} open={!!deleting && deleting.endpoint === endpoint} busy={deleteBusy}
      aria-labelledby="work-delete-title" onClose={() => setDeleting(undefined)} dismissOnBackdrop>
      <h2 id="work-delete-title">删除任务？</h2>
      <p className="utility-subtitle">「{deleting?.item.title}」将从项目和看板移除。关联的执行会话、回执和文件会保留。</p>
      {deleting && work.snapshot?.items?.some(row => row.parentId === deleting.item.id) && <p className="utility-subtitle">子任务将移到上一级。</p>}
      {deleteError && <p className={styles.itemError} role="alert">{deleteError}</p>}
      <div className={styles.deleteActions}>
        <button type="button" className={styles.secondaryButton} autoFocus disabled={deleteBusy} onClick={() => setDeleting(undefined)}>取消</button>
        <button type="button" className={`${styles.secondaryButton} ${styles.deleteTask}`} disabled={deleteBusy} onClick={() => void deleteTask()}>{deleteBusy ? '删除中…' : '确认删除'}</button>
      </div>
    </Dialog>
  </div>;
}

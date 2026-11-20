import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { attachmentProcessing } from './components/attachment-processing';
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { HomeFileAction } from '../shared/components/being-files';
import { FileName } from '../shared/components/file-name';
import { beingFileBlocks } from '../../shared/being-files';
import { imageGenerationBlocks } from '../../shared/image-generation-blocks';
import { requestHomeFilePreview } from '../shared/services/home-file-preview';
import { formatBytes } from '../shared/lib/format-bytes';
import { Icon } from '../shared/icons/icon';
import { ErrorIndicator } from '../shared/components/error-indicator';
import { Toast } from '../shared/components/toast';
import { ImageViewer } from '../shared/components/image-viewer';
import GradualBlur from '../shared/components/react-bits/GradualBlur';
import { ChatActionTooltip, ChatTooltipGroup } from '../shared/components/chat-action-tooltip';
import useMemoizedFn from 'ahooks/es/useMemoizedFn';
import { useFileDrop } from './hooks/use-file-drop';
import { useChatViewport } from './hooks/use-chat-viewport';
import { useMessageSelection } from './hooks/use-message-selection';
import { useChatShortcuts } from './hooks/use-chat-shortcuts';
import { LocalFileAction, requestLocalFilePreview } from '../shared/components/local-file-link';
import { SbsControl } from "../shared/components/sbs-control";
import {useHistoryWindow} from './hooks/use-history-window';
import { AttachmentMessageContent, AttachmentMessageStatus, hasAttachmentMessage, isPreviewImage, originalMessageText } from "./components/message-content";
import { attachmentContentURL } from './services/attachment-view';
import { ImageGenerationAnswer } from './components/image-generation';
import { SurfaceContext } from '../shared/intelligent-ui/surface-view';
import { SurfaceTimeline } from '../shared/intelligent-ui/surfaces';
import { useMessageScroll } from "./hooks/use-message-scroll";
import { IntelligentUIExamples, type UIExampleId } from "./components/intelligent-ui-examples";
import { ConversationSearch, searchEntries } from "./services/conversation-search";
import { replyBubbles, historyTargetBubble, quietProgressRuns } from "./models/reply-bubbles";
import { ScheduledMessage } from './components/scheduling';
import { splitSchedulingHint, withScheduling } from './models/scheduling';
import {
  Component,
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ChatState,
  type Attachment,
  type ChatRuntime,
  type ChatPanel,
  type ChatItem,
  type Message,
  type RuntimeOptions,
} from "./models/chat";
import { inCurrentScene, isGlobalBeingMessage, sceneItems, sceneName, type HistoryScope } from "./models/scenes";
import { useModel } from "../shared/hooks/use-model";
import { usePointerFocus } from '../shared/hooks/use-pointer-focus';
import { CodeClipboard, isImageOnlyMarkdown } from "../shared/components/markdown";
import { type ComposerHandle } from "../shared/components/rich-composer";
import { ChatComposer } from "./components/composer";
import { MessageHoverRow } from './components/message-hover-row';
import { ComposerSend } from "./components/composer-send";
import { ComposerAddMenu } from './components/composer-add-menu';
import { ComposerQueueContent } from './components/composer-queue-content';
import { canUseComposerCommand, parseComposerCommands } from './models/composer-commands';
import {useMessageMenu} from '../shared/components/message-menu';
import {startsTimeGroup,messageTimeLabel,fullMessageTime} from '../shared/lib/message-time';
import { CopyMessage } from '../shared/components/copy-message';
import { TemperatureGlow, ChatActivity } from "./components/messages";
import { ChatStatusRow, SystemStatusRow } from './components/status-row';
import { SceneLoading } from './components/scene-loading';
import { ChatSettings } from "./components/settings";
import { ChatInfoPanels } from "./components/panels";
import { EditContextMenu } from "../shared/components/context-menu";
import { ChatIndex, JumpToLatest } from "./components/navigation";
import type { ChatBridge } from "./services/bridge";
import { useChatSession } from "./hooks/use-chat-session";

class ChatErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="chat-error">
        <ChatStatusRow title="聊天页面加载未完成" tone="error"
          retry={{ label: '重新加载', run: () => location.reload() }} />
      </div>
    ) : (
      this.props.children
    );
  }
}
export function ChatApp({ connection, keywordNavigation = true, mobileWeb = false }: { connection?: RuntimeOptions['connection']; keywordNavigation?: boolean; mobileWeb?: boolean } = {}) {
  usePointerFocus(typeof document !== 'undefined' && document.documentElement.dataset.chatHost === 'desktop');
  const session = useChatSession(connection);
  return (
    <ChatErrorBoundary>
      {session ? <ChatView {...session} keywordNavigation={keywordNavigation} mobileWeb={mobileWeb} /> : <div role="status">正在连接…</div>}
    </ChatErrorBoundary>
  );
}
function canEditQueuedMessage(item: Message) {
  return (!item.queuePhase || item.queuePhase === 'queued') && !hasAttachmentMessage(item) && !!item.editQueued;
}

function QueueRow({ item, index, reorderable, allowInterrupt, onEdit }: {
  item: Message; index: number; reorderable: boolean; allowInterrupt: boolean;
  onEdit?: (item: Message) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id, disabled: { draggable: !reorderable, droppable: !reorderable } });
  const status = item.queueNotice || (item.queuePhase === 'preparing' ? '正在处理附件' : item.queuePhase === 'sending' ? '正在发送' : '');
  const failed = (item.queueNotice && item.queueNoticeTone === 'error') || item.queuePhase === 'failed' || !!item.retry;
  const unconfirmed = item.queuePhase === 'sending' && !!item.queueNotice;
  const working = !failed && !unconfirmed && (item.queuePhase === 'preparing' || item.queuePhase === 'sending');
  const parts = item.attachmentViews?.flatMap(view => view.parts.filter(part => part.type === 'attachment')) ?? [];
  const files = item.attachmentUploads?.length ? item.attachmentUploads : parts;
  const fileNames = files.map(file => file.name);
  const imageCount = files.filter(file => isPreviewImage(file.mime)).length;
  const imageUpload = item.attachmentUploads?.find(file => isPreviewImage(file.mime));
  const imagePart = parts.find(part => isPreviewImage(part.mime));
  const text = originalMessageText(item).trim();
  const label = text.replace(/\s+/g, ' ') || (imageCount ? `${imageCount} 张图片` : fileNames.join('、'));
  return <div ref={setNodeRef} className={`composer-queue-item${isDragging ? ' dragging' : ''}`} role="listitem"
    aria-label={[label, ...fileNames.filter(name => !label.includes(name))].filter(Boolean).join('，') || undefined}
    style={{ transform: CSS.Translate.toString(transform), transition }}
    data-queue-id={item.id} data-queue-dragging={isDragging || undefined} data-working={working || undefined}>
    {reorderable ? <button ref={setActivatorNodeRef} className="composer-queue-drag-handle" type="button"
      aria-label={`调整顺序：${label}`} {...attributes} {...listeners}>
      <Icon name="chat-grip" width="14" height="14" />
    </button> : <span className="composer-queue-leading" aria-hidden="true">
      <Icon name={working ? 'chat-busy' : 'chat-queue'} width="14" height="14" />
    </span>}
    <ComposerQueueContent text={text} summary={label} names={fileNames} position={index + 1} dragging={isDragging}
      status={status && (failed ? <ErrorIndicator description={status} /> : unconfirmed &&
        <span className="composer-queue-status" role="status" title={status} aria-label={status}>送达未确认</span>)}
      image={imageUpload?.blob ? { blob: imageUpload.blob } : imagePart ? { src: attachmentContentURL(item.attachmentEndpoint || '', imagePart.attachment_id, true) } : undefined} />
    {status && !failed && !unconfirmed && <span className="composer-queue-announcement" role="status" aria-label={status}>{status}</span>}
    <div className="composer-queue-row-actions">
      {item.retry ? <button type="button" className="composer-queue-steer" disabled={item.queueBusy} aria-label={item.retryLabel || '重试'}
        onClick={() => void item.retry?.()}><Icon name="chat-retry" width="14" height="14" />重试</button>
        : allowInterrupt && !working && !unconfirmed && item.canInterruptQueued && <ChatActionTooltip content="发给正在运行的任务">
          <button type="button" className="composer-queue-steer" aria-label="引导"
            onClick={() => void item.interruptQueued?.()}><Icon name="turn-right" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />引导</button>
        </ChatActionTooltip>}
      {!working && !unconfirmed && onEdit && canEditQueuedMessage(item) && <button type="button" data-queue-edit data-warm-tooltip="编辑消息"
        aria-label={`编辑消息：${label}`} disabled={item.queueBusy} onClick={() => onEdit(item)}>
        <Icon name="chat-edit" width="14" height="14" />
      </button>}
      {item.cancelQueued && (item.queuePhase !== 'sending' || !item.queueBusy) && <button type="button"
        data-warm-tooltip={item.queuePhase === 'sending' ? '移除待发记录' : '取消排队'}
        aria-label={`${item.queuePhase === 'sending' ? '移除待发记录' : '取消排队'}：${label}`}
        disabled={item.queueBusy && item.queuePhase !== 'preparing'} onClick={() => item.cancelQueued?.()}>
        <Icon name="chat-close" width="14" height="14" />
      </button>}
    </div>
  </div>;
}
export function ChatView({
  state,
  runtime,
  bridge,
  keywordNavigation,
  mobileWeb,
}: {
  state: ChatState;
  runtime: ChatRuntime;
  bridge: ChatBridge;
  keywordNavigation: boolean;
  mobileWeb: boolean;
}) {
  useModel(state);
  const toastHosted = state.toastHosted || (parent !== window && location.protocol === 'beings:');
  const [connectionNotice, setConnectionNotice] = useState('');
  useEffect(() => {
    // Embedded chat sends connection notices to the shell's single toast.
    if (toastHosted) return;
    setConnectionNotice(state.banner);
    if (!state.banner) return;
    const timer = setTimeout(() => setConnectionNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [state.banner, toastHosted]);
  const { viewport, narrow, nativeTouch } = useChatViewport(mobileWeb);
  const [editingQueued, setEditingQueued] = useState<{ item: Message; text: string; saving: boolean } | null>(null);
  const openQueueEditor = useRef<Message | null>(null);
  const endQueueEdit = useCallback((message: Message) => {
    if (openQueueEditor.current !== message) return;
    openQueueEditor.current = null;
    message.setQueuedEditing?.(false);
    setEditingQueued(null);
  }, []);
  function beginQueueEdit(message: Message) {
    if (openQueueEditor.current || message.setQueuedEditing?.(true) === false) return false;
    openQueueEditor.current = message;
    setEditingQueued({ item: message, text: message.text, saving: false });
    return true;
  }
  async function saveQueueEdit() {
    if (!editingQueued || editingQueued.saving || !editingQueued.text.trim()) return;
    const { item, text } = editingQueued;
    if (text === item.text) { endQueueEdit(item); return; }
    setEditingQueued({ item, text, saving: true });
    if (await item.editQueued?.(text)) endQueueEdit(item);
    else if (openQueueEditor.current === item) setEditingQueued({ item, text, saving: false });
  }
  useEffect(() => () => { openQueueEditor.current?.setQueuedEditing?.(false); }, []);
  const queueSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const timelineItems = replyBubbles(sceneItems(withScheduling(state.items.filter(item => item.kind !== "message" || !item.queued), state.sceneTasks, state.currentScene), state.historyScope, state.currentScene, state.showSbsMessages));
  const historyWindow=useHistoryWindow(state.historyLoading ? [] : timelineItems,JSON.stringify([state.historyScope,state.currentScene.sceneId,state.showSbsMessages]),before=>runtime.loadOlderHistory(before));
  const visibleItems=historyWindow.items;
  const progressRuns = quietProgressRuns(timelineItems);
  const latestRunByScene = new Map<string | undefined, string>();
  for (const item of timelineItems) {
    if (item.kind === 'run' && !item.autonomousOrigin) latestRunByScene.set(item.sceneId, item.id);
  }
  const visibleBubbleIds = new Set(visibleItems.flatMap(item => item.kind === 'message' && item.role !== 'system' ? item.sourceMessageIds || [item.id] : []));
  const bubbleNotices = new Map<string, Message[]>();
  const attachedNoticeIds = new Set<string>();
  for (const item of visibleItems) {
    if (item.kind !== 'message' || item.role !== 'system' || !item.statusMessageId || !visibleBubbleIds.has(item.statusMessageId)) continue;
    const notices = bubbleNotices.get(item.statusMessageId) || [];
    notices.push(item);
    bubbleNotices.set(item.statusMessageId, notices);
    attachedNoticeIds.add(item.id);
  }
  const visibleTimeline = attachedNoticeIds.size ? visibleItems.filter(item => !attachedNoticeIds.has(item.id)) : visibleItems;
  const timeGroups=new Set<string>();
  let previousMessageTime:number|undefined;
  for(const item of visibleTimeline) if(item.kind==='message') {
    if(startsTimeGroup(item.createdAt,previousMessageTime))timeGroups.add(item.id);
    if(item.createdAt!==undefined&&Number.isFinite(item.createdAt))previousMessageTime=item.createdAt;
  }
  const pendingReveal=useRef<{seq:number;sceneId?:string}|null>(null);
  const queuedMessages = state.items.filter((item): item is Message => item.kind === 'message' && !!item.queued &&
    item.sceneId === state.currentScene.sceneId && (!hasAttachmentMessage(item) || !!item.queuePhase));
  const visibleQueue = editingQueued ? queuedMessages.filter(item => item !== editingQueued.item) : queuedMessages;
  const sortableQueue = visibleQueue.filter(item => item.reorderQueued && !item.queueBusy && (!item.queuePhase || item.queuePhase === 'queued'));
  const queueWriting = editingQueued?.saving || visibleQueue.some(item => item.queueBusy || item.queuePhase === 'sending' || item.queuePhase === 'preparing');
  const sortableIds = !queueWriting && sortableQueue.length > 1 ? sortableQueue.map(item => item.id) : [];
  useEffect(() => {
    if (editingQueued && !queuedMessages.includes(editingQueued.item)) endQueueEdit(editingQueued.item);
  }, [editingQueued, queuedMessages, endQueueEdit]);
  const historyEndpoint = useMemo(() => new URLSearchParams(location.search).get('history_scope') || '', []);
  const surfaceTimeline = useRef(new SurfaceTimeline());
  const surfaceScope = (sceneId?: string) => JSON.stringify([historyEndpoint || location.origin, state.soul.being_id || state.name, sceneId || 'global']);
  const surfaceBlocks = surfaceTimeline.current.build(visibleItems.filter((item): item is Message => item.kind === 'message' && item.role === 'being').map(item => ({
    id: item.id, identity: String(item.historySeq ?? item.id), scope: surfaceScope(item.sceneId), text: splitSchedulingHint(item.text).text, streaming: item.streaming,
  })));
  const surfaceContext = useMemo(() => ({ blocks: surfaceBlocks }), [surfaceBlocks]);
  const currentSceneName = sceneName(state.currentScene, state.currentScene);
  const [pendingPreview, setPendingPreview] = useState<Attachment | null>(null);
  const pendingList = useRef<HTMLDivElement>(null);
  const queueTooltipRoot = useRef<HTMLDivElement>(null);
  const pendingImages = state.files.flatMap(file => {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return [];
    const src = file.previewUrl || (file.base64 && `data:${file.type};base64,${file.base64}`);
    return src ? [{ file, src, name: file.name }] : [];
  });
  const pendingImageIndex = pendingImages.findIndex(image => image.file === pendingPreview);
  const activePendingImage = pendingImages[pendingImageIndex];
  useEffect(() => {
    if (pendingPreview && pendingImageIndex < 0) setPendingPreview(null);
  }, [pendingPreview, pendingImageIndex]);
  const chatApp = useRef<HTMLDivElement>(null),
    messages = useRef<HTMLDivElement>(null),
    composer = useRef<ComposerHandle>(null),
    composerDock = useRef<HTMLDivElement>(null),
    composerArea = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const editingQueueItem = editingQueued?.item;
  const editingWasActive = useRef(false);
  useLayoutEffect(() => {
    if (!editingQueued?.saving && (editingQueueItem || editingWasActive.current)) composer.current?.focus();
    editingWasActive.current = Boolean(editingQueueItem);
  }, [editingQueueItem, editingQueued?.saving]);
  const messageElements = useRef(new Map<string, HTMLDivElement>());
  const reader = useMessageScroll(visibleItems, messages, messageElements, composerDock);
  const { scrollLock, releaseAnchor } = reader;
  useLayoutEffect(() => {
    const app = chatApp.current, area = composerDock.current, container = messages.current;
    if (!app || !area || !container) return;
    const sync = () => {
      app.style.setProperty('--chat-composer-height', `${area.getBoundingClientRect().height}px`);
      if (scrollLock.current) {
        releaseAnchor();
        container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      }
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(area);
    return () => observer.disconnect();
  }, [scrollLock, releaseAnchor]);
  useLayoutEffect(() => {
    const area = composerArea.current;
    const row = area?.querySelector<HTMLElement>('#input-row');
    if (!area || !row) return;
    const syncLayout = () => {
      const input = row.querySelector<HTMLElement>('#input');
      if (!input) return;
      const paragraph = input.firstElementChild;
      const isSingleParagraph = input.childElementCount === 1 && paragraph?.tagName === 'P' &&
        !paragraph.querySelector('br:not(.ProseMirror-trailingBreak)');
      let expanded = !isSingleParagraph;
      if (isSingleParagraph && paragraph.textContent) {
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        const text = range.getBoundingClientRect();
        const style = getComputedStyle(input);
        const actions = Array.from(row.children).filter(child => !child.classList.contains('chat-composer'));
        const available = row.clientWidth - actions.reduce((width, child) => width + child.getBoundingClientRect().width, 0)
          - actions.length * parseFloat(getComputedStyle(row).columnGap)
          - 2 * (parseFloat(style.getPropertyValue('--chat-prompt-inline-text-inset')) || 0);
        expanded = text.height > parseFloat(style.lineHeight) + 2 || text.width > available;
      }
      area.toggleAttribute('data-long-draft', expanded);
    };
    syncLayout();
    const resize = new ResizeObserver(syncLayout);
    resize.observe(row);
    const draft = new MutationObserver(syncLayout);
    draft.observe(row, { childList: true, subtree: true, characterData: true });
    return () => { resize.disconnect(); draft.disconnect(); };
  }, []);
  const scopeScroll = useRef<Partial<Record<HistoryScope, { top: number; locked: boolean }>>>({});
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const hasDraft = !!state.draft.trim() || state.files.length > 0;
  const readingFiles = state.files.some(file => file.loading);
  const canSteer = state.streaming && state.canInterruptQueue && !state.attachmentPending;
  const canChooseFollowUp = canSteer && hasDraft && !state.stopping &&
    (state.files.length === 0 || location.protocol !== 'beings:');
  const action = state.stopping || (!hasDraft && (state.streaming || state.attachmentPending)) ? 'stop'
    : canChooseFollowUp ? 'steer' : hasDraft && state.sendWillQueue ? 'queue' : 'send';
  const sendLabel = state.stopping ? '正在停止' : action === 'stop' ? '停止处理' : readingFiles ? '正在读取附件'
    : action === 'steer' ? '引导' : action === 'queue' ? '排队' : '发送消息';
  function sendDraft(mode?: "interrupt") {
    if (state.stopping || readingFiles) return;
    if (!parseComposerCommands(state.draft).commands.every(command => canUseComposerCommand(command, state))) return;
    releaseAnchor();
    scrollLock.current = true;
    void runtime.send(state.draft, null, { mode });
  }
  const changeScope = useMemoizedFn((scope: HistoryScope) => {
    if (scope === state.historyScope || (scope === "current" && !state.currentScene.sceneId)) return;
    if (messages.current) scopeScroll.current[state.historyScope] = { top: messages.current.scrollTop, locked: scrollLock.current };
    releaseAnchor();
    state.historyScope = scope;
    setSelection(null);
    setHighlighted(null);
    state.changed();
    // The desktop bridge needs a fresh server view when switching scenes.
    // Standalone Loom keeps one IndexedDB cursor and filters that cache locally.
    if (window.parent !== window) void runtime.refreshHistory();
  });
  const composing = useRef(false),
    compositionEnd = useRef(0);
  const { dragging, dropHandlers } = useFileDrop(JSON.stringify([state.currentScene.sceneId, state.historyScope]), files => runtime.handleFiles(files));
  const [highlighted, setHighlighted] = useState<string | null>(null),
    [panel, setPanel] = useState<ChatPanel>(null),
    [panelReturnsToSettings, setPanelReturnsToSettings] = useState(false);
  const [readingSize, setReadingSize] = useState(16);
  const [topInset, setTopInset] = useState(0);
  const [showReasoning, setShowReasoning] = useState(() => {
    try { return localStorage.getItem("beings:show-reasoning") === "true"; } catch { return false; }
  });
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    new URLSearchParams(location.search).get("theme") === "dark"
      ? "dark"
      : "light",
  );
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const messageMenu=useMessageMenu(bridge.copyText,JSON.stringify([state.currentScene.sceneId,state.historyScope]));
  const activeMenuMessageId = messageMenu.opener?.closest('[data-message-id]')?.getAttribute('data-message-id');
  const attachmentMenuMessageId = messageMenu.attachmentOpener?.closest('[data-message-id]')?.getAttribute('data-message-id');
  const { selection, setSelection, addToChat } = useMessageSelection(messages, composer, nativeTouch);
  useChatShortcuts(bridge, !contextMenuOpen && !messageMenu.isOpen && !nativeTouch ? selection?.text : undefined, addToChat, isMac);
  useEffect(() => {
    const search = new ConversationSearch((path, init) => runtime.request(path, init));
    const abort = new AbortController();
    let searchQuery = '';
    const publishSearch = (loading: boolean, error = '') => bridge.send({type:'beings:search-index', query:searchQuery, entries:searchEntries(search.rows,searchQuery), loading, error});
    bridge.start(runtime, {
      panel: (value, returnToSettings = false) => {
        setPanel((current) => (current === value ? null : value));
        setPanelReturnsToSettings(Boolean(value && returnToSettings));
      },
      theme: setTheme,
      reading: setReadingSize,
      topInset: setTopInset,
      reasoning: show => {
        setShowReasoning(show);
        try { localStorage.setItem("beings:show-reasoning", String(show)); } catch { /* In-memory preference remains usable. */ }
      },
      search: query => {
        searchQuery = query;
        publishSearch(Boolean(query.trim()));
        if (query.trim()) void search.sync(abort.signal,()=>publishSearch(true)).then(()=>publishSearch(false),()=>{if (!abort.signal.aborted) publishSearch(false,'历史读取未完成，显示已读取的匹配内容，请重试');});
      },
      jump: id => {
        const rowIndex = search.rows.findIndex(row=>`history-${row.seq}` === id);
        if (rowIndex < 0) return;
        runtime.revealHistory(search.rows.slice(Math.max(0,rowIndex-10),rowIndex+11));
        releaseAnchor();
        scrollLock.current = false;
        state.historyScope = 'all';
        pendingReveal.current={seq:search.rows[rowIndex].seq};
        bridge.send({type:'beings:history-scope-state',scope:'all'});
        state.changed();
      },
      reveal: (seq, sceneId) => {
        pendingReveal.current = {seq, sceneId};
        state.changed();
      },
      focus: () => composer.current?.focus(),
      scope: changeScope,
    });
    void runtime.start();
    composer.current?.focus();
    return () => abort.abort();
  }, [bridge, runtime, state, releaseAnchor, scrollLock, changeScope]);
  useEffect(() => {
    bridge.send({ type: "beings:history-scope-state", scope: state.historyScope, sceneId: state.currentScene.sceneId });
  }, [bridge, state.historyScope, state.currentScene.sceneId]);
  useEffect(() => {
    bridge.send({ type: "beings:scene-sbs-state", sceneId: state.currentScene.sceneId, show: state.showSbsMessages });
  }, [bridge, state.currentScene.sceneId, state.showSbsMessages]);
  useEffect(() => {
    if (mobileWeb) bridge.send({ type: 'beings:chat-panel', panel });
  }, [bridge, mobileWeb, panel]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    document.title = "Loom · " + state.name;
  }, [state.name]);
  useLayoutEffect(() => {
    scrollLock.current = true;
    releaseAnchor();
  }, [state.resetScroll, scrollLock, releaseAnchor]);
  useLayoutEffect(() => {
    const saved = scopeScroll.current[state.historyScope];
    releaseAnchor();
    scrollLock.current = saved?.locked ?? true;
    if (messages.current && saved) messages.current.scrollTop = saved.top;
  }, [state.historyScope, scrollLock, releaseAnchor]);
  // Wait for both the scene and the history window to commit. Fixed frame
  // delays can scroll before the requested bubble has actually been mounted.
  useLayoutEffect(() => {
    const pending = pendingReveal.current;
    if (!pending || state.historyLoading) return;
    if (pending.sceneId && pending.sceneId !== state.currentScene.sceneId) { pendingReveal.current = null; return; }
    const message = historyTargetBubble(state.items, timelineItems, pending.seq);
    if (!message) return;
    const target = messageElements.current.get(message.id);
    releaseAnchor();
    scrollLock.current = false;
    if (!target) { historyWindow.reveal(message.id); return; }
    target.scrollIntoView({block:'center', behavior:'instant'});
    setHighlighted(message.id);
    pendingReveal.current = null;
    if (pending.sceneId) bridge.send({type:'beings:history-target-result', sceneId:pending.sceneId, seq:pending.seq, ok:true});
  }, [state.historyLoading, state.currentScene.sceneId, state.items, timelineItems, releaseAnchor, scrollLock, bridge, historyWindow]);
  const openPlace = useCallback(
    (target: import("../shared/lib/navigation").PlaceTarget) =>
      bridge.send({ type: "beings:open-place", ...target }),
    [bridge],
  );
  const [showIntelligentUI, setShowIntelligentUI] = useState(false);
  const [uiExample, setUIExample] = useState<UIExampleId>("bicycle");
  const openExamples = () => {
    if (parent !== window && location.protocol === 'beings:') bridge.send({ type: 'beings:ui-examples-open' });
    else setShowIntelligentUI(true);
  };
  const closeExamples = () => {
    setShowIntelligentUI(false);
    requestAnimationFrame(() => composer.current?.focus());
  };
  const close = () => {
    setPanel(null);
    if (panelReturnsToSettings)
      bridge.send({ type: "beings:settings-route-dismissed" });
    setPanelReturnsToSettings(false);
    composer.current?.focus();
  };
  return (
    <SurfaceContext.Provider value={surfaceContext}>
    <ChatTooltipGroup>
    <CodeClipboard.Provider value={bridge.copyText}>
    <HomeFileAction.Provider value={location.protocol === "beings:" && parent !== window ? requestHomeFilePreview : undefined}>
    <LocalFileAction.Provider value={location.protocol === "beings:" && parent !== window ? requestLocalFilePreview : undefined}>
    <div
      className={`chat-root${parent === window ? " standalone-chat" : ""}${showIntelligentUI ? " has-ui-examples" : ""}`}
      style={
        {
          "--reading-size": `${readingSize}px`,
          "--chat-top-inset": `${topInset}px`,
          "--app-height": viewport ? `${viewport.height}px` : undefined,
          "--app-offset": viewport ? `${viewport.offset}px` : undefined,
      } as CSSProperties
      }
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setSelection(null);
          if (panel) close();
        }
      }}
      {...dropHandlers}
      onPaste={(event) => {
        const files = [...event.clipboardData.items]
          .filter((item) => item.kind === "file")
          .map((item) => item.getAsFile())
          .filter((file): file is File => !!file);
        if (files.length) {
          event.preventDefault();
          runtime.handleFiles(files);
        }
      }}
    >
      {!mobileWeb && <TemperatureGlow items={visibleItems} />}
      <div id="drop-zone" className={dragging ? "active" : ""}>
        松开以添加附件
      </div>
      <div id="app" ref={chatApp} inert={(nativeTouch && panel === 'model') || (showIntelligentUI && narrow)}>
        <header id="header">
          <SbsControl known={state.sbsKnown} enabled={state.sbsEnabled} origin={state.sbsStreamingOrigin} phase={state.sbsActivityPhase}
            showContent={state.showSbsMessages} allScenes={state.historyScope==='all'}
            onVisibility={show=>state.setShowSbsMessages(show)} onToggle={()=>void runtime.toggleSbs()} />
          <button
            id="being-name"
            type="button"
            onClick={() => setPanel("being")}
          >
            {state.name}
          </button>
          <span className="header-spacer" />
          <a
            href="https://beings.town"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-icon"
            title="Beings Town"
            aria-label="Beings Town"
          >
            ⌂
          </a>
          <button
            className="btn-icon"
            type="button"
            onClick={() => setPanel("privacy")}
            aria-label="隐私说明"
          >
            🛡
          </button>
          <button
            id="settings-btn"
            className="btn-icon"
            type="button"
            onClick={() => parent !== window && location.protocol === "beings:" ? bridge.send({ type: "beings:model-settings" }) : setPanel("model")}
            aria-label="模型设置"
          >
            ⚙
          </button>
        </header>
        {parent === window && <div className="chat-history-scope">
          <label className="chat-scope-switch">
            <input type="checkbox" checked={state.historyScope === "all"} disabled={!state.currentScene.sceneId}
              onChange={event => changeScope(event.target.checked ? "all" : "current")} />
            显示全部场景上下文
          </label>
          <span className="chat-scope-caption" title={state.currentScene.sceneId}>
            {state.currentScene.sceneId
              ? state.historyScope === "all" ? `发送到：${currentSceneName}` : currentSceneName
              : "包含未标记场景的历史对话"}
          </span>
        </div>}
        {(() => {
          const viewportProps: ComponentProps<'div'> = {
            id: 'messages', ref: messages, tabIndex: 0, 'aria-label': '对话消息',
            'aria-busy': state.historyLoading || state.historyRefreshing,
            onClickCapture: reader.onClickCapture,
            onWheel: reader.onWheel, onTouchStart: reader.onTouchStart, onTouchMove: reader.onTouchMove,
            onScroll: () => { reader.onScroll(); setSelection(null); if(!state.historyLoading && messages.current && messages.current.scrollTop<Math.max(800,messages.current.clientHeight*1.5) && !scrollLock.current && historyWindow.hasMore)void historyWindow.more(); },
          };
          const before = <>
          {state.historyLoading && <SceneLoading sceneName={currentSceneName} />}
          {!state.historyLoading && state.historyRefreshing && <div className="chat-refresh-overlay"><div className="chat-refresh-status" role="status"><span aria-hidden="true" />正在刷新对话…</div></div>}
          {!state.historyLoading && !state.historyRefreshing && state.historyLoadFailed &&
            !visibleItems.some(item => item.kind === 'message' && item.historySeq && item.text.trim()) && (
            <div className="chat-scope-empty" role="status">
              <span>{visibleItems.length ? '暂时无法更新对话，已保留现有记录。' : '暂时无法读取对话记录。'}</span>
              <button type="button" onClick={() => void runtime.refreshHistory()}>重试读取记录</button>
            </div>
          )}
          {!state.historyLoading && !state.historyRefreshing && !state.historyLoadFailed && !visibleItems.some(item => item.kind === "message") && !state.thinking && (
            <div className="chat-scope-empty" role="status">
              {state.historyScope === "current" ? "当前场景还没有对话。" : "暂无对话记录。"}
              {state.historyScope === "current" && <button type="button" onClick={() => changeScope("all")}>查看所有场景的消息</button>}
            </div>
          )}
          <div className="history-page-control">
            {historyWindow.loading && <div className="history-page-loading" role="status"><span aria-hidden="true" />正在加载更早的消息…</div>}
          </div>
          </>;
          const renderItem = (item: ChatItem, index: number) => {
            const previous = visibleItems[index - 1];
            if (item.kind === 'separator' && item.stopMarker) return (
              <ChatStatusRow key={item.id} title="已停止" tone="stopped" />
            );
            if (item.kind === "separator") return (
              <div
                key={item.id}
                className={item.marker ? "breath-marker" : "time-gap"}
              >
                {item.text}
              </div>
            );
            if (item.kind === "run") return (
              <ChatActivity
                key={item.id}
                run={item}
                showDetails={showReasoning}
                showProgress={progressRuns.has(item.id)}
                superseded={!item.autonomousOrigin && latestRunByScene.get(item.sceneId) !== item.id}
                errorAlreadyShown={previous?.kind === "message" && previous.role === "system" &&
                  previous.sceneId === item.sceneId && previous.text.startsWith("⚠")}
                onOpenSubagents={parent !== window && location.protocol === 'beings:' ? (taskIds, selectedId) => bridge.send({ type: 'beings:subagent-tasks-open', taskIds, selectedId }) : undefined}
                sceneLabel={state.historyScope === "all" ? sceneName(item, state.currentScene, state.sceneNames) : undefined}
              />
            );
            if (attachedNoticeIds.has(item.id)) return null;
            const attachment = hasAttachmentMessage(item);
            const processing = attachment ? attachmentProcessing(item) : null;
            const notices = (item.sourceMessageIds || [item.id]).flatMap(id => bubbleNotices.get(id) || []);
            let text = splitSchedulingHint(attachment ? originalMessageText(item) : item.text).text;
            let mixedMedia = false;
            if (item.role === 'being') {
              if (text.includes('being.image-generation')) {
                const blocks = imageGenerationBlocks(text);
                mixedMedia = blocks.some(block => block.kind === 'receipt');
                text = blocks.filter(block => block.kind === 'text').map(block => block.text).join('\n');
              }
              const files = beingFileBlocks(text);
              if (files.length) {
                mixedMedia = true;
                text = files.filter(block => block.kind === 'text').map(block => block.text).join('\n');
              }
            }
            const info = {
              text: text.trim() && (attachment || !isImageOnlyMarkdown(text)) ? text : '',
              time: item.createdAt,
              fallbackTime: item.timestamp,
            };
            const instant = info.time === undefined ? undefined : new Date(info.time);
            const dateTime = instant && Number.isFinite(instant.getTime()) ? instant.toISOString() : undefined;
            const exactTime = fullMessageTime(info.time, info.fallbackTime);
            const shortTime = exactTime.match(/\d{1,2}:\d{2}/)?.[0];
            return (
              <Fragment key={item.id}>
              {timeGroups.has(item.id)&&item.createdAt!==undefined&&<time className="message-time-divider" dateTime={new Date(item.createdAt).toISOString()}>{messageTimeLabel(item.createdAt)}</time>}
              <div
                ref={(el) => {
                  for (const id of item.sourceMessageIds || [item.id]) {
                    if (el) messageElements.current.set(id, el);
                    else messageElements.current.delete(id);
                  }
                }}
                data-message-id={item.id}
                data-history-seq={item.historySeq}
                data-reply-id={item.replyId}
                className={`message ${item.role}${item.persistedFrom === "partial" ? " message-partial" : ""}${item.consecutive ? " consecutive" : ""}${(highlighted === item.id || item.sourceMessageIds?.includes(highlighted || "")) ? " index-target" : ""}`}
              >
                {item.role === "system" ? <SystemStatusRow item={item}
                  sceneLabel={state.historyScope === "all" ? sceneName(item, state.currentScene, state.sceneNames) : undefined}>
                  <CopyMessage appearance="chat" text={item.text} copy={bridge.copyText} />
                </SystemStatusRow> : <>
                <div className={`meta${item.consecutive ? " time-only" : ""}`}>
                  {state.historyScope === "all" && !isGlobalBeingMessage(item) && <span className="message-scene" title={item.sceneId || "这条历史消息未提供场景标记"}>{sceneName(item, state.currentScene, state.sceneNames)}</span>}
                </div>
                <MessageHoverRow sent={item.role === 'user'}
                  bodyProps={hasExtraActions => ({ className: 'message-bubble-body', tabIndex: 0, role: 'group',
                    'aria-label': `${item.role === 'user' ? '你' : item.label}的消息`, 'aria-haspopup': info.text || hasExtraActions ? 'menu' : undefined,
                    onContextMenu: event => messageMenu.openMenu(event, { ...info, hasExtraActions }),
                    onKeyDown: event => messageMenu.openMenu(event, { ...info, hasExtraActions }),
                  })}
                  mixedMedia={mixedMedia}
                  time={shortTime && <time className="message-hover-time" title={exactTime} dateTime={dateTime}>{shortTime}</time>}
                  copy={info.text && <CopyMessage appearance="chat" text={info.text} copy={bridge.copyText} />}
                  menu={attachmentMenuMessageId === item.id ? messageMenu.attachmentTarget : null}
                  feedback={<div className="message-feedback">
                    {notices.map(notice => <SystemStatusRow key={notice.id} item={notice} inActions />)}
                    {attachment ? <AttachmentMessageStatus message={item} processing={processing} /> : item.retry &&
                      <ChatStatusRow title={item.queueNotice || '消息需要处理'} tone="error" inActions
                        retry={{ label: item.retryLabel || '重试', run: () => void item.retry?.() }} />}
                  </div>}
                  actions={(mediaActions, hasExtraActions) => <>
                      {hasExtraActions && <ChatActionTooltip content="更多消息操作" disabled={activeMenuMessageId === item.id}>
                        <button type="button" className="message-more" aria-label="更多消息操作"
                          aria-haspopup="menu" aria-expanded={activeMenuMessageId === item.id}
                          onClick={event => messageMenu.showMenu(event.currentTarget, { ...info, hasExtraActions }, { more: true })}>
                          <Icon name="chat-more" width="16" height="16" />
                        </button>
                      </ChatActionTooltip>}
                      {mediaActions}
                  </>}>
                    {item.historyContentError && !item.streaming && !item.text.trim() ? <ChatStatusRow
                      title="历史消息内容为空"
                      detail="本地和服务端都没有这条回复的正文，可以重新读取。"
                      tone="error"
                      retry={{ label: '重新读取这条消息', run: () => void runtime.loadHistoryTarget(item.historySeq!, item.sceneId || '', true) }}
                    /> : attachment ? <AttachmentMessageContent message={item} processing={processing} /> : <ImageGenerationAnswer
                      text={item.role === 'being' ? item.text : ''}
                      streaming={item.streaming}
                      endpoint={historyEndpoint}
                      scope={JSON.stringify([item.sceneId || 'global', item.historySeq ?? item.id])}
                      enabled={!mobileWeb}
                    >{(text, blockId) => <ScheduledMessage
                      text={item.role === 'being' ? text : item.text}
                      messageId={item.id}
                      intelligentUI={item.role === "being"}
                      commandLabels={item.role === 'user'}
                      storageKey={JSON.stringify([historyEndpoint || location.origin, state.soul.being_id || state.name, item.sceneId || 'global', item.historySeq ?? item.id]) + (blockId ? `:${blockId}` : '')}
                      onContinue={text => { state.draft = [state.draft.trim(), text].filter(Boolean).join('\n\n'); state.changed(); composer.current?.focus(); }}
                      onEdit={inCurrentScene(item, state.currentScene) ? () => {
                        state.setIntelligentUIEnabled(true);
                        state.setIntelligentUIForMessage(true);
                        requestAnimationFrame(() => composer.current?.focus());
                      } : undefined}
                      onSnapshot={(text, _values, _apps, active) => { state.recordIntelligentUISnapshot(item.sceneId || 'global', text, active); }}
                      streaming={item.streaming}
                      chat
                      onPlace={!keywordNavigation ? undefined : openPlace}
                    />}</ImageGenerationAnswer>}
                </MessageHoverRow>
                </>}
              </div>
              </Fragment>
            );
          };
          return <div {...viewportProps}>{before}{visibleItems.map(renderItem)}</div>;
        })()}
        {document.documentElement.dataset.chatHost === 'desktop' && <>
          <GradualBlur className="chat-edge-blur" position="top"
            height="calc(48px + var(--chat-top-inset, 0px))" strength={0.75} layers={6} autoHide container={messages}
            curve="bezier" exponential={false} tint="var(--chat-edge-tint)" duration={0} zIndex={2} />
          <GradualBlur className="chat-edge-blur" position="bottom"
            height="calc(var(--chat-composer-clearance) + var(--chat-composer-blur-lead))" strength={1} layers={6} autoHide container={messages}
            curve="bezier" exponential={false} tint="var(--chat-edge-tint)" duration={0} zIndex={2} />
        </>}
        {!toastHosted && <Toast message={connectionNotice} />}
        <ChatIndex items={visibleTimeline.map(item=>item.kind==='message' && hasAttachmentMessage(item) ? {...item,text:originalMessageText(item) || '附件消息'} : item)} container={messages} elements={messageElements} scrollLock={scrollLock} clearAnchor={releaseAnchor} highlight={setHighlighted} />
        <div id="composer-dock" ref={composerDock}>
          {!state.historyLoading && <JumpToLatest trimHistory={historyWindow.toLatest} status={reader} container={messages} scrollLock={scrollLock} clearAnchor={releaseAnchor} />}
          {visibleQueue.length > 0 && <ChatTooltipGroup anchorRoot={queueTooltipRoot}><div ref={queueTooltipRoot} className="composer-queue-wrap" data-warm-tooltip-scope>
            <DndContext sensors={queueSensors} collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
              accessibility={{ screenReaderInstructions: { draggable: '按空格键提起，使用上下方向键移动。按空格键放下，按 Esc 取消。' } }}
              onDragEnd={({ active, over }) => {
                if (over && active.id !== over.id && sortableIds.includes(String(over.id))) {
                  void sortableQueue.find(item => item.id === active.id)?.reorderQueued?.(String(over.id));
                }
              }}>
              <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                <div className="composer-queue" role="list" aria-label={`待发送消息，共 ${visibleQueue.length} 条`}>
                  {visibleQueue.map((item, index) => <QueueRow key={item.id} item={item} index={index}
                    reorderable={sortableIds.includes(item.id)} allowInterrupt={canSteer && !state.stopping}
                    onEdit={editingQueued ? undefined : beginQueueEdit} />)}
                </div>
              </SortableContext>
            </DndContext>
          </div></ChatTooltipGroup>}
          <ChatTooltipGroup anchorRoot={composerArea}><div id="input-area" ref={composerArea} data-warm-tooltip-scope data-queue-editing={editingQueued ? '' : undefined}
            onKeyDown={event => {
              if (!editingQueued || event.key !== 'Escape' || event.nativeEvent.isComposing || event.keyCode === 229) return;
              event.preventDefault();
              event.stopPropagation();
              if (!editingQueued.saving) endQueueEdit(editingQueued.item);
            }} onWheel={event => {
              if (event.deltaY >= 0 || !messages.current) return;
              if (event.target instanceof Element && event.target.closest('#pending-files')) return;
              const input = event.target instanceof HTMLElement ? event.target.closest('#input') as HTMLElement | null : null;
              if (input && input.scrollTop > 0) return;
              event.preventDefault();
              messages.current.scrollBy({ top: event.deltaY, behavior: 'auto' });
            }}>
            {!editingQueued && state.intelligentUIForMessage && state.intelligentUITargetTitle && <div className="iui-context-target" role="status"><Icon name="chat-spark" width="16" height="16" /><span title={`修改「${state.intelligentUITargetTitle}」`}>修改「{state.intelligentUITargetTitle}」</span><button type="button" aria-label="取消本条界面修改" data-warm-tooltip="取消本条界面修改" onClick={() => state.setIntelligentUIForMessage(false)}><Icon name="chat-close" width="14" height="14" /></button></div>}
            <div
              id="pending-files"
              className={!editingQueued && state.files.length ? "active" : ""}
              hidden={!!editingQueued}
              role="group"
              aria-label="待发送附件"
            >
              <ChatTooltipGroup anchorRoot={pendingList}><div className="pending-files-list" ref={pendingList} data-warm-tooltip-scope>
                {state.files.map((file, i) => {
                  const preview = pendingImages.find(image => image.file === file)?.src;
                  const mediaType = file.type.split('/', 1)[0];
                  const icon = mediaType === 'audio' ? 'chat-audio' : mediaType === 'image' ? 'chat-image' : 'chat-file';
                  return <div className={`pending-file${preview ? " pending-file-image" : ""}`} key={`${file.name}-${i}`}>
                    <div className="pending-file-content" title={!preview && !file.loading ? `${file.name} · ${formatBytes(file.size)}` : undefined}>
                      {preview ? <button className="pending-file-open" type="button" aria-label={`预览 ${file.name}`}
                        data-warm-tooltip="预览图片" onClick={() => setPendingPreview(file)}>
                        <img className="pending-file-preview" src={preview} alt="" draggable={false} />
                      </button>
                        : <>
                          <Icon className="pending-file-icon" name={icon} width="18" height="18" />
                          <span className="pending-file-label">
                            <FileName name={file.name} />
                            <small className={file.loading ? undefined : 'pending-file-size'} role={file.loading ? 'status' : undefined}>{file.loading ? '正在读取…' : formatBytes(file.size)}</small>
                          </span>
                        </>}
                      <button className="remove" type="button" aria-label={`移除 ${file.name}`} title="" data-warm-tooltip="移除附件" onClick={event => {
                        const list = event.currentTarget.closest('#pending-files');
                        runtime.removePending(i);
                        requestAnimationFrame(() => {
                          const controls = list?.querySelectorAll<HTMLButtonElement>('.pending-file .remove');
                          (controls?.[i] ?? controls?.[i - 1] ?? composer.current)?.focus();
                        });
                      }}>
                        <Icon name="chat-close" width="14" height="14" />
                      </button>
                    </div>
                  </div>;
                })}
              </div></ChatTooltipGroup>
            </div>
            <div id="input-row">
              {!editingQueued && <ComposerAddMenu state={state} onUpload={() => fileInput.current?.click()} onSelect={() => requestAnimationFrame(() => composer.current?.focus())}
               />}
              <ChatComposer
                state={state}
                onExamples={openExamples}
                key={state.currentScene.sceneId || "global"}
                textareaRef={composer}
                id="input"
                rows={1}
                className={state.queued ? "queued" : ""}
                placeholder="消息"
                queueEdit={editingQueued ? { text: editingQueued.text, onChange: text =>
                  setEditingQueued(edit => edit?.item === editingQueued.item && !edit.saving ? { ...edit, text } : edit) } : undefined}
                disabled={editingQueued?.saving}
                aria-label={editingQueued ? "编辑待发消息" : "消息输入框"}
                aria-keyshortcuts={editingQueued ? "Enter Shift+Enter Escape" : isMac ? "Enter Control+Enter Meta+Enter Shift+Enter" : "Enter Control+Enter Shift+Enter"}
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={() => {
                  composing.current = false;
                  compositionEnd.current = Date.now();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp' && !editingQueued && !hasDraft && !event.defaultPrevented &&
                      !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey &&
                      !composing.current && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                    const last = visibleQueue.at(-1);
                    if (last && !last.queueBusy && canEditQueuedMessage(last) && beginQueueEdit(last)) event.preventDefault();
                    return;
                  }
                  if (
                    event.key !== "Enter" ||
                    event.shiftKey ||
                    event.altKey ||
                    composing.current ||
                    event.nativeEvent.isComposing ||
                    event.keyCode === 229 ||
                    Date.now() - compositionEnd.current < 50
                  )
                    return;
                  event.preventDefault();
                  if (event.repeat) return;
                  if (editingQueued) { void saveQueueEdit(); return; }
                  if (!hasDraft) return;
                  const alternate = event.ctrlKey || (isMac && event.metaKey);
                  sendDraft(canChooseFollowUp && !alternate ? 'interrupt' : undefined);
                }}
              />
              {editingQueued ? <div className="composer-queue-edit-actions">
                {editingQueued.item.queueNoticeTone === 'error' && editingQueued.item.queueNotice &&
                  <ErrorIndicator description={editingQueued.item.queueNotice} />}
                <button type="button" className="btn-icon" data-queue-save aria-busy={editingQueued.saving}
                  aria-label={editingQueued.saving ? '正在保存修改' : '保存修改'} data-warm-tooltip="保存修改" data-warm-tooltip-shortcut="↵"
                  disabled={editingQueued.saving || !editingQueued.text.trim()} onClick={() => void saveQueueEdit()}>
                  <Icon name={editingQueued.saving ? 'chat-busy' : 'chat-check'} width="18" height="18" />
                </button>
              </div> :
                <ComposerSend label={sendLabel} action={action} mobileWeb={mobileWeb}
                  disabled={state.stopping || (action !== 'stop' && (!hasDraft || readingFiles))} stopping={state.stopping}
                  alternate={canChooseFollowUp ? {
                    label: '排队', shortcut: isMac ? '⌘ ↵' : 'Ctrl ↵', key: isMac ? 'Meta+Enter Control+Enter' : 'Control+Enter',
                    run: () => { sendDraft(); composer.current?.focus(); },
                  } : undefined}
                  onSubmit={() => {
                    if (action === 'stop') void runtime.stopCurrentTurn();
                    else sendDraft(action === 'steer' ? 'interrupt' : undefined);
                    composer.current?.focus();
                  }} />
              }
            </div>
            <input
              ref={fileInput}
              type="file"
              id="file-input"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files) runtime.handleFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div></ChatTooltipGroup>
        </div>
      </div>
      {activePendingImage &&
        <ImageViewer src={activePendingImage.src} name={activePendingImage.name}
          onClose={() => setPendingPreview(null)} actions={null}
          navigation={pendingImages.length > 1 ? {
            index: pendingImageIndex,
            total: pendingImages.length,
            items: pendingImages,
            select: index => setPendingPreview(pendingImages[index].file),
            previous: () => setPendingPreview(pendingImages[pendingImageIndex - 1].file),
            next: () => setPendingPreview(pendingImages[pendingImageIndex + 1].file),
          } : undefined} />}
      {showIntelligentUI && <IntelligentUIExamples example={uiExample} overlay={narrow} onSelect={setUIExample} onClose={closeExamples}
        onContinue={text => { state.draft = text; state.changed(); closeExamples(); }}/>}
      <ChatSettings
        mobilePage={nativeTouch}
        state={state}
        runtime={runtime}
        open={panel === "model"}
        close={close}
        back={panelReturnsToSettings ? () => bridge.send({ type: "beings:return-settings" }) : undefined}
      />
      <ChatInfoPanels state={state} panel={panel} close={close} />
      {messageMenu.menu}
      {!nativeTouch && <EditContextMenu appearance="chat" edit={bridge.edit} onOpenChange={setContextMenuOpen} />}
      <button
        id="scene-selection-action"
        type="button"
        hidden={!selection || contextMenuOpen || messageMenu.isOpen || nativeTouch}
        style={
          selection ? { left: selection.left, top: selection.top } : undefined
        }
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => { if(selection)addToChat(selection.text); }}
        aria-keyshortcuts={isMac ? 'Meta+L' : 'Control+L'}
      >
        添加到聊天 <kbd aria-hidden="true">{isMac?'⌘L':'Ctrl L'}</kbd>
      </button>
    </div>
    </LocalFileAction.Provider>
    </HomeFileAction.Provider>
    </CodeClipboard.Provider>
    </ChatTooltipGroup>
    </SurfaceContext.Provider>
  );
}

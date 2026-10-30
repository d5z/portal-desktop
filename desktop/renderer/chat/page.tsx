import { LocalFileAction, requestLocalFilePreview } from '../shared/components/local-file-link';
import { PermissionIcon, choicesFor } from '../shared/components/permission-picker';
import { SbsControl } from "../shared/components/sbs-control";
import {useHistoryWindow} from './hooks/use-history-window';
import { AttachmentMessageContent, hasAttachmentMessage, originalMessageText } from "./components/message-content";
import { ImageGenerationAnswer } from './components/image-generation';
import { SurfaceContext } from '../shared/intelligent-ui/surface-view';
import { SurfaceTimeline } from '../shared/intelligent-ui/surfaces';
import { useMessageScroll } from "./hooks/use-message-scroll";
import { IntelligentUIExamples, type UIExampleId } from "./components/intelligent-ui-examples";
import { ConversationSearch, searchEntries } from "./services/conversation-search";
import { replyBubbles, historyTargetBubble } from "./models/reply-bubbles";
import { ScheduledMessage } from './components/scheduling';
import { splitSchedulingHint, withScheduling } from './models/scheduling';
import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ChatState,
  type ChatRuntime,
  type ChatPanel,
  type Message,
  type RuntimeOptions,
} from "./models/chat";
import { inCurrentScene, isGlobalBeingMessage, sceneItems, sceneName, type HistoryScope } from "./models/scenes";
import { useModel } from "../shared/hooks/use-model";
import { CodeClipboard } from "../shared/components/markdown";
import { type ComposerHandle } from "../shared/components/rich-composer";
import { ChatComposer } from "./components/composer";
import { ComposerAddMenu } from './components/composer-add-menu';
import { canUseComposerCommand, parseComposerCommands } from './models/composer-commands';
import { CopyMessage } from '../shared/components/copy-message';
import { TemperatureGlow, ChatActivity } from "./components/messages";
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
      <div role="alert" className="chat-error">
        聊天页面加载未完成。
        <button type="button" onClick={() => location.reload()}>
          重新加载
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export function ChatApp({ connection, keywordNavigation = true, mobileWeb = false }: { connection?: RuntimeOptions['connection']; keywordNavigation?: boolean; mobileWeb?: boolean } = {}) {
  const session = useChatSession(connection);
  return (
    <ChatErrorBoundary>
      {session ? <ChatView {...session} keywordNavigation={keywordNavigation} mobileWeb={mobileWeb} /> : <div role="status">正在连接…</div>}
    </ChatErrorBoundary>
  );
}
let activeQueueDragId: string | null = null;
let activeQueueTargetId: string | null = null;
function QueueRow({ item, index, allowInterrupt, onEdit, onReorder }: { item: Message; index: number; allowInterrupt: boolean; onEdit: (item: Message) => void; onReorder: (sourceId: string, targetId: string) => void }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const previousRect = useRef<DOMRect | null>(null);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const nextRect = row.getBoundingClientRect();
    const previous = previousRect.current;
    if (previous && Math.abs(previous.top - nextRect.top) > 1) {
      row.animate([{ transform: `translateY(${previous.top - nextRect.top}px)` }, { transform: 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    previousRect.current = nextRect;
  }, [index]);
  const clearDrag = () => { activeQueueDragId = null; activeQueueTargetId = null; rowRef.current?.classList.remove('dragging'); };
  return <div ref={rowRef} className="composer-queue-item" key={item.id} data-queue-id={item.id} draggable onDragStart={event => {
    if (!(event.target as HTMLElement).closest('.composer-queue-drag-handle')) { event.preventDefault(); return; }
    activeQueueDragId = item.id; activeQueueTargetId = item.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.id);
    const ghost = document.createElement('span'); ghost.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0'; document.body.appendChild(ghost);
    event.dataTransfer.setDragImage(ghost, 0, 0); requestAnimationFrame(() => ghost.remove());
    rowRef.current?.classList.add('dragging');
  }} onDragOver={event => {
    event.preventDefault(); event.dataTransfer.dropEffect = 'move';
    const sourceId = activeQueueDragId || event.dataTransfer.getData('text/plain');
    if (!sourceId || sourceId === item.id || sourceId === activeQueueTargetId) return;
    activeQueueTargetId = item.id;
    onReorder(sourceId, item.id);
  }} onDrop={event => { event.preventDefault(); clearDrag(); }} onDragEnd={clearDrag}>
    <span className="composer-queue-drag-handle" title="拖动排序" aria-label="拖动排序"><svg className="composer-queue-icon" width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true"><circle cx="4" cy="4" r="1.3"/><circle cx="10" cy="4" r="1.3"/><circle cx="4" cy="10" r="1.3"/><circle cx="10" cy="10" r="1.3"/><circle cx="4" cy="16" r="1.3"/><circle cx="10" cy="16" r="1.3"/></svg></span>
    <span className="composer-queue-content" title={item.text}>{item.text}</span>
    {item.queueNotice && <span className="composer-queue-notice" role="status" title={item.queueNotice} aria-label={item.queueNotice}>!</span>}
    <button className="composer-queue-text-action" type="button" aria-label={`编辑排队消息：${item.text}`} title="在输入框编辑" onClick={() => onEdit(item)} disabled={!item.editQueued}>编辑</button>
    {item.retry && <button type="button" onClick={() => void item.retry?.()}>{item.retryLabel}</button>}
    <button className="composer-queue-steer" type="button" aria-label="调整方向" disabled={!allowInterrupt || !item.canInterruptQueued} title="调整方向：立即打断并发送这条消息" onClick={() => void item.interruptQueued?.()}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5v5a3 3 0 0 0 3 3h13m-5-5 5 5-5 5" /></svg><span>调整方向</span></button>
    <button type="button" title="删除排队消息" aria-label={`取消排队：${item.text}`} onClick={() => item.cancelQueued?.()}>×</button>
  </div>;
}
function ChatView({
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
  const [nativeTouch, setNativeTouch] = useState(() => mobileWeb && matchMedia('(max-width: 760px), (hover: none) and (pointer: coarse)').matches);
  const [editingQueued, setEditingQueued] = useState<Message | null>(null);
  useEffect(() => {
    if (!mobileWeb) return;
    const media = matchMedia('(max-width: 760px), (hover: none) and (pointer: coarse)');
    const change = () => setNativeTouch(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, [mobileWeb]);
  const timelineItems = replyBubbles(sceneItems(withScheduling(state.items.filter(item => item.kind !== "message" || !item.queued || !!item.attachmentViews?.length || !!item.attachmentUploads?.length), state.sceneTasks), state.historyScope, state.currentScene, state.showSbsMessages));
  const historyWindow=useHistoryWindow(state.historyLoading ? [] : timelineItems,JSON.stringify([state.historyScope,state.currentScene.sceneId,state.showSbsMessages]),before=>runtime.loadOlderHistory(before));
  const visibleItems=historyWindow.items;
  const pendingReveal=useRef<{seq:number;sceneId?:string}|null>(null);
  const queuedMessages = state.items.filter((item): item is Message => item.kind === 'message' && !!item.queued && item.sceneId === state.currentScene.sceneId && !hasAttachmentMessage(item));
  useEffect(() => {
    if (editingQueued && !queuedMessages.includes(editingQueued)) setEditingQueued(null);
  }, [editingQueued, queuedMessages]);
  useLayoutEffect(() => {
    if (!editingQueued) return;
    const frame = requestAnimationFrame(() => composer.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [editingQueued]);
  const surfaceTimeline = useRef(new SurfaceTimeline());
  const surfaceScope = (sceneId?: string) => JSON.stringify([new URLSearchParams(location.search).get('history_scope') || location.origin, state.soul.being_id || state.name, sceneId || 'global']);
  const surfaceBlocks = surfaceTimeline.current.build(visibleItems.filter((item): item is Message => item.kind === 'message' && item.role === 'being').map(item => ({
    id: item.id, identity: String(item.historySeq ?? item.id), scope: surfaceScope(item.sceneId), text: splitSchedulingHint(item.text).text, streaming: item.streaming,
  })));
  const surfaceContext = useMemo(() => ({ blocks: surfaceBlocks }), [surfaceBlocks]);
  const currentSceneName = sceneName(state.currentScene, state.currentScene);
  const messages = useRef<HTMLDivElement>(null),
    composer = useRef<ComposerHandle>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const messageElements = useRef(new Map<string, HTMLDivElement>());
  const reader = useMessageScroll(visibleItems, messages, messageElements);
  const { scrollLock, releaseAnchor } = reader;
  const scopeScroll = useRef<Partial<Record<HistoryScope, { top: number; locked: boolean }>>>({});
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const queueShortcut = isMac ? "⌘ Enter / Ctrl Enter" : "Ctrl Enter";
  const sendLabel = editingQueued ? "保存修改" : state.sendWillQueue ? (state.canInterruptQueue ? "立即打断并发送" : "加入队列") : "发送消息";
  const showStop = (state.streaming || state.attachmentPending) && !state.draft.trim() && state.files.length === 0;
  const configureSubagent = parent !== window && location.protocol === 'beings:' ? () => bridge.send({ type: 'beings:subagent-settings' }) : undefined;
  function sendDraft(mode?: "interrupt") {
    if (state.stopping) return;
    if (!parseComposerCommands(state.draft).commands.every(command => canUseComposerCommand(command, state, configureSubagent))) return;
    if (editingQueued) {
      const text = state.draft.trim();
      if (!text) return;
      void Promise.resolve(editingQueued.editQueued?.(text)).then(() => { state.draft = ""; state.changed(); setEditingQueued(null); composer.current?.focus(); });
      return;
    }
    releaseAnchor();
    scrollLock.current = true;
    void runtime.send(state.draft, null, { mode });
  }
  function changeScope(scope: HistoryScope) {
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
  }
  const dragDepth = useRef(0),
    composing = useRef(false),
    compositionEnd = useRef(0);
  const [dragging, setDragging] = useState(false),
    [highlighted, setHighlighted] = useState<string | null>(null),
    [panel, setPanel] = useState<ChatPanel>(null),
    [panelReturnsToSettings, setPanelReturnsToSettings] = useState(false);
  useEffect(() => {
    const reset=()=>{dragDepth.current=0;setDragging(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')reset();};
    const hidden=()=>{if(document.hidden)reset();};
    const released=(event:PointerEvent)=>{if(event.buttons===0 && dragDepth.current)reset();};
    window.addEventListener('blur',reset);
    window.addEventListener('pointermove',released,true);
    window.addEventListener('dragend',reset,true);
    window.addEventListener('drop',reset,true);
    window.addEventListener('pointerup',reset,true);
    window.addEventListener('keydown',escape,true);
    document.addEventListener('visibilitychange',hidden);
    reset();
    return()=>{
      window.removeEventListener('blur',reset);window.removeEventListener('pointermove',released,true);window.removeEventListener('dragend',reset,true);
      window.removeEventListener('drop',reset,true);window.removeEventListener('pointerup',reset,true);
      window.removeEventListener('keydown',escape,true);document.removeEventListener('visibilitychange',hidden);
    };
  },[state.currentScene.sceneId,state.historyScope]);
  const [readingSize, setReadingSize] = useState(16);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    new URLSearchParams(location.search).get("theme") === "dark"
      ? "dark"
      : "light",
  );
  const [viewport, setViewport] = useState({ height: innerHeight, offset: 0, width: innerWidth });
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [subagentEnabling, setSubagentEnabling] = useState(false);
  const [subagentEnableFailed, setSubagentEnableFailed] = useState(false);
  const [selection, setSelection] = useState<{
    id: string;
    text: string;
    role: "user" | "being";
    left: number;
    top: number;
  } | null>(null);
  async function enableSubagent() {
    if (subagentEnabling) return;
    setSubagentEnabling(true);
    setSubagentEnableFailed(false);
    const ok = await bridge.enableSubagent();
    if (!ok) setSubagentEnableFailed(true);
    setSubagentEnabling(false);
  }
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
  }, [bridge, runtime]);
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
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();
        event.stopPropagation();
        bridge.send({ type: "beings:plugin-commands" });
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        bridge.send({ type: "beings:chat-search" });
      } else if (event.key === ",") {
        event.preventDefault();
        event.stopPropagation();
        bridge.send({ type: "beings:open-settings" });
      }
    };
    // The chat is an iframe. Capture here so its inputs and panels cannot
    // swallow desktop-level shortcuts before they reach the React root.
    document.addEventListener("keydown", shortcut, true);
    return () => document.removeEventListener("keydown", shortcut, true);
  }, [bridge]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    document.title = "Loom · " + state.name;
  }, [state.name]);
  useEffect(() => {
    const resize = () =>
      setViewport({
        height: visualViewport?.height || innerHeight,
        width: innerWidth,
        offset: visualViewport?.offsetTop || 0,
      });
    resize();
    window.addEventListener("resize", resize);
    visualViewport?.addEventListener("resize", resize);
    visualViewport?.addEventListener("scroll", resize);
    return () => {
      window.removeEventListener("resize", resize);
      visualViewport?.removeEventListener("resize", resize);
      visualViewport?.removeEventListener("scroll", resize);
    };
  }, []);
  useLayoutEffect(() => {
    scrollLock.current = true;
    releaseAnchor();
  }, [state.resetScroll]);
  useLayoutEffect(() => {
    const saved = scopeScroll.current[state.historyScope];
    releaseAnchor();
    scrollLock.current = saved?.locked ?? true;
    if (messages.current && saved) messages.current.scrollTop = saved.top;
  }, [state.historyScope]);
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
  });
  useEffect(() => {
    const readSelection = () => {
      const selected = window.getSelection();
      if (
        !selected ||
        selected.isCollapsed ||
        !selected.anchorNode ||
        !selected.focusNode ||
        !selected.toString().trim()
      ) {
        setSelection(null);
        return;
      }
      for (const [id, el] of messageElements.current) {
        if (
          !el.contains(selected.anchorNode) ||
          !el.contains(selected.focusNode)
        )
          continue;
        const item = state.items.find((item) => item.id === id);
        if (
          item?.kind !== "message" ||
          (item.role !== "user" && item.role !== "being")
        )
          break;
        const text = selected.toString().trim(),
          rect = selected.getRangeAt(0).getBoundingClientRect();
        setSelection({
          id,
          role: item.role,
          text:
            text.length > 2000 ? text.slice(0, 2000) + "\n[引用已截取]" : text,
          left: Math.max(8, Math.min(rect.left, innerWidth - 140)),
          top: Math.max(8, Math.min(rect.bottom + 6, innerHeight - 44)),
        });
        return;
      }
      setSelection(null);
    };
    document.addEventListener("selectionchange", readSelection);
    return () => document.removeEventListener("selectionchange", readSelection);
  }, [state]);
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
  const formatSize = (bytes: number) =>
    bytes < 1024
      ? `${bytes}B`
      : bytes < 1048576
        ? `${(bytes / 1024).toFixed(1)}KB`
        : `${(bytes / 1048576).toFixed(1)}MB`;
  return (
    <SurfaceContext.Provider value={surfaceContext}>
    <CodeClipboard.Provider value={bridge.copyText}>
    <LocalFileAction.Provider value={location.protocol === "beings:" && parent !== window ? requestLocalFilePreview : undefined}>
    <div
      className={`chat-root${parent === window ? " standalone-chat" : ""}${showIntelligentUI ? " has-ui-examples" : ""}`}
      style={
        {
          "--reading-size": `${readingSize}px`,
          "--app-height": `${viewport.height}px`,
          "--app-offset": `${viewport.offset}px`,
      } as CSSProperties
      }
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setSelection(null);
          if (panel) close();
        }
      }}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!dragDepth.current) return;
        event.preventDefault();
        if (--dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragging(false);
        }
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        runtime.handleFiles(event.dataTransfer.files);
      }}
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
      <div id="app" inert={(nativeTouch && panel === 'model') || (showIntelligentUI && viewport.width <= 900)}>
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
        <div
          id="messages"
          ref={messages}
          tabIndex={0}
          aria-label="对话消息"
          aria-busy={state.historyLoading || state.historyRefreshing}
          onWheel={reader.onWheel}
          onTouchMove={reader.onTouchMove}
          onScroll={() => { reader.onScroll(); setSelection(null); if(!state.historyLoading && messages.current && messages.current.scrollTop<Math.max(800,messages.current.clientHeight*1.5) && !scrollLock.current && historyWindow.hasMore)void historyWindow.more(); }}
        >
          {state.historyLoading && <SceneLoading sceneName={currentSceneName} />}
          {!state.historyLoading && state.historyRefreshing && <div className="chat-refresh-overlay"><div className="chat-refresh-status" role="status"><span aria-hidden="true" />正在刷新对话…</div></div>}
          {!state.historyLoading && !state.historyRefreshing && !visibleItems.some(item => item.kind === "message") && !state.thinking && (
            <div className="chat-scope-empty">
              {state.historyScope === "current" ? "当前场景还没有对话。" : "暂无对话记录。"}
              {state.historyScope === "current" && <button type="button" onClick={() => changeScope("all")}>显示全部场景上下文</button>}
            </div>
          )}
          <div className="history-page-control">
            {historyWindow.loading && <div className="history-page-loading" role="status"><span aria-hidden="true" />正在加载更早的消息…</div>}
          </div>
          {visibleItems.map((item) =>
            item.kind === "separator" ? (
              <div
                key={item.id}
                className={item.marker ? "breath-marker" : "time-gap"}
              >
                {item.text}
              </div>
            ) : item.kind === "run" ? (
              <ChatActivity
                key={item.id}
                run={item}
                sceneLabel={state.historyScope === "all" ? sceneName(item, state.currentScene, state.sceneNames) : undefined}
              />
            ) : (
              <div
                key={item.id}
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
                <div className={`meta${item.consecutive ? " time-only" : ""}`}>
                  {!item.consecutive && <span>{item.label} · </span>}
                  <span className="message-time-actions">
                    <time>{item.timestamp}</time>
                  </span>
                  {item.persistedFrom === "partial" && <span className="message-scene">已中断</span>}
                  {(state.historyScope === "all" || isGlobalBeingMessage(item)) && <span className="message-scene" title={isGlobalBeingMessage(item) ? "Being 发出的无场景消息，在各场景共享显示；包含自主醒来消息" : item.sceneId || "这条历史消息未提供场景标记"}>{isGlobalBeingMessage(item) ? "全局消息" : sceneName(item, state.currentScene, state.sceneNames)}</span>}
                </div>
                <div className="message-bubble-row">
                  <div className="message-bubble-body">
                    {hasAttachmentMessage(item) ? <AttachmentMessageContent message={item} /> : <ImageGenerationAnswer
                      text={item.role === 'being' ? item.text : ''}
                      streaming={item.streaming}
                      endpoint={new URLSearchParams(location.search).get('history_scope') || ''}
                      scope={JSON.stringify([item.sceneId || 'global', item.historySeq ?? item.id])}
                      enabled={!mobileWeb}
                    >{(text, blockId) => <ScheduledMessage
                      text={item.role === 'being' ? text : item.text}
                      messageId={item.id}
                      intelligentUI={item.role === "being"}
                      commandLabels={item.role === 'user'}
                      storageKey={JSON.stringify([new URLSearchParams(location.search).get('history_scope') || location.origin, state.soul.being_id || state.name, item.sceneId || 'global', item.historySeq ?? item.id]) + (blockId ? `:${blockId}` : '')}
                      onContinue={text => { state.draft = [state.draft.trim(), text].filter(Boolean).join('\n\n'); state.changed(); composer.current?.focus(); }}
                      onEdit={inCurrentScene(item, state.currentScene) ? () => {
                        state.setIntelligentUIEnabled(true);
                        state.setIntelligentUIForMessage(true);
                        requestAnimationFrame(() => composer.current?.focus());
                      } : undefined}
                      onSnapshot={(text, _values, _apps, active) => { state.recordIntelligentUISnapshot(item.sceneId || 'global', text, active); }}
                      streaming={item.streaming}
                      chat
                      onPlace={item.role === "system" || !keywordNavigation ? undefined : openPlace}
                    />}</ImageGenerationAnswer>}
                  </div>
                  <CopyMessage text={splitSchedulingHint(originalMessageText(item)).text} copy={bridge.copyText} />
                </div>
                {hasAttachmentMessage(item) ? item.retry && <div className="attachment-message-actions">
                  {item.queueNotice && <span className="attachment-error" role="alert">{item.queueNotice}</span>}
                  {item.retry && <button className="attachment-retry-action" type="button" onClick={()=>void item.retry?.()}>{item.retryLabel}</button>}
                  {item.queued && item.cancelQueued && <button className="attachment-dismiss-action" type="button" aria-label="移除失败附件" onClick={()=>void item.cancelQueued?.()}>移除</button>}
                </div> : <>
                  {item.queueNotice && !item.queued && item.retry && <p className="attachment-error" role="alert">{item.queueNotice}</p>}
                  {item.retry && <button className="retry-btn" type="button" onClick={()=>void item.retry?.()}>{item.retryLabel}</button>}
                </>}
              </div>
            ),
          )}
        </div>
        <div
          id="reconnect-banner"
          className={state.banner ? "active" : ""}
          role="status"
        >
          {state.banner}
        </div>
        <ChatIndex items={visibleItems.map(item=>item.kind==='message' && hasAttachmentMessage(item) ? {...item,text:originalMessageText(item)} : item)} container={messages} elements={messageElements} scrollLock={scrollLock} clearAnchor={releaseAnchor} highlight={setHighlighted} />
        {queuedMessages.length > 0 && <div className="composer-queue-wrap">
          <div className="composer-queue" aria-label={`待发送消息，共 ${queuedMessages.length} 条`}>
            {queuedMessages.map((item, index) => <QueueRow item={item} index={index} allowInterrupt={state.canInterruptQueue && !state.stopping} onEdit={item => { state.draft = item.text; state.changed(); setEditingQueued(item); }} onReorder={(sourceId, targetId) => { const source = queuedMessages.find(candidate => candidate.id === sourceId); void source?.reorderQueued?.(targetId); }} key={item.id} />)}
          </div>
        </div>}
        <div id="input-area">
          {state.intelligentUIForMessage && state.intelligentUITargetTitle && <div className="iui-context-target" role="status"><span>修改「{state.intelligentUITargetTitle}」<small>将携带原界面和当前选择</small></span><button type="button" aria-label="取消本条界面修改" onClick={() => state.setIntelligentUIForMessage(false)}>×</button></div>}
          {!state.historyLoading && <JumpToLatest container={messages} scrollLock={scrollLock} clearAnchor={releaseAnchor} />}
          <div
            id="pending-files"
            className={state.files.length ? "active" : ""}
          >
            {state.files.map((file, i) => (
              <div className="pending-file" key={`${file.name}-${i}`}>
                {/^image\/(png|jpeg|gif|webp)$/.test(file.type) && (file.previewUrl || file.base64) ? (
                  <img
                    className="pending-file-preview"
                    src={file.previewUrl || `data:${file.type};base64,${file.base64}`}
                    alt=""
                  />
                ) : (
                  <span className="pending-file-icon" aria-hidden="true">
                    {file.type.startsWith("image/") ? "🖼️" : "📄"}
                  </span>
                )}
                <span>
                  <strong>{file.name}</strong>
                  <small>{formatSize(file.size)} · {file.loading ? '正在读取…' : '待发送'}</small>
                </span>{" "}
                <button
                  className="remove"
                  type="button"
                  aria-label={`移除 ${file.name}`}
                  onClick={() => runtime.removePending(i)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {editingQueued && <div className="composer-editing-queue" role="status"><span>正在编辑排队消息</span><button type="button" onClick={() => { state.draft = ""; state.changed(); setEditingQueued(null); composer.current?.focus(); }}>取消编辑</button></div>}
          <div id="input-row">
            {parent !== window && location.protocol === 'beings:' && <button type="button" className="btn-icon permission-quick-trigger" data-mode={state.permissionMode} title={`工作权限 · ${choicesFor(state.permissionMode ?? 'auto-review').find(choice => choice.value === state.permissionMode)?.title ?? '加载中'}`} aria-label="快捷设置工作权限" aria-haspopup="menu" aria-expanded={state.permissionMenuOpen} onClick={event => {
              const rect = event.currentTarget.getBoundingClientRect();
              bridge.send({ type: 'beings:permission-settings', anchor: { left: rect.left, top: rect.top, bottom: rect.bottom } });
            }}><PermissionIcon kind={choicesFor(state.permissionMode ?? 'auto-review').find(choice => choice.value === state.permissionMode)?.icon}/><span>{choicesFor(state.permissionMode ?? 'auto-review').find(choice => choice.value === state.permissionMode)?.title ?? '权限'}</span><svg className="permission-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button>}
            <ChatComposer
              state={state}
              onExamples={openExamples}
              onConfigureSubagent={configureSubagent}
              key={state.currentScene.sceneId || "global"}
              textareaRef={composer}
              id="input"
              rows={1}
              className={state.queued ? "queued" : ""}
              placeholder="说点什么，或输入 / 选择功能…"
              aria-label="message input"
              aria-keyshortcuts={isMac ? "Enter Control+Enter Meta+Enter Shift+Enter" : "Enter Control+Enter Shift+Enter"}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
                compositionEnd.current = Date.now();
              }}
              onKeyDown={(event) => {
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
                sendDraft(event.ctrlKey || (isMac && event.metaKey) ? undefined : "interrupt");
              }}
            />
            <ComposerAddMenu state={state} onUpload={() => fileInput.current?.click()} onExamples={openExamples} onSelect={() => requestAnimationFrame(() => composer.current?.focus())}
              onConfigureSubagent={configureSubagent}
              onEnableSubagent={parent !== window && location.protocol === 'beings:' ? () => { void enableSubagent(); } : undefined}
              subagentEnabling={subagentEnabling} subagentEnableFailed={subagentEnableFailed}/>
            {state.sendWillQueue && !editingQueued && (state.draft.trim() || state.files.length > 0) && <div className="composer-queue-hint"><button type="button" title={`加入队列（${queueShortcut}）`} aria-label="加入队列" disabled={state.stopping} onClick={() => sendDraft()}>排队 <span aria-hidden="true">{isMac ? "⌘ ↵" : "Ctrl ↵"}</span></button></div>}
            <button
              className={`btn-icon${showStop ? " stop" : ""}`}
              id="send-btn"
              type="button"
              title={showStop ? "停止处理" : `${sendLabel}（Enter）；${queueShortcut} 排队，Shift Enter 换行`}
              aria-label={state.stopping ? "正在停止" : showStop ? "停止处理" : sendLabel}
              disabled={state.stopping}
              aria-busy={state.stopping}
              onClick={() => {
                if (showStop) void runtime.stopCurrentTurn();
                else sendDraft("interrupt");
                composer.current?.focus();
              }}
            >
              ↵
            </button>
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
        </div>
      </div>
      {showIntelligentUI && <IntelligentUIExamples example={uiExample} overlay={viewport.width <= 900} onSelect={setUIExample} onClose={closeExamples}
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
      {!nativeTouch && <EditContextMenu edit={bridge.edit} onOpenChange={setContextMenuOpen} />}
      <button
        id="scene-selection-action"
        type="button"
        hidden={!selection || parent === window || contextMenuOpen || nativeTouch}
        style={
          selection ? { left: selection.left, top: selection.top } : undefined
        }
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (selection) {
            const { id, text, role } = selection;
            bridge.send({ type: "beings:scene-select", id, text, role });
          }
          setSelection(null);
          window.getSelection()?.removeAllRanges();
        }}
      >
        一起看这段 ↗
      </button>
    </div>
    </LocalFileAction.Provider>
    </CodeClipboard.Provider>
    </SurfaceContext.Provider>
  );
}

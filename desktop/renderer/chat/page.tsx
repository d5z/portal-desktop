import { ScheduledMessage } from './components/scheduling';
import { splitSchedulingHint, withScheduling } from './models/scheduling';
import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ChatState, type ChatRuntime, type ChatPanel, type RuntimeOptions } from "./models/chat";
import { inCurrentScene, sceneItems, sceneName, type HistoryScope } from "./models/scenes";
import { useModel } from "../shared/hooks/use-model";
import { Markdown } from "../shared/components/markdown";
import { CopyMessage } from '../shared/components/copy-message';
import { TemperatureGlow, ChatActivity } from "./components/messages";
import { ChatSettings } from "./components/settings";
import { ChatInfoPanels } from "./components/panels";
import { EditContextMenu } from "../shared/components/context-menu";
import {
  ChatIndex,
  ChatPlaces,
  type ChatIndexHandle,
} from "./components/navigation";
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
  useEffect(() => {
    if (!mobileWeb) return;
    const media = matchMedia('(max-width: 760px), (hover: none) and (pointer: coarse)');
    const change = () => setNativeTouch(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, [mobileWeb]);
  const visibleItems = sceneItems(withScheduling(state.items, state.sceneTasks), state.historyScope, state.currentScene);
  const currentSceneName = sceneName(state.currentScene, state.currentScene);
  const showActivity = state.historyScope === "all" || inCurrentScene(state.activeScene, state.currentScene);
  const messages = useRef<HTMLDivElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const messageElements = useRef(new Map<string, HTMLDivElement>()),
    index = useRef<ChatIndexHandle>(null),
    scrollLock = useRef(true);
  const scopeScroll = useRef<Partial<Record<HistoryScope, { top: number; locked: boolean }>>>({});
  function changeScope(scope: HistoryScope) {
    if (scope === state.historyScope || (scope === "current" && !state.currentScene.sceneId)) return;
    if (messages.current) scopeScroll.current[state.historyScope] = { top: messages.current.scrollTop, locked: scrollLock.current };
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
  const [channels, setChannels] = useState<string[]>([]),
    [readingSize, setReadingSize] = useState(16);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    new URLSearchParams(location.search).get("theme") === "dark"
      ? "dark"
      : "light",
  );
  const [viewport, setViewport] = useState({ height: innerHeight, offset: 0 });
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [selection, setSelection] = useState<{
    id: string;
    text: string;
    role: "user" | "being";
    left: number;
    top: number;
  } | null>(null);
  useEffect(() => {
    bridge.start(runtime, {
      panel: (value, returnToSettings = false) => {
        setPanel((current) => (current === value ? null : value));
        setPanelReturnsToSettings(Boolean(value && returnToSettings));
      },
      theme: setTheme,
      reading: setReadingSize,
      activity: setChannels,
      search: () => index.current?.publish(),
      jump: (id) => index.current?.jump(id),
      dismissIndexPreview: () => index.current?.dismissPreview(),
      focus: () => composer.current?.focus(),
      scope: changeScope,
    });
    void runtime.start();
    composer.current?.focus();
  }, [bridge, runtime]);
  useEffect(() => {
    bridge.send({ type: "beings:history-scope-state", scope: state.historyScope, sceneId: state.currentScene.sceneId });
  }, [bridge, state.historyScope, state.currentScene.sceneId]);
  useEffect(() => {
    if (mobileWeb) bridge.send({ type: 'beings:chat-panel', panel });
  }, [bridge, mobileWeb, panel]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() === "f") {
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
  }, [state.resetScroll]);
  useLayoutEffect(() => {
    const saved = scopeScroll.current[state.historyScope];
    scrollLock.current = saved?.locked ?? true;
    if (messages.current && saved) messages.current.scrollTop = saved.top;
  }, [state.historyScope]);
  useLayoutEffect(() => {
    const el = composer.current;
    if (!el) return;
    const style = getComputedStyle(el),
      line = parseFloat(style.lineHeight) || 22;
    const max =
      line * (matchMedia("(max-width: 640px)").matches ? 4 : 6) +
      (parseFloat(style.paddingTop) || 0) +
      (parseFloat(style.paddingBottom) || 0);
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, max) + "px";
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [state.draft, viewport.height]);
  useLayoutEffect(() => {
    if (messages.current && scrollLock.current)
      messages.current.scrollTop = messages.current.scrollHeight;
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
    <div
      className={`chat-root${parent === window ? " standalone-chat" : ""}`}
      style={
        {
          "--reading-size": `${readingSize}px`,
          "--app-height": `${viewport.height}px`,
          "--app-offset": `${viewport.offset}px`,
      } as CSSProperties
      }
      onPointerMove={() => bridge.send({ type: "beings:sidebar-pointer-away" })}
      onPointerDown={() => bridge.send({ type: "beings:sidebar-dismiss" })}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          if (!event.defaultPrevented && !panel && !selection && !document.querySelector("dialog[open]")) {
            bridge.send({ type: "beings:sidebar-dismiss" });
          }
          setSelection(null);
          if (panel) close();
        }
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragLeave={(event) => {
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
        drop files here
      </div>
      <div id="app" inert={nativeTouch && panel === 'model'}>
        <header id="header">
          <button
            id="sbs-switch"
            type="button"
            aria-label="切换 SBS 自主醒来"
            aria-pressed={state.sbsKnown ? state.sbsEnabled : undefined}
            disabled={!state.sbsKnown}
            onClick={() => void runtime.toggleSbs()}
          >
            <span id="status-dot" className={state.dotClass} />
            <span id="sbs-switch-label">SBS</span>
          </button>
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
          onWheel={(event) => {
            if (event.deltaY < 0) scrollLock.current = false;
          }}
          onScroll={() => {
            const el = messages.current!;
            scrollLock.current =
              el.scrollHeight - el.scrollTop - el.clientHeight <= 1;
            setSelection(null);
          }}
        >
          {!visibleItems.some(item => item.kind === "message") && !state.thinking && (
            <div className="chat-scope-empty">
              {state.historyScope === "current" ? "当前场景还没有对话。" : "暂无对话记录。"}
              {state.historyScope === "current" && <button type="button" onClick={() => changeScope("all")}>显示全部场景上下文</button>}
            </div>
          )}
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
                runtime={runtime}
                stopping={state.stopping}
                canStop={item.sceneId === state.currentScene.sceneId}
                sceneLabel={state.historyScope === "all" ? sceneName(item, state.currentScene, state.sceneNames) : undefined}
              />
            ) : (
              <div
                key={item.id}
                ref={(el) => {
                  if (el) messageElements.current.set(item.id, el);
                  else messageElements.current.delete(item.id);
                }}
                data-message-id={item.id}
                className={`message ${item.role}${item.consecutive ? " consecutive" : ""}${highlighted === item.id ? " index-target" : ""}`}
              >
                <div className={`meta${item.consecutive ? " time-only" : ""}`}>
                  {item.role === "user" && <CopyMessage text={splitSchedulingHint(item.text).text} copy={bridge.copyText} />}
                  {!item.consecutive && <span>{item.label} · </span>}
                  <span className="message-time-actions">
                    <time>{item.timestamp}</time>
                    {item.role !== "user" && <CopyMessage text={splitSchedulingHint(item.text).text} copy={bridge.copyText} />}
                  </span>
                  {state.historyScope === "all" && <span className="message-scene" title={item.sceneId || "这条历史消息未提供场景标记"}>{sceneName(item, state.currentScene, state.sceneNames)}</span>}
                </div>
                <ScheduledMessage
                  text={item.text}
                  streaming={item.streaming}
                  chat
                  onPlace={item.role === "system" || !keywordNavigation ? undefined : openPlace}
                />
                {item.queued && <div className="local-queue-status" role="status">
                  {item.queueNotice || "排队中 · 等待其他场景完成，尚未发送"}
                  <button type="button" onClick={() => item.cancelQueued?.()}>取消排队</button>
                </div>}
                {item.retry && (
                  <button
                    className="retry-btn"
                    type="button"
                    onClick={() => void item.retry?.()}
                  >
                    {item.retryLabel}
                  </button>
                )}
              </div>
            ),
          )}
          {state.thinking && showActivity && (
            <div className="message being thinking-indicator">
              <div className="meta">{state.name}</div>
              <div className="content">
                <span className="thinking-dot" />
                <span className="thinking-dot" />
                <span className="thinking-dot" />
              </div>
            </div>
          )}
        </div>
        <div
          id="reconnect-banner"
          className={state.banner ? "active" : ""}
          role="status"
        >
          {state.banner}
        </div>
        <div id="input-area">
          <div
            id="pending-files"
            className={state.files.length ? "active" : ""}
          >
            {state.files.map((file, i) => (
              <div className="pending-file" key={`${file.name}-${i}`}>
                {file.type.startsWith("image/") && file.base64 ? (
                  <img
                    className="pending-file-preview"
                    src={`data:${file.type};base64,${file.base64}`}
                    alt=""
                  />
                ) : (
                  <span className="pending-file-icon" aria-hidden="true">
                    {file.type.startsWith("image/") ? "🖼️" : "📄"}
                  </span>
                )}
                <span>
                  {file.name} ({formatSize(file.size)})
                  {file.loading ? " · 正在读取…" : ""}
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
          <div id="input-row">
            <textarea
              ref={composer}
              id="input"
              rows={1}
              className={state.queued ? "queued" : ""}
              placeholder="说点什么…"
              aria-label="message input"
              value={state.draft}
              onChange={(event) => {
                state.draft = event.target.value;
                state.changed();
              }}
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
                  composing.current ||
                  event.nativeEvent.isComposing ||
                  event.keyCode === 229 ||
                  Date.now() - compositionEnd.current < 50
                )
                  return;
                event.preventDefault();
                void runtime.send(state.draft);
              }}
            />
            <button
              className="btn-icon"
              type="button"
              title="添加附件"
              aria-label="添加附件"
              onClick={() => fileInput.current?.click()}
            >
              ＋
            </button>
            <div id="desktop-composer-tools">
              <ChatPlaces send={bridge.send} channels={channels} />
            </div>
            <button
              className="btn-icon"
              id="send-btn"
              type="button"
              title="send"
              aria-label="send message"
              onClick={() => {
                void runtime.send(state.draft);
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
      <ChatIndex
        ref={index}
        items={visibleItems}
        container={messages}
        elements={messageElements}
        scrollLock={scrollLock}
        send={bridge.send}
        highlight={setHighlighted}
      />
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
  );
}

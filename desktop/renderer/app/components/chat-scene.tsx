import { AnimatePresence, useReducedMotion } from 'motion/react';
import { DropdownMenuMotion } from '../../shared/components/animate-ui/dropdown-menu-motion';
import { WarmTooltipGroup } from '../../shared/components/react-bits/WarmTooltip';
import { WarmTooltipAnchors, shellTooltipAppearance } from '../../shared/components/warm-tooltip-anchors';
import StatusMark from '../../shared/components/react-bits/status-mark/StatusMark';
import { DrawerPresence, WorkspaceDrawer } from "../../shared/components/workspace-drawer";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, defaultCoordinates, useSensor, useSensors, type KeyboardSensorProps } from "@dnd-kit/core";
import { restrictToVerticalAxis, restrictToFirstScrollableAncestor } from "@dnd-kit/modifiers";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon } from '../../shared/icons/icon';
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { ChatScene } from "../../../shared/types";
import { CHAT_SCENE_ACTIVITY_ACTIONS, CHAT_SCENE_ACTIVITY_LABELS, type ChatSceneActivity } from "../../../shared/types";
import type { HistoryScope } from "../../chat/models/scenes";
import { PanelResizeHandle, usePanelWidth } from "../../shared/components/panel-resize";
import { Dialog } from "../../shared/components/dialog";
import { beingMonogram } from '../lib/being-monogram';

const sceneTooltipAppearance = { ...shellTooltipAppearance, side: 'bottom' as const, gap: 6 };
class SceneKeyboardSensor {
  static activators = KeyboardSensor.activators;
  autoScrollEnabled = false;

  constructor({ active, activeNode, event, context, onStart, onMove, onEnd, onCancel }: KeyboardSensorProps) {
    const listeners = new AbortController();
    const { signal } = listeners;
    const document = activeNode.node.current!.ownerDocument;
    const cancel = () => { listeners.abort(); onCancel(); };
    let startY: number | undefined;

    // Install synchronously so a key pressed as soon as the row lifts is handled.
    document.addEventListener('keydown', key => {
      if (key === event) return;
      if (key.code === 'Escape') {
        key.preventDefault();
        cancel();
      } else if (key.code === 'Space' || key.code === 'Enter' || key.code === 'Tab') {
        key.preventDefault();
        if (key.repeat) return;
        listeners.abort();
        onEnd();
      } else if (key.code === 'ArrowUp' || key.code === 'ArrowDown') {
        const { collisionRect, draggingNodeRect, scrollableAncestors } = context.current;
        key.preventDefault();
        if (!collisionRect || !draggingNodeRect) return;
        const next = sortableKeyboardCoordinates(key, {
          active, context: context.current, currentCoordinates: { x: collisionRect.left, y: collisionRect.top },
        });
        if (!next) return;
        startY ??= draggingNodeRect.top;
        const scroll = scrollableAncestors[0];
        let scrollDelta = 0;
        if (scroll) {
          const { top, bottom } = scroll.getBoundingClientRect();
          const before = scroll.scrollTop;
          const nextBottom = next.y + draggingNodeRect.height;
          scroll.scrollTop += Math.min(0, next.y - top) + Math.max(0, nextBottom - bottom);
          scrollDelta = scroll.scrollTop - before;
        }
        onMove({ x: 0, y: next.y - startY - scrollDelta });
      }
    }, { signal });
    document.defaultView?.addEventListener('resize', cancel, { signal });
    document.addEventListener('visibilitychange', cancel, { signal });
    onStart(defaultCoordinates);
  }
}

type SceneRename = {
  id: string;
  error: string;
  save: (name: string) => void;
  cancel: (restoreFocus: boolean) => void;
};

// The source waits 120 ms before drawing the mark. Its ring settles in 300 ms.
const sceneMarkDrawDuration = 180;
const sceneMarkPlaybackDuration = 340;

function SceneActivityIcon({ activity }: { activity: ChatSceneActivity }) {
  const reduceMotion = useReducedMotion();
  const [previous, setPrevious] = useState(activity);
  const [playing, setPlaying] = useState(false);
  if (previous !== activity) {
    setPrevious(activity);
    setPlaying(previous === 'working' && (activity === 'done' || activity === 'error'));
  }

  const showMark = playing && !reduceMotion;
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setPlaying(false), sceneMarkPlaybackDuration);
    return () => clearTimeout(timer);
  }, [playing, activity]);

  return <>
    <span className="chat-session-activity-icon" data-mark-playing={showMark || undefined} />
    {!reduceMotion && (activity === 'working' || showMark) && <span className="chat-session-status-mark" data-playing={showMark || undefined}>
      <StatusMark status={activity === 'error' ? 'failed' : activity === 'done' ? 'done' : 'running'}
        progress={0.75} size={11} strokeWidth={2.8} fillOpacity={0} drawDuration={sceneMarkDrawDuration}
        color="var(--accent)" doneColor="var(--green)" errorColor="var(--danger, #b34b43)" />
    </span>}
  </>;
}

function SceneRow({ session, selected, activity, disabled, sortable, onSelect, onMenu, rename }: {
  session: ChatScene; selected: boolean; activity?: ChatSceneActivity; disabled: boolean; sortable: boolean;
  onSelect: () => void; onMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  rename?: { error: string; save: (name: string) => void; cancel: (restoreFocus: boolean) => void };
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: session.scene_id, disabled: !sortable || disabled || !!rename,
  });
  const renameInput = useRef<HTMLInputElement>(null);
  const renaming = Boolean(rename);
  useLayoutEffect(() => {
    if (renaming) {
      renameInput.current?.focus();
      renameInput.current?.select();
    }
  }, [renaming]);
  const label = session.scene_meta.scene_label;
  return <div ref={setNodeRef} className="chat-session-item" data-reordering={isDragging || undefined}
    style={{ transform: CSS.Translate.toString(transform), transition }}>
    {sortable && <button ref={setActivatorNodeRef} type="button" className="chat-session-grip"
      {...attributes} {...listeners} disabled={disabled || renaming} aria-label={`调整场景顺序：${label}`}>
      <Icon name="chat-grip" width="14" height="14" />
    </button>}
    {rename ? <>
      <form className="chat-session-select chat-session-rename" aria-current={selected ? "true" : undefined} aria-busy={disabled}
        onSubmit={event => {
          event.preventDefault();
          if (!disabled && renameInput.current) rename.save(renameInput.current.value.trim());
        }} onBlur={event => {
          if (!disabled && !event.currentTarget.contains(event.relatedTarget)) rename.cancel(false);
        }} onKeyDown={event => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          if (!disabled && !event.nativeEvent.isComposing) { event.preventDefault(); rename.cancel(true); }
        }}>
        <input ref={renameInput} aria-label="场景名称" aria-describedby={rename.error ? "chat-session-rename-error" : undefined}
          defaultValue={label} maxLength={128} readOnly={disabled} />
        <button type="submit" aria-label="保存名称" title="保存名称" disabled={disabled}>
          <Icon name="check-16" width="16" height="16" />
        </button>
      </form>
      {rename.error && <p id="chat-session-rename-error" className="chat-session-error" role="alert">{rename.error}</p>}
    </> : <button type="button" className="chat-session-select" data-scene-id={session.scene_id} aria-label={`切换到场景：${label}`}
      aria-current={selected ? "true" : undefined} aria-description={activity && CHAT_SCENE_ACTIVITY_LABELS[activity]}
      title={label} disabled={disabled} onClick={onSelect} onContextMenu={onMenu}>
      <span>{label}</span>
      {activity && <span className="chat-session-activity" data-status={activity} aria-hidden="true"
        title={CHAT_SCENE_ACTIVITY_ACTIONS[activity] || CHAT_SCENE_ACTIVITY_LABELS[activity]}><SceneActivityIcon activity={activity} /></span>}
    </button>}
  </div>;
}

function SceneList({ sessions, selected, activity, query, disabled, orderKey, onSelect, onContextMenu, onReordering, rename }: {
  sessions: ChatScene[];
  selected?: string;
  activity: Record<string, ChatSceneActivity>;
  query: string;
  disabled: boolean;
  orderKey: string;
  onSelect: (id: string) => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>, session: ChatScene) => void;
  onReordering: (active: boolean) => void;
  rename?: SceneRename;
}) {
  const [order, setOrder] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(orderKey) ?? 'null');
      return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
    } catch { return []; }
  });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(SceneKeyboardSensor));
  const sceneById = new Map(sessions.map(session => [session.scene_id, session]));
  const orderedIds = [...new Set([...order.filter(id => sceneById.has(id)), ...sceneById.keys()])];
  const search = query.trim().toLocaleLowerCase();
  const visible = orderedIds.map(id => sceneById.get(id)!).filter(session => session.scene_meta.scene_label.toLocaleLowerCase().includes(search));
  const visibleIds = visible.map(session => session.scene_id);
  const sortable = (!disabled || Boolean(rename)) && visibleIds.length > 1;

  return <nav className="chat-session-list" aria-label="切换场景">
    <DndContext id="chat-scene-sort" sensors={sensors} collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
      accessibility={{
        screenReaderInstructions: { draggable: '按空格提起，使用上下方向键移动。按空格放下，按 Esc 取消。' },
        announcements: {
          onDragStart: ({ active }) => `已提起 ${sceneById.get(String(active.id))?.scene_meta.scene_label}`,
          onDragOver: ({ over }) => over ? `目标位置 ${visibleIds.indexOf(String(over.id)) + 1} / ${visibleIds.length}` : undefined,
          onDragEnd: ({ over }) => over ? `已放下，位置 ${visibleIds.indexOf(String(over.id)) + 1}` : '排序已取消',
          onDragCancel: () => '排序已取消',
        },
      }}
      onDragStart={() => onReordering(true)} onDragCancel={() => onReordering(false)}
      onDragEnd={({ active, over }) => {
        onReordering(false);
        const from = visibleIds.indexOf(String(active.id));
        const to = visibleIds.indexOf(String(over?.id));
        if (from < 0 || to < 0 || from === to) return;
        const reordered = arrayMove(visibleIds, from, to);
        const visibleSet = new Set(visibleIds);
        let index = 0;
        // A filtered list can move only the rows visible in that list.
        const next = orderedIds.map(id => visibleSet.has(id) ? reordered[index++] : id);
        setOrder(next);
        try { localStorage.setItem(orderKey, JSON.stringify(next)); } catch { /* Keep the session order. */ }
      }}>
      <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
        {visible.map(session => <SceneRow key={session.scene_id} session={session} selected={selected === session.scene_id}
          activity={activity[session.scene_id]} disabled={disabled} sortable={sortable} onSelect={() => onSelect(session.scene_id)}
          rename={rename?.id === session.scene_id ? rename : undefined}
          onMenu={event => onContextMenu(event, session)} />)}
      </SortableContext>
    </DndContext>
    {!!sessions.length && !visible.length && <p className="chat-session-caption" role="status">没有找到匹配的对话</p>}
    {!sessions.length && <p className="chat-session-caption">连接 Being 后创建场景</p>}
  </nav>;
}

export function ChatSceneIndicator({ scene, sessions = [], activity = {}, connected, scope, scopeReady, onScope, onCopy, onSession, visible = true, onReveal, createRequest = 0, beingName = "Being", beingId = "", onHome, orderKey }: {
  orderKey: string;
  beingName?: string;
  beingId?: string;
  onHome?: () => void;
  createRequest?: number;
  activity?: Record<string, ChatSceneActivity>;
  visible?: boolean;
  onReveal?: () => void;
  scene?: ChatScene;
  sessions?: ChatScene[];
  onSession: (operation: "create" | "bind" | "select" | "rename" | "delete", value: string, sceneId?: string) => Promise<void>;
  connected: boolean;
  scope: HistoryScope;
  scopeReady: boolean;
  onScope: (scope: HistoryScope) => void;
  onCopy: (id: string) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [width, setWidth] = usePanelWidth("scenes", 320);
  const [pinned, setPinned] = useState(() => { try { return localStorage.getItem("beings:scenes-pinned") === "true"; } catch { return false; } });
  const [query, setQuery] = useState("");
  const [reordering, setReordering] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const [optionsExpanded, setOptionsExpanded] = useState(false);
  const options = useRef<HTMLDetailsElement>(null);
  const [detail, setDetail] = useState<"current" | ChatScene>();
  const detailScene = detail === "current" ? scene : detail;
  const [editing, setEditing] = useState<"create" | "bind" | null>(null);
  const [renaming, setRenaming] = useState<string>();
  const [deleting, setDeleting] = useState<ChatScene>();
  const [menu, setMenu] = useState<{ scene: ChatScene; opener: HTMLButtonElement; x: number; y: number }>();
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!menu || !node) return;
    node.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - node.offsetWidth - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - node.offsetHeight - 8))}px`;
    node.querySelector("button")?.focus({ preventScroll: true });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(undefined);
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) close(); };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);
  useEffect(() => { setMenu(undefined); setRenaming(undefined); }, [visible, scene?.scene_id]);
  const [bindingId, setBindingId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const changing = useRef(false);
  const edit = (operation: "create" | "bind") => {
    setMenu(undefined); setRenaming(undefined); setBindingId("");
    setError(""); setName(""); setEditing(operation);
  };
  const finishRename = (id: string, restoreFocus: boolean) => {
    setRenaming(undefined); setError("");
    if (restoreFocus) requestAnimationFrame(() => {
      (panel.current?.querySelector<HTMLButtonElement>(`button[data-scene-id="${globalThis.CSS.escape(id)}"]`) ?? search.current)?.focus();
    });
  };
  const lastCreateRequest = useRef(createRequest);
  useEffect(() => {
    if (lastCreateRequest.current === createRequest) return;
    lastCreateRequest.current = createRequest;
    setMenu(undefined); setRenaming(undefined); setError(""); setName(""); setEditing("create");
  }, [createRequest]);
  const change = async (operation: "create" | "bind" | "select" | "rename" | "delete", value: string, sceneId?: string) => {
    if (changing.current) return;
    changing.current = true;
    // Selecting a scene keeps navigation visually stable; mutations still lock
    // the editor and list while saving. The ref prevents duplicate requests.
    setBusy(operation !== "select"); setError("");
    try {
      await onSession(operation, value, sceneId);
      if (operation === "rename") finishRename(sceneId!, true);
      setEditing(null); setDeleting(undefined);
      if (!pinned && ["select", "create", "bind"].includes(operation)) collapse();
    }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { changing.current = false; setBusy(false); }
  };
  const expanded = pinned || Boolean(editing || deleting || detail || menu || renaming);
  const pin = (next: boolean) => {
    setPinned(next);
    try { localStorage.setItem("beings:scenes-pinned", String(next)); } catch { /* Keep the session preference. */ }
  };
  const trigger = useRef<HTMLButtonElement>(null);
  const [panelHost, setPanelHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setPanelHost(document.querySelector<HTMLElement>(".workspace-stage")); }, []);
  const lastPinned = useRef(pinned);
  useLayoutEffect(() => { if (expanded) lastPinned.current = pinned; }, [expanded, pinned]);
  const drawerPinned = expanded ? pinned : lastPinned.current;
  const label = scene?.scene_meta.scene_label || "场景标记不可用";
  const { initial, palette } = beingMonogram(beingName, beingId);
  const collapse = () => { setMenu(undefined); setRenaming(undefined); pin(false); trigger.current?.focus(); };
  const reveal = () => { pin(true); onReveal?.(); };
  useEffect(() => { if (pinned && visible) search.current?.focus(); }, [pinned, visible]);
  return (
    <>
      <div className="chat-scene-control">
        <button ref={trigger} id="chat-scene-indicator" className={`rail-button rail-being${pinned ? '' : ' rail-scene-toggle'}`} type="button" data-palette={palette}
          aria-label={pinned ? `${beingName} · 返回主对话` : "展开场景列表"}
          aria-controls={pinned ? undefined : "chat-session-panel"} aria-expanded={pinned ? undefined : false}
          title={`${pinned ? '返回主对话' : '展开场景列表'} · ${label}`} onClick={pinned ? onHome : reveal}>
          <span className="rail-scene-avatar" aria-hidden="true">{initial}</span>
          {!pinned && <Icon name="split-panel" />}
        </button>
      </div>
      {panelHost && createPortal(<DrawerPresence open={visible && expanded}><WarmTooltipGroup delay={300} warmWindow={350} travel={0} tooltipClassName="rail-tooltip"><WorkspaceDrawer edge="left" ref={panel} style={{ width }} id="chat-session-panel" className="chat-session-panel" data-warm-tooltip-scope open={visible && expanded} data-pinned={drawerPinned} data-scene-sidebar aria-label="场景列表"
        onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented && !reordering && !editing && !detail && !deleting && !menu && !renaming) { event.preventDefault(); if (options.current?.open) { options.current.open = false; options.current.querySelector("summary")?.focus(); } else collapse(); } }}>
        <PanelResizeHandle panel={panel} label="调整场景列表宽度" width={width} onResize={setWidth} initial={320} min={240} max={480} reserve={48} edge="right" disabled={!pinned} />
        {drawerPinned && <div className="chat-session-titlebar">
          <strong>{beingName}</strong>
          <button type="button" className="chat-session-collapse" aria-label="收起场景列表" data-warm-tooltip="收起场景列表" onClick={collapse}>
            <Icon name="split-panel" />
          </button>
        </div>}
        <div className="chat-session-panel-heading">
          <label className="chat-session-search">
            <Icon name="search-20" />
            <input ref={search} type="search" aria-label="搜索场景" placeholder="搜索" value={query} onChange={event => setQuery(event.target.value)} />
          </label>
          <details ref={options} className="chat-session-options" onToggle={event => setOptionsExpanded(event.currentTarget.open)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}>
            <summary aria-label="场景列表选项" data-warm-tooltip="场景列表选项"><Icon name="more-filled" /></summary>
            <AnimatePresence>{optionsExpanded && <DropdownMenuMotion className="chat-session-options-popover">
              <button type="button" disabled={!scene} onClick={() => { options.current?.removeAttribute("open"); setDetail("current"); }}><Icon name="web-info" /><span>场景详情</span></button>
              <button type="button" disabled={!connected || busy || !sessions.length} onClick={() => { options.current?.removeAttribute("open"); edit("bind"); }}><Icon name="web-link" /><span>绑定已有场景</span></button>
              <hr />
              <button type="button" aria-label="关闭场景列表" onClick={collapse}><Icon name="chevron-left-20" /><span>收起列表</span><kbd>Esc</kbd></button>
            </DropdownMenuMotion>}</AnimatePresence>
          </details>
        </div>
        <div className="chat-session-group"><span>场景对话</span><button id="new-chat-session" type="button" aria-label="新建场景" data-warm-tooltip="新建场景" title="新建场景" disabled={!connected || busy || !sessions.length} onClick={() => edit("create")}><Icon name="plus" /></button></div>
        <SceneList key={orderKey} orderKey={orderKey} sessions={sessions} selected={scene?.scene_id} activity={activity}
          query={query} disabled={busy || !connected} onSelect={id => void change("select", id)}
          rename={renaming ? { id: renaming, error, save: next => {
              if (!next) { setError("请输入场景名称。"); return; }
              if (next === sessions.find(session => session.scene_id === renaming)?.scene_meta.scene_label) finishRename(renaming, true);
              else void change("rename", next, renaming);
            },
            cancel: restoreFocus => finishRename(renaming, restoreFocus) } : undefined}
          onReordering={dragging => { if (dragging) setMenu(undefined); setReordering(dragging); }}
          onContextMenu={(event, session) => {
            if (busy || !connected) return;
            event.preventDefault();
            event.stopPropagation();
            const opener = event.currentTarget;
            const bounds = opener.getBoundingClientRect();
            setMenu({ scene: session, opener, x: event.clientX || bounds.left, y: event.clientY || bounds.bottom });
          }} />
        <label className="chat-session-context-toggle">
          <input type="checkbox" checked={scope === "all"} disabled={!scopeReady || !scene}
            onChange={event => onScope(event.target.checked ? "all" : "current")} />
          <span>显示全部场景上下文</span>
        </label>
        {error && !editing && !deleting && !renaming && <p role="alert" className="chat-session-error">{error}</p>}

        <WarmTooltipAnchors rootRef={panel} appearance={sceneTooltipAppearance} />
      </WorkspaceDrawer></WarmTooltipGroup></DrawerPresence>, panelHost)}
      {createPortal(<AnimatePresence>{menu && <DropdownMenuMotion ref={menuRef} className="chat-session-context-menu" role="menu" aria-label="场景操作"
        onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
        onKeyDown={event => {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
          if (event.key === "Escape" || event.key === "Tab") {
            event.preventDefault(); setMenu(undefined);
            menu.opener.focus({ preventScroll: true });
          } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length]?.focus();
          }
        }}>
        <button role="menuitem" type="button" onClick={() => {
          menu.opener.focus({ preventScroll: true });
          setDetail(menu.scene);
          setMenu(undefined);
        }}>场景详情</button>
        <button role="menuitem" type="button" onClick={() => { setRenaming(menu.scene.scene_id); setError(""); setMenu(undefined); }}>重命名</button>
        <button role="menuitem" type="button" className="danger" onClick={() => { setDeleting(menu.scene); setError(""); setMenu(undefined); }}>删除场景</button>
      </DropdownMenuMotion>}</AnimatePresence>, document.body)}
      <Dialog id="chat-session-delete" className="utility-dialog" open={!!deleting} busy={busy}
        aria-labelledby="chat-session-delete-title" onClose={() => setDeleting(undefined)} dismissOnBackdrop>
        <div className="dialog-heading"><h2 id="chat-session-delete-title">删除场景？</h2></div>
        <p className="utility-subtitle">确定从本机场景列表中删除「{deleting?.scene_meta.scene_label}」？历史记录会保留，仍可开启「显示全部场景上下文」查看。</p>
        {error && <p role="alert" className="chat-session-error">{error}</p>}
        <div className="files-footer">
          <button autoFocus type="button" disabled={busy} onClick={() => setDeleting(undefined)}>取消</button>
          <button className="danger" type="button" disabled={busy} onClick={() => { if (deleting) void change("delete", deleting.scene_id); }}>{busy ? "删除中…" : "确认删除"}</button>
        </div>
      </Dialog>
      <Dialog id="chat-session-editor" open={editing !== null} busy={busy}
        aria-labelledby="chat-session-title" onClose={() => setEditing(null)} dismissOnBackdrop>
        <form className="dialog-form" onSubmit={event => { event.preventDefault(); if (editing && !busy) void change(editing, name, editing === "bind" ? bindingId : undefined); }}>
          <div className="dialog-heading">
            <h2 id="chat-session-title">{editing === "bind" ? "绑定已有场景" : "新建场景"}</h2>
            <button className="close" type="button" aria-label="关闭场景编辑" disabled={busy} onClick={() => setEditing(null)} />
          </div>
          <div className="dialog-body">
            <p className="utility-subtitle">{editing === "bind" ? "填入同一 Being 在其他客户端的场景 ID，即可继续该场景的对话。" : "与同一个 Being 开始一个独立的对话场景。"}</p>
            {editing === "bind" && <label className="chat-session-field">场景 ID
              <input autoFocus name="scene-id" autoComplete="off" value={bindingId} maxLength={256} placeholder="粘贴其他客户端的场景 ID" disabled={busy} onChange={event => setBindingId(event.target.value)} />
            </label>}
            <label className="chat-session-field">场景名称
              <input autoFocus={editing !== "bind"} name="scene-name" autoComplete="off" value={name} maxLength={128} placeholder="例如：方案讨论" disabled={busy} onChange={event => setName(event.target.value)} />
            </label>
            {editing === "bind" && <p className="chat-session-hint">名称仅在本机显示；已绑定的场景将直接打开。</p>}
            {error && <p role="alert" className="chat-session-error">{error}</p>}
          </div>
          <div className="files-footer">
            <button type="button" disabled={busy} onClick={() => setEditing(null)}>取消</button>
            <button type="submit" disabled={busy || !name.trim() || (editing === "bind" && !bindingId.trim())}>{busy ? "保存中…" : editing === "bind" ? "绑定并进入" : "创建并进入"}</button>
          </div>
        </form>
      </Dialog>
      <Dialog
        id="chat-scene-dialog"
        className="utility-dialog"
        aria-labelledby="chat-scene-heading"
        open={!!detail}
        onClose={() => setDetail(undefined)}
        dismissOnBackdrop
      >
        <div className="dialog-heading">
          <h2 id="chat-scene-heading">{detail === "current" ? "当前场景" : "场景详情"}</h2>
          <button className="close" type="button" aria-label="关闭场景详情" onClick={() => setDetail(undefined)} />
        </div>
        <p className="chat-scene-name">{detailScene?.scene_meta.scene_label || "场景标记不可用"}</p>
        {(detail === "current" || detailScene?.scene_id === scene?.scene_id) && <p className="utility-subtitle">
          {scene
            ? connected
              ? "从这里发送的对话会带上这个场景。"
              : "连接 Being 后，发送的对话会带上这个场景。"
            : "客户端场景不可用，暂时无法发送消息。请查看客户端的启动提示。"}
        </p>}
        {detailScene && <>
          <dl className="chat-scene-details">
            <dt>场景 ID</dt>
            <dd><code id="chat-scene-id">{detailScene.scene_id}</code></dd>
            <dt>客户端</dt>
            <dd>{detailScene.scene_meta.client}</dd>
          </dl>
          <div className="files-footer">
            <button id="copy-chat-scene" type="button" onClick={() => onCopy(detailScene.scene_id)}>复制场景 ID</button>
          </div>
        </>}
      </Dialog>
    </>
  );
}

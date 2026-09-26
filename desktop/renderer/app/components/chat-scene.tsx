import type { ChatSessionOperation } from "../../../shared/types";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Info, Link2, PanelLeft, Plus } from "lucide-react";
import type { ChatScene } from "../../../shared/types";
import { CHAT_SCENE_ACTIVITY_LABELS, type ChatSceneActivity } from "../../../shared/types";
import { ChatSessionList, focusSession } from "./chat-session-list";
import { moveChatSessions } from "../../../shared/chat-session-order";
import { useSidebarWidth } from "../hooks/use-sidebar-width";
import { useSidebarHint } from "./sidebar-hint";
import type { HistoryScope } from "../../chat/models/scenes";
import { Dialog } from "../../shared/components/dialog";
import { SIDEBAR_PEEK, useSidebarPeek } from "../hooks/use-sidebar-peek";

export function ChatSceneIndicator({ scene, sessions = [], activity = {}, connected, scope, scopeReady, onScope, onCopy, onSession, visible = true, onReveal, createRequest = 0, widthPreferenceKey = "portal.sceneSidebarWidth" }: {
  widthPreferenceKey?: string;
  createRequest?: number;
  activity?: Record<string, ChatSceneActivity>;
  visible?: boolean;
  onReveal?: () => void;
  scene?: ChatScene;
  sessions?: ChatScene[];
  onSession: (operation: ChatSessionOperation, value: string | string[], sceneId?: string) => Promise<void>;
  connected: boolean;
  scope: HistoryScope;
  scopeReady: boolean;
  onScope: (scope: HistoryScope) => void;
  onCopy: (id: string) => void;
}) {
  const [details, setDetails] = useState<ChatScene>();
  const [dragging, setDragging] = useState(false);
  const [sizing, setSizing] = useState(false);
  const [ordered, setOrdered] = useState<ChatScene[]>();
  const [announcement, setAnnouncement] = useState("");
  const [editing, setEditing] = useState<"create" | "bind" | null>(null);
  const [renameId, setRenameId] = useState<string>();
  const [selection, setSelection] = useState<string[]>(scene ? [scene.scene_id] : []);
  useEffect(() => { setSelection(scene ? [scene.scene_id] : []); }, [scene?.scene_id]);
  useEffect(() => {
    setSelection(previous => {
      const next = previous.filter(id => sessions.some(item => item.scene_id === id));
      return next.length === previous.length ? previous : next;
    });
    if (renameId && !sessions.some(item => item.scene_id === renameId)) setRenameId(undefined);
  }, [sessions, renameId]);
  useEffect(() => {
    // React autoFocus ran while this persistent dialog was still closed.
    // Focus the first relevant field only after Dialog has called showModal().
    if (editing) document.querySelector<HTMLInputElement>("#chat-session-editor input")?.focus();
  }, [editing]);
  const [deleting, setDeleting] = useState<ChatScene[]>();
  const [menu, setMenu] = useState<{ scene: ChatScene; scenes: ChatScene[]; x: number; y: number; keyboard: boolean }>();
  const hint = useSidebarHint(visible && !menu && !renameId && !dragging && !sizing, selection.length < 2);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const element = menuRef.current;
    if (menu.keyboard) element?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    else element?.focus();
    const close = () => setMenu(undefined);
    const restore = () => {
      if (element?.contains(document.activeElement)) focusSession(menu.scene.scene_id);
      close();
    };
    const outside = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      close();
      // Let the pointer finish assigning focus before restoring from empty
      // space. Never take focus back from a clicked control or another popup.
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) focusSession(menu.scene.scene_id);
      });
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", restore);
    const scroll = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) restore(); };
    window.addEventListener("scroll", scroll, true);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", restore);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [menu]);
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element || !menu) return;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - rect.height - 8))}px`;
  }, [menu]);
  useEffect(() => { setMenu(undefined); }, [visible, scene?.scene_id]);
  const [bindingId, setBindingId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const changing = useRef(false);
  const selectionRequest = useRef<Promise<void>>(Promise.resolve());
  const requestedScene = useRef<{ id: string } | undefined>(undefined);
  const pendingFocus = useRef<{ id?: string } | undefined>(undefined);
  useLayoutEffect(() => {
    if (!busy && pendingFocus.current) {
      focusSession(pendingFocus.current.id || scene?.scene_id || "");
      pendingFocus.current = undefined;
    }
  }, [busy, ordered, scene?.scene_id]);
  const edit = (operation: "create" | "bind") => {
    setMenu(undefined); setBindingId(""); setError(""); setName(""); setEditing(operation);
  };
  const rename = (selected: ChatScene) => {
    if (renameId) {
      document.querySelector<HTMLInputElement>(".chat-session-inline-editor input")?.focus();
      return;
    }
    setMenu(undefined); setSelection([selected.scene_id]); setRenameId(selected.scene_id); setError("");
  };
  const select = (id: string) => {
    if (id === (requestedScene.current?.id ?? scene?.scene_id)) return;
    const request = { id }; requestedScene.current = request;
    selectionRequest.current = selectionRequest.current.then(() => onSession("select", id)).catch(cause => {
      setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (requestedScene.current === request) requestedScene.current = undefined;
    });
  };
  const renameSave = async (id: string, value: string) => {
    if (changing.current) throw new Error("正在保存，请稍后重试。");
    changing.current = true; setBusy(true);
    try { await selectionRequest.current; await onSession("rename", value, id); }
    finally { changing.current = false; setBusy(false); }
  };
  const remove = (ids: string[]) => {
    const targets = sessions.filter(item => ids.includes(item.scene_id));
    if (!targets.length) return;
    focusSession(ids[0]); setMenu(undefined); setDeleting(targets); setError("");
  };
  const lastCreateRequest = useRef(createRequest);
  useEffect(() => {
    if (lastCreateRequest.current === createRequest) return;
    lastCreateRequest.current = createRequest;
    setMenu(undefined); setError(""); setName(""); setEditing("create");
  }, [createRequest]);
  const change = async (operation: ChatSessionOperation, value: string | string[], sceneId?: string) => {
    await selectionRequest.current;
    if (changing.current) return;
    changing.current = true;
    // Selecting a scene keeps navigation visually stable; mutations still lock
    // the editor and list while saving. The ref prevents duplicate requests.
    setBusy(operation !== "select"); setError("");
    try {
      await onSession(operation, value, sceneId); setEditing(null); setDeleting(undefined);
      if (operation === "delete") {
        const removed = new Set(Array.isArray(value) ? value : [value]);
        const remaining = sessions.filter(item => !removed.has(item.scene_id));
        pendingFocus.current = { id: remaining.find(item => item.scene_id === scene?.scene_id)?.scene_id };
      }
    }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { changing.current = false; setBusy(false); }
  };
  const sidebar = useSidebarPeek(visible, !!(details || editing || renameId || deleting || menu || hint.active || dragging || sizing));
  const size = useSidebarWidth(sidebar.panel, widthPreferenceKey);
  useEffect(() => { setSizing(size.resizing); }, [size.resizing]);
  const move = async (ids: string[], before?: string) => {
    await selectionRequest.current;
    if (changing.current) return;
    let next: ChatScene[];
    try { next = moveChatSessions(sessions, ids, before); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
    if (next.every((item, index) => item.scene_id === sessions[index]?.scene_id)) return;
    changing.current = true; setBusy(true); setError(""); setMenu(undefined); setOrdered(next);
    try {
      await onSession("move", ids, before);
      setAnnouncement(`已移动 ${ids.length} 个场景`);
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally {
      pendingFocus.current = { id: ids[0] };
      changing.current = false; setBusy(false); setOrdered(undefined);
    }
  };
  const closeMenu = () => { if (menu) focusSession(menu.scene.scene_id); setMenu(undefined); };
  const label = scene?.scene_meta.scene_label || "场景标记不可用";
  return (
    <>
      <div className="chat-scene-control">
        <button ref={sidebar.trigger} id="chat-scene-indicator" className="chat-scene-indicator" type="button"
          aria-label={`${sidebar.peek ? "固定" : sidebar.pinned && visible ? "收起" : "展开"}场景列表`}
          aria-controls="chat-session-panel" aria-expanded={sidebar.shown} aria-pressed={sidebar.pinned && visible}
          data-instant={sidebar.instant}
          data-sidebar-hint={sidebar.peek ? "固定场景列表" : sidebar.pinned && visible ? "收起场景列表" : "展开场景列表"} onClick={event => {
            setMenu(undefined);
            if (visible || !sidebar.pinned) sidebar.toggle(event.detail === 0);
            if (!visible) onReveal?.();
          }}>
          <PanelLeft className="chat-scene-icon" aria-hidden="true" />
        </button>
        <div ref={sidebar.edge} className="chat-sidebar-edge" aria-hidden="true" hidden={!visible || sidebar.pinned}
          style={{ width: SIDEBAR_PEEK.hotzoneWidth }} />
        <aside ref={sidebar.panel} id="chat-session-panel" className="chat-session-panel" aria-label="场景列表"
          data-pinned={sidebar.pinned && visible} data-open={sidebar.shown} data-peek={sidebar.peek} data-instant={sidebar.instant}
          inert={!sidebar.shown} aria-hidden={!sidebar.shown}>
          <div className="chat-session-create-actions">
            <button id="new-chat-session" className="chat-session-new" type="button" aria-label="新建场景"
            data-sidebar-hint={!connected ? "连接 Being 后可新建场景" : busy ? "正在保存，请稍候" : undefined}
            disabled={!connected || busy} onClick={() => edit("create")}>
            <Plus aria-hidden="true" />
            新建场景
            </button>
            <button id="bind-chat-session" className="chat-session-bind" type="button" aria-label="绑定已有场景"
              data-sidebar-hint={!connected ? "连接 Being 后可绑定场景" : busy ? "正在保存，请稍候" : "绑定已有场景"} disabled={!connected || busy} onClick={() => edit("bind")}>
              <Link2 aria-hidden="true" />
            </button>
          </div>
          <ChatSessionList sessions={ordered || sessions} activeId={scene?.scene_id} activity={activity} menuId={menu?.scene.scene_id}
            disabled={busy || !connected} onSelect={select} selectedIds={selection} onSelection={setSelection}
            disabledReason={!connected ? "未连接，暂时无法切换场景" : "正在保存，请稍候"}
            emptyMessage={connected ? "还没有场景，点击上方新建" : "连接 Being 后创建场景"}
            renameId={renameId} onRename={rename} onRenameEnd={id => setRenameId(current => current === id ? undefined : current)} onRenameSave={renameSave}
            onMove={(ids, before) => void move(ids, before)} onDelete={remove} onCopy={ids => onCopy(ids.join("\n"))}
            onDragging={setDragging} onMenu={(session, x, y, keyboard = false) => {
              const ids = selection.includes(session.scene_id) ? selection : [session.scene_id];
              setSelection(ids); setMenu({ scene: session, scenes: sessions.filter(item => ids.includes(item.scene_id)), x, y, keyboard });
            }} />
          <div className="chat-sidebar-resizer" role="separator" tabIndex={0} aria-orientation="vertical"
            aria-label="场景列表宽度" aria-controls="chat-session-panel" aria-valuemin={size.bounds.min}
            aria-valuemax={size.bounds.max} aria-valuenow={size.width} aria-valuetext={`${size.width} 像素`}
            data-resizing={size.resizing} data-sidebar-hint="拖动调整宽度 · 双击恢复默认" {...size.props}
            onKeyDown={event => { size.props.onKeyDown(event); if (event.key === "Enter") { event.preventDefault(); sidebar.collapse(); } }} />
          <span className="sidebar-sr-only" role="status" aria-live="polite">{selection.length > 1 ? `已选择 ${selection.length} 个场景` : announcement}</span>
          <div className="chat-session-footer">
            <label className="chat-session-context-toggle">
              <input type="checkbox" checked={scope === "all"} disabled={!scopeReady || !scene}
                aria-label="显示全部场景上下文" onChange={event => onScope(event.target.checked ? "all" : "current")} />
              <span>全部上下文</span>
            </label>
          </div>
          {error && !editing && !deleting && <p role="alert" className="chat-session-error">{error}</p>}

        </aside>
        <div className="chat-scene-heading">
          <span className="chat-scene-label" data-sidebar-hint={label} data-sidebar-hint-overflow>{scene ? label : "场景"}</span>
          <button id="chat-scene-details-trigger" className="chat-scene-info" type="button" aria-label="场景信息"
            data-sidebar-hint="场景信息" disabled={!scene} onClick={() => setDetails(scene)}>
            <Info aria-hidden="true" />
          </button>
        </div>
      </div>
      {hint.node}
      {menu && createPortal(<div ref={menuRef} className="chat-session-context-menu" role="menu" aria-label="场景操作" tabIndex={-1}
        style={{ left: menu.x, top: menu.y }} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
        onPointerMove={event => {
          if (event.pointerType !== "mouse") return;
          const button = (event.target as Element).closest<HTMLButtonElement>("button");
          (button && !button.disabled ? button : event.currentTarget).focus({ preventScroll: true });
        }}
        onPointerLeave={event => { if (event.pointerType === "mouse") event.currentTarget.focus({ preventScroll: true }); }}
        onKeyDown={event => {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
          if (event.key === "Escape") {
            event.preventDefault(); event.stopPropagation(); closeMenu();
          } else if (event.key === "Tab") {
            // Restore the list's tab stop before the browser advances focus.
            event.stopPropagation(); closeMenu();
          } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : index < 0 ? (event.key === "ArrowUp" ? buttons.length - 1 : 0) : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length]?.focus();
          }
        }}>
        {menu.scenes.length > 1 && <div className="chat-session-menu-heading">已选择 {menu.scenes.length} 个场景</div>}
        {menu.scenes.length === 1 && <><button role="menuitem" tabIndex={-1} type="button" onClick={() => rename(menu.scene)}>重命名 <kbd aria-hidden="true">F2</kbd></button>
        <button role="menuitem" tabIndex={-1} type="button" onClick={() => {
          focusSession(menu.scene.scene_id); setDetails(menu.scene); setMenu(undefined);
        }}>查看场景信息</button></>}
        <button role="menuitem" tabIndex={-1} type="button" onClick={() => { onCopy(menu.scenes.map(item => item.scene_id).join("\n")); closeMenu(); }}>{menu.scenes.length > 1 ? "复制所选场景 ID" : "复制场景 ID"}</button>
        <div role="separator" />
        <button role="menuitem" tabIndex={-1} type="button" className="danger" onClick={() => remove(menu.scenes.map(item => item.scene_id))}>{menu.scenes.length > 1 ? `删除 ${menu.scenes.length} 个场景` : "删除场景"}</button>
      </div>, document.body)}
      <Dialog id="chat-session-delete" className="utility-dialog" open={!!deleting} busy={busy}
        aria-labelledby="chat-session-delete-title" onClose={() => setDeleting(undefined)} dismissOnBackdrop>
        <div className="dialog-heading"><h2 id="chat-session-delete-title">{deleting && deleting.length > 1 ? `删除 ${deleting.length} 个场景？` : "删除场景？"}</h2></div>
        <p className="utility-subtitle">确定从本机场景列表中删除{deleting?.length === 1 ? `「${deleting[0].scene_meta.scene_label}」` : `所选的 ${deleting?.length} 个场景`}？历史记录会保留，仍可开启「显示全部场景上下文」查看。</p>
        {deleting && deleting.length > 1 && <ul className="chat-session-delete-list">{deleting.map(item => <li key={item.scene_id}>{item.scene_meta.scene_label}</li>)}</ul>}
        {error && <p role="alert" className="chat-session-error">{error}</p>}
        <div className="files-footer">
          <button autoFocus type="button" disabled={busy} onClick={() => setDeleting(undefined)}>取消</button>
          <button className="danger" type="button" disabled={busy} onClick={() => { if (deleting) void change("delete", deleting.map(item => item.scene_id)); }}>{busy ? "删除中…" : "确认删除"}</button>
        </div>
      </Dialog>
      <Dialog id="chat-session-editor" className="utility-dialog" open={editing !== null} busy={busy}
        aria-labelledby="chat-session-title" onClose={() => setEditing(null)} dismissOnBackdrop>
        <form onSubmit={event => { event.preventDefault(); if (editing && !busy) void change(editing, name, editing === "bind" ? bindingId : undefined); }}>
          <div className="dialog-heading">
            <h2 id="chat-session-title">{editing === "bind" ? "绑定已有场景" : "新建场景"}</h2>
            <button className="close" type="button" aria-label="关闭场景编辑" disabled={busy} onClick={() => setEditing(null)} />
          </div>
          <p className="utility-subtitle">{editing === "bind" ? "填入同一 Being 在其他客户端的场景 ID，即可继续该场景的对话。" : "与同一个 Being 开始一个独立的对话场景。"}</p>
          {editing === "bind" && <label className="chat-session-field">场景 ID
            <input value={bindingId} maxLength={256} placeholder="粘贴其他客户端的场景 ID" disabled={busy} onChange={event => setBindingId(event.target.value)} />
          </label>}
          <label className="chat-session-field">场景名称
            <input autoFocus value={name} maxLength={128} placeholder="例如：方案讨论" disabled={busy} onChange={event => setName(event.target.value)} />
          </label>
          {editing === "bind" && <p className="chat-session-hint">名称仅在本机显示；已绑定的场景将直接打开。</p>}
          {error && <p role="alert" className="chat-session-error">{error}</p>}
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
        open={!!details}
        onClose={() => setDetails(undefined)}
        dismissOnBackdrop
      >
        <div className="dialog-heading">
          <h2 id="chat-scene-heading">场景信息</h2>
          <button className="close" type="button" aria-label="关闭场景信息" onClick={() => setDetails(undefined)} />
        </div>
        <p className="chat-scene-name">{details?.scene_meta.scene_label}</p>
        <p className="utility-subtitle">
          同一 Being 可通过场景 ID，在其他客户端继续这个场景的对话。
        </p>
        {details && <>
          <dl className="chat-scene-details">
            <dt>场景 ID</dt>
            <dd><code id="chat-scene-id">{details.scene_id}</code></dd>
            <dt>客户端</dt>
            <dd>{details.scene_meta.client}</dd>
            <dt>状态</dt>
            <dd>{activity[details.scene_id] ? CHAT_SCENE_ACTIVITY_LABELS[activity[details.scene_id]] : "暂无活动"}</dd>
          </dl>
          <div className="files-footer">
            <button id="copy-chat-scene" type="button" onClick={() => onCopy(details.scene_id)}>复制场景 ID</button>
          </div>
        </>}
      </Dialog>
    </>
  );
}

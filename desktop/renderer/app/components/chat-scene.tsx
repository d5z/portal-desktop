import { createPortal } from "react-dom";
import { Fragment, useEffect, useRef, useState } from "react";
import type { ChatScene } from "../../../shared/types";
import { CHAT_SCENE_ACTIVITY_LABELS, type ChatSceneActivity } from "../../../shared/types";
import type { HistoryScope } from "../../chat/models/scenes";
import { PanelResizeHandle, usePanelWidth } from "../../shared/components/panel-resize";
import { Dialog } from "../../shared/components/dialog";

export function ChatSceneIndicator({ scene, sessions = [], activity = {}, connected, scope, scopeReady, onScope, onCopy, onSession, visible = true, onReveal, createRequest = 0 }: {
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
  const search = useRef<HTMLInputElement>(null);
  const options = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<"create" | "bind" | "rename" | null>(null);
  const [target, setTarget] = useState<ChatScene>();
  const [deleting, setDeleting] = useState<ChatScene>();
  const [menu, setMenu] = useState<{ scene: ChatScene; x: number; y: number }>();
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
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
  useEffect(() => { setMenu(undefined); }, [visible, scene?.scene_id]);
  const [bindingId, setBindingId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const changing = useRef(false);
  const edit = (operation: "create" | "bind" | "rename", selected = scene) => {
    setMenu(undefined); setTarget(selected); setBindingId("");
    setError(""); setName(operation === "rename" ? selected?.scene_meta.scene_label || "" : ""); setEditing(operation);
  };
  const lastCreateRequest = useRef(createRequest);
  useEffect(() => {
    if (lastCreateRequest.current === createRequest) return;
    lastCreateRequest.current = createRequest;
    setMenu(undefined); setTarget(undefined); setError(""); setName(""); setEditing("create");
  }, [createRequest]);
  const change = async (operation: "create" | "bind" | "select" | "rename" | "delete", value: string, sceneId?: string) => {
    if (changing.current) return;
    changing.current = true;
    // Selecting a scene keeps navigation visually stable; mutations still lock
    // the editor and list while saving. The ref prevents duplicate requests.
    setBusy(operation !== "select"); setError("");
    try { await onSession(operation, value, sceneId); setEditing(null); setDeleting(undefined); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { changing.current = false; setBusy(false); }
  };
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const label = scene?.scene_meta.scene_label || "场景标记不可用";
  const collapse = () => { setMenu(undefined); setExpanded(false); trigger.current?.focus(); };
  const reveal = () => { setExpanded(true); onReveal?.(); };
  useEffect(() => { if (expanded && visible) search.current?.focus(); }, [expanded, visible]);
  useEffect(() => {
    if (!expanded || !visible || pinned || editing || deleting || open || menu) return;
    const dismiss = () => { setExpanded(false); setMenu(undefined); };
    const outside = (event: Event) => {
      if (panel.current?.contains(event.target as Node) || trigger.current?.contains(event.target as Node) || (event.target as Element)?.closest?.("dialog, .chat-session-context-menu")) return;
      dismiss();
    };
    const blur = () => { if (!document.querySelector("dialog[open]")) dismiss(); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside, true);
    window.addEventListener("blur", blur);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("focusin", outside, true); window.removeEventListener("blur", blur); };
  }, [expanded, visible, pinned, editing, deleting, open, menu]);
  const matches = (session: ChatScene) => session.scene_meta.scene_label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  return (
    <>
      <div className="chat-scene-control">
        <button ref={trigger} id="chat-scene-indicator" className="chat-scene-indicator" type="button"
          aria-label={`${expanded && visible ? "收起" : "展开"}场景列表`} aria-controls="chat-session-panel" aria-expanded={expanded && visible}
          title={label} onClick={() => expanded && visible ? collapse() : reveal()}>
          <svg className="chat-scene-icon" viewBox="0 0 20 20" aria-hidden="true">
            <path d="m5 7 5 5 5-5" />
          </svg>
          <span className="chat-scene-label">{scene ? label : "场景"}</span>
        </button>
      </div>
      {visible && expanded && <aside ref={panel} style={{ width }} id="chat-session-panel" className="chat-session-panel" aria-label="场景列表"
        onKeyDown={event => { if (event.key === "Escape" && !editing && !open && !deleting && !menu) { event.preventDefault(); collapse(); } }}>
        <PanelResizeHandle panel={panel} label="调整场景列表宽度" width={width} onResize={setWidth} initial={320} min={240} max={480} reserve={48} edge="right" />
        <div className="chat-session-panel-heading">
          <label className="chat-session-search">
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
            <input ref={search} type="search" aria-label="搜索场景" placeholder="搜索" value={query} onChange={event => setQuery(event.target.value)} />
          </label>
          <details ref={options} className="chat-session-options">
            <summary aria-label="场景列表选项" title="场景列表选项">···</summary>
            <div className="chat-session-options-popover">
              <button type="button" aria-pressed={pinned} onClick={() => { const next = !pinned; setPinned(next); try { localStorage.setItem("beings:scenes-pinned", String(next)); } catch {} options.current?.removeAttribute("open"); }}>保持显示聊天面板 <span aria-hidden="true">{pinned ? "✓" : ""}</span></button>
              <button type="button" disabled={!scene} onClick={() => { options.current?.removeAttribute("open"); setOpen(true); }}>场景详情</button>
              <button type="button" disabled={!connected || busy || !sessions.length} onClick={() => { options.current?.removeAttribute("open"); edit("bind"); }}>绑定已有场景</button>
              <button type="button" aria-label="关闭场景列表" onClick={collapse}>收起列表</button>
            </div>
          </details>
        </div>
        <div className="chat-session-group"><span>场景对话</span><button id="new-chat-session" type="button" aria-label="新建场景" title="新建场景" disabled={!connected || busy || !sessions.length} onClick={() => edit("create")}>＋</button></div>
        <nav className="chat-session-list" aria-label="切换场景">
          {sessions.map(session => <Fragment key={session.scene_id}>

            {matches(session) && <button key={session.scene_id} data-scene-id={session.scene_id} type="button"
            aria-label={`切换到场景：${session.scene_meta.scene_label}`} aria-current={scene?.scene_id === session.scene_id ? "true" : undefined}
            onContextMenu={event => {
              if (busy || !connected) return;
              event.preventDefault();
              event.stopPropagation();
              const bounds = event.currentTarget.getBoundingClientRect();
              setMenu({ scene: session, x: Math.max(8, Math.min(event.clientX || bounds.left, window.innerWidth - 176)),
                y: Math.max(8, Math.min(event.clientY || bounds.bottom, window.innerHeight - 100)) });
            }}
            title={session.scene_meta.scene_label} disabled={busy || !connected} onClick={() => void change("select", session.scene_id)}>
            <span>{session.scene_meta.scene_label}</span>
            {activity[session.scene_id] ? <span className="chat-session-activity" data-status={activity[session.scene_id]}
              title={CHAT_SCENE_ACTIVITY_LABELS[activity[session.scene_id]]}>
              <span className="chat-session-activity-icon" aria-hidden="true" />
              {CHAT_SCENE_ACTIVITY_LABELS[activity[session.scene_id]]}
            </span> : scene?.scene_id === session.scene_id && <span className="chat-session-current" aria-hidden="true">•</span>}
          </button>}</Fragment>)}

          {!!sessions.length && !sessions.some(matches) && <p className="chat-session-caption" role="status">没有找到匹配的对话</p>}
          {!sessions.length && <p className="chat-session-caption">连接 Being 后创建场景</p>}
        </nav>
        <label className="chat-session-context-toggle">
          <input type="checkbox" checked={scope === "all"} disabled={!scopeReady || !scene}
            onChange={event => onScope(event.target.checked ? "all" : "current")} />
          <span>显示全部场景上下文</span>
        </label>
        {error && !editing && !deleting && <p role="alert" className="chat-session-error">{error}</p>}

      </aside>}
      {menu && createPortal(<div ref={menuRef} className="chat-session-context-menu" role="menu" aria-label="场景操作"
        style={{ left: menu.x, top: menu.y }} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
        onKeyDown={event => {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
          if (event.key === "Escape" || event.key === "Tab") {
            event.preventDefault(); setMenu(undefined);
            document.querySelector<HTMLButtonElement>(`.chat-session-list button[data-scene-id="${menu.scene.scene_id}"]`)?.focus();
          } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length]?.focus();
          }
        }}>
        <button role="menuitem" type="button" onClick={() => edit("rename", menu.scene)}>重命名</button>
        <button role="menuitem" type="button" className="danger" onClick={() => { setDeleting(menu.scene); setError(""); setMenu(undefined); }}>删除场景</button>
      </div>, document.body)}
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
      <Dialog id="chat-session-editor" className="utility-dialog" open={editing !== null} busy={busy}
        aria-labelledby="chat-session-title" onClose={() => setEditing(null)} dismissOnBackdrop>
        <form onSubmit={event => { event.preventDefault(); if (editing && !busy) void change(editing, name, editing === "bind" ? bindingId : target?.scene_id); }}>
          <div className="dialog-heading">
            <h2 id="chat-session-title">{editing === "bind" ? "绑定已有场景" : editing === "create" ? "新建场景" : "重命名场景"}</h2>
            <button className="close" type="button" aria-label="关闭场景编辑" disabled={busy} onClick={() => setEditing(null)} />
          </div>
          <p className="utility-subtitle">{editing === "bind" ? "填入同一 Being 在其他客户端的场景 ID，即可继续该场景的对话。" : editing === "create" ? "与同一个 Being 开始一个独立的对话场景。" : "修改名称不会改变场景的历史记录。"}</p>
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
            <button type="submit" disabled={busy || !name.trim() || (editing === "bind" && !bindingId.trim())}>{busy ? "保存中…" : editing === "bind" ? "绑定并进入" : editing === "create" ? "创建并进入" : "保存名称"}</button>
          </div>
        </form>
      </Dialog>
      <Dialog
        id="chat-scene-dialog"
        className="utility-dialog"
        aria-labelledby="chat-scene-heading"
        open={open}
        onClose={() => setOpen(false)}
        dismissOnBackdrop
      >
        <div className="dialog-heading">
          <h2 id="chat-scene-heading">当前场景</h2>
          <button className="close" type="button" aria-label="关闭场景详情" onClick={() => setOpen(false)} />
        </div>
        <p className="chat-scene-name">{label}</p>
        <p className="utility-subtitle">
          {scene
            ? connected
              ? "从这里发送的对话会带上这个场景。"
              : "连接 Being 后，发送的对话会带上这个场景。"
            : "客户端场景不可用，暂时无法发送消息。请查看客户端的启动提示。"}
        </p>
        {scene && <>
          <dl className="chat-scene-details">
            <dt>场景 ID</dt>
            <dd><code id="chat-scene-id">{scene.scene_id}</code></dd>
            <dt>客户端</dt>
            <dd>{scene.scene_meta.client}</dd>
          </dl>
          <div className="files-footer">
            <button id="copy-chat-scene" type="button" onClick={() => onCopy(scene.scene_id)}>复制场景 ID</button>
          </div>
        </>}
      </Dialog>
    </>
  );
}

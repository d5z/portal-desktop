import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { PrivacyContent } from "../../chat/components/panels";
import { createPortal } from "react-dom";
import { PanelResizeHandle, usePanelWidth } from "../../shared/components/panel-resize";
import { CHAT_SCENE_ACTIVITY_LABELS } from "../../../shared/types";
import type { AppModel } from "../models/app";
import { useModel } from "../../shared/hooks/use-model";

const destinations = [
  ["bonfire", "篝火", "M12 3c2 5 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 0 3 1 4 2 4 2-2 2-5 1-8Z"],
  ["firesides", "围炉", "M4 5h16v11H9l-5 4V5Zm4 4h8m-8 3h5"],
  ["mail", "私信", "M3 6h18v13H3V6Zm0 1 9 7 9-7"],
  ["seeds", "种子花园", "M12 21V10m0 6C5 16 3 12 3 7c6 0 9 3 9 9Zm0-4c0-6 3-9 9-9 0 6-3 9-9 9Z"],
  ["embers", "书架", "M4 4h5v16H4V4Zm5 0h5v16H9m7-15 4-1 3 15-4 1-3-15Z"],
  ["scrolls", "卷轴", "M6 3h12v18H6V3Zm3 5h6m-6 4h6m-6 4h4"],
  ["kits", "工具库", "M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm13 0v6m-3-3h6"],
  ["announcements", "公告", "M4 4h16v16H4V4Zm4 4h8m-8 4h8m-8 4h5"],
  ["contacts", "通讯录", "M5 3h16v18H5V3ZM2 7h4m-4 5h4m-4 5h4m5-8a2 2 0 1 0 4 0 2 2 0 1 0-4 0m-2 8v-1a4 4 0 0 1 8 0v1"],
  ["town", "小镇广场", "m3 10 9-7 9 7M5 9v12h14V9m-9 12v-7h4v7"],
] as const;
function Icon({ path }: { path: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>;
}
function RailButton({ label, children, active, disabled, unread, onClick, className = "", plugin = false, id, expanded }: {
  id?: string; expanded?: boolean; label: string; children: ReactNode; active?: boolean; disabled?: boolean; unread?: boolean;
  onClick: () => void; className?: string; plugin?: boolean;
}) {
  const tooltipId = useId();
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null);
  const show = (element: HTMLButtonElement) => {
    const bounds = element.getBoundingClientRect();
    setTip({ left: bounds.right + 12, top: Math.max(24, Math.min(innerHeight - 24, bounds.top + bounds.height / 2)) });
  };
  return <>
    <button id={id} aria-expanded={expanded} className={`rail-button ${className}`} aria-label={label + (unread ? " · 有新动态" : "")} aria-current={active ? "page" : undefined}
      aria-describedby={tip ? tooltipId : undefined} disabled={disabled} data-plugin-navigation={plugin || undefined}
      onMouseEnter={event => show(event.currentTarget)} onMouseLeave={() => setTip(null)}
      onFocus={event => show(event.currentTarget)} onBlur={() => setTip(null)}
      onKeyDown={event => { if (event.key === "Escape") setTip(null); }}
      onClick={() => { setTip(null); onClick(); }}>
      {children}{unread && <span className="rail-unread" aria-hidden="true" />}
    </button>
    {tip && createPortal(<div id={tooltipId} role="tooltip" className="rail-tooltip" style={{ left: tip.left, top: tip.top }}>{label}{unread ? " · 有新动态" : ""}</div>, document.body)}
  </>;
}

export function WorkspaceNavigation({ app }: { app: AppModel }) {
  const town = useModel(app.town), plugins = useModel(app.plugins);
  const name = town.displayName || app.snapshot?.settings.being || "Being";
  return <nav className="workspace-rail" aria-label="主导航">
    <RailButton label={`${name} · 返回主对话`} className="rail-being" onClick={() => void app.returnToMainChat()}>
      <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
    </RailButton>
    <div className="rail-links">
      <RailButton label="对话" active={app.view === "chat"} onClick={() => app.navigate("chat")}><Icon path="M4 4h16v12H9l-5 4V4Z" /></RailButton>
      <RailButton id="toggle-chat-search" expanded={app.searchOpen} label="查找对话" disabled={!app.snapshot?.settings.hasToken} onClick={() => app.openSearch()}><Icon path="m16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></RailButton>
      {destinations.map(([key, label, path]) => <RailButton key={key} label={label} active={app.view === key}
        unread={key === "bonfire" || key === "firesides" || key === "mail" ? town.unread(key) : false}
        onClick={() => app.navigate(key)}><Icon path={path} /></RailButton>)}
      {plugins.navigationViews().map(({ plugin, view }) => <RailButton key={`${plugin.id}:${view.id}`} plugin label={view.title}
        active={app.view === "plugins" && plugins.selected?.id === plugin.id && plugins.selected.view === view.id}
        onClick={() => plugins.open(plugin.id, view.id, undefined, "navigation")}><Icon path="M8 3h8v5h5v8h-5v5H8v-5H3V8h5V3Z" /></RailButton>)}
    </div>
    <div className="rail-settings-placeholder" aria-hidden="true" />
  </nav>;
}
export function BeingInfo({ app }: { app: AppModel }) {
  const town = useModel(app.town);
  const panel = useRef<HTMLElement>(null);
  const [width, setWidth] = usePanelWidth("being", 320);
  const [tab, setTab] = useState("profile");
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const privacyEntry = useRef<HTMLButtonElement>(null);
  const privacyBack = useRef<HTMLButtonElement>(null);
  const closePrivacy = () => { setPrivacyOpen(false); requestAnimationFrame(() => privacyEntry.current?.focus()); };
  useEffect(() => { if (privacyOpen) privacyBack.current?.focus(); }, [privacyOpen]);
  const name = town.displayName || app.snapshot?.settings.being || "Being";
  const status = !app.snapshot?.settings.hasToken ? "未连接" : ({online:"已连接",connecting:"连接中",reconnecting:"重连中",offline:"已离线",degraded:"连接不稳定"}[app.connection] || "正在确认连接");
  const activities = Object.entries(app.chatSceneActivity);
  const hidden = !app.beingInfoOpen || app.view !== "chat";
  const [currentModel, setCurrentModel] = useState('');
  const connected = Boolean(app.snapshot?.settings.hasToken);
  useEffect(() => {
    let active = true;
    setCurrentModel('');
    if (!hidden && connected && !app.subagentSettingsOpen) {
      void app.api.beingModelConfig().then(config => {
        if (active) setCurrentModel(typeof config.model === 'string' ? config.model : '查看与配置');
      }).catch(() => { if (active) setCurrentModel('查看与配置'); });
    }
    return () => { active = false; };
  }, [app, hidden, connected, app.snapshot?.settings.being, app.snapshot?.settings.endpoint, app.subagentSettingsOpen]);

  return <aside ref={panel} style={{ width, flexBasis: width }} id="being-info" className="being-info" aria-label={privacyOpen ? "隐私说明" : "Being 信息"} hidden={hidden}>
    <PanelResizeHandle panel={panel} label="调整 Being 信息宽度" width={width} onResize={setWidth} initial={320} reserve={396} disabled={hidden} />
    <button className="close being-info-close" aria-label={privacyOpen ? "关闭隐私说明" : "关闭 Being 信息"} onClick={() => {
      if (privacyOpen) { closePrivacy(); return; }
      app.toggleBeingInfo(); document.getElementById("toggle-being-info")?.focus();
    }} />
    <div className="being-overview" hidden={privacyOpen}>
    <div className="being-profile">
      <div className="being-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</div>
      <h2>{name}</h2><p className="being-status" data-online={app.connection === "online"}><span aria-hidden="true" />{status}</p>
    </div>
    <div className="being-tabs" role="tablist" aria-label="Being 信息分类">
      {[["profile", "资料"], ["activity", "动态"]].map(([key,label]) => <button key={key} id={`being-${key}-tab`} role="tab" aria-selected={tab === key} aria-controls={`being-${key}-panel`} tabIndex={tab === key ? 0 : -1}
        onKeyDown={event => { if (["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "profile" : event.key === "End" ? "activity" : tab === "profile" ? "activity" : "profile"; setTab(next); document.getElementById(`being-${next}-tab`)?.focus(); } }}
        onClick={() => setTab(key)}>{label}</button>)}
    </div>
    <div className="being-info-content">
    <section id="being-profile-panel" role="tabpanel" aria-labelledby="being-profile-tab" hidden={tab !== "profile"}>
      <h3>关于 Being</h3>
      <dl className="being-details">
        <div><dt>名称</dt><dd>{name}</dd></div>
        <div><dt>小镇身份</dt><dd>{town.live?.beingId || "尚未配对"}</dd></div>
        <div><dt>当前场景</dt><dd>{app.snapshot?.chatScene?.scene_meta.scene_label || "尚未创建"}</dd></div>
        <div><dt>自主醒来</dt><dd><button className="being-wake-switch" type="button" role="switch" aria-label="自主醒来" aria-checked={app.sbsKnown && app.sbsEnabled} disabled={!app.snapshot?.settings.hasToken || !app.sbsKnown || app.chatLoading} onClick={() => app.toggleSbs()}>
          <span>{app.sbsKnown ? app.sbsEnabled ? "已开启" : "已关闭" : "待同步"}</span><span className="being-wake-track" aria-hidden="true" />
        </button></dd></div>
      </dl>
      <button className="being-action-row being-model-entry" disabled={!connected} onClick={() => app.openModelSettings()}><span><strong>模型设置</strong><small>{connected ? currentModel || "正在读取模型…" : "连接后配置模型"}</small></span><span aria-hidden="true">›</span></button>
      <button ref={privacyEntry} className="being-action-row" onClick={() => setPrivacyOpen(true)}>隐私说明<span aria-hidden="true">›</span></button>
      <button className="being-action-row being-connect" onClick={() => app.showSettings()}>连接设置 <span aria-hidden="true">›</span></button>
    </section>
    <section id="being-activity-panel" role="tabpanel" aria-labelledby="being-activity-tab" hidden={tab !== "activity"}>
      <h3>场景动态</h3>
      {activities.length ? <ul className="being-activities">{activities.map(([id, status]) => <li key={id}>
        <span className="being-activity-dot" aria-hidden="true" />
        <div><strong>{app.snapshot?.chatSessions?.find(scene => scene.scene_id === id)?.scene_meta.scene_label || "对话场景"}</strong><p>{CHAT_SCENE_ACTIVITY_LABELS[status]}</p></div>
      </li>)}</ul> : <p className="being-empty">暂时没有新的场景动态</p>}
    </section>
    </div>
    </div>
    {privacyOpen && <section className="being-privacy-panel" aria-labelledby="being-privacy-title" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); closePrivacy(); } }}>
      <header><button ref={privacyBack} className="topbar-icon-button" aria-label="返回资料页" onClick={closePrivacy}>‹</button><h2 id="being-privacy-title">隐私说明</h2></header>
      <div className="being-privacy-content"><PrivacyContent /></div>
    </section>}
  </aside>;
}

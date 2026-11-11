import { ChatSceneIndicator } from "./chat-scene";
import { NavigationIcon } from '../../shared/icons/navigation';
import { WorkspaceDrawer } from "../../shared/components/workspace-drawer";
import { dshRuntime } from "../../plugins/dsh/runtime";
import { PluginIcon } from "../../plugins/icon";
import { RecentHistory } from './recent-history';
import { useNavigationSort } from "./use-navigation-sort";
import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from "react";
import { PrivacyContent } from "../../chat/components/panels";
import { createPortal } from "react-dom";
import { PanelResizeHandle, usePanelWidth } from "../../shared/components/panel-resize";
import type { AppModel } from "../models/app";
import { useModel } from "../../shared/hooks/use-model";
import { BeingComputer } from "./being-computer";
import { BeingLibrary } from "./home-library";

const beingTabs = [["profile", "详情"], ["activity", "动态"], ["library", "资料库"], ["computer", "电脑"]] as const;

const destinations = [
  ["bonfire", "篝火", "rail-bonfire"],
  ["firesides", "围炉", "rail-firesides"],
  ["mail", "私信", "rail-mail"],
  ["seeds", "种子花园", "rail-seeds"],
  ["embers", "书架", "rail-embers"],
  ["scrolls", "卷轴", "rail-scrolls"],
  ["kits", "工具库", "rail-kits"],
  ["announcements", "公告", "rail-announcements"],
  ["contacts", "通讯录", "rail-contacts"],
  ["town", "小镇广场", "rail-town"],
] as const;

function RailButton({ label, children, active, disabled, unread, onClick, className = "", plugin = false, id, expanded, navigationKey, shortcut, tooltip = true }: {
  navigationKey?: string; id?: string; expanded?: boolean; label: string; children: ReactNode; active?: boolean; disabled?: boolean; unread?: boolean;
  onClick: () => void; className?: string; plugin?: boolean; shortcut?: string; tooltip?: boolean;
}) {
  const animateIcon = (button: HTMLButtonElement) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const icon = button.querySelector<SVGSVGElement>('svg[data-navigation-icon]');
    const shape = icon?.querySelector<SVGPathElement>('.rail-icon-line');
    if (!icon || !shape) return;
    const from = getComputedStyle(shape).transform;
    shape.getAnimations().forEach(animation => animation.cancel());
    const poses = icon.dataset.navigationIcon === 'rail-search'
      ? ['translate(1.5px, -1px) rotate(-10deg)', 'translate(-1px, 0) rotate(4deg)']
      : ['rail-scrolls', 'rail-embers', 'rail-contacts', 'rail-announcements'].includes(icon.dataset.navigationIcon!)
        ? ['translateY(-2px) rotate(-5deg)', 'translateY(-0.5px) rotate(2deg)']
        : icon.dataset.navigationIcon === 'rail-mail'
          ? ['translateY(-1px) rotate(8deg)', 'rotate(-3deg)']
          : ['rotate(-9deg) scale(1.06)', 'rotate(4deg) scale(1.02)'];
    shape.animate([
      { transform: from, offset: 0 },
      { transform: poses[0], offset: 0.4 },
      { transform: poses[1], offset: 0.72 },
      { transform: 'none', offset: 1 },
    ], { duration: 680, easing: 'cubic-bezier(0.2, 0.65, 0.3, 1)' });
  };
  const tooltipId = useId();
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null);
  const show = (element: HTMLButtonElement) => {
    const bounds = element.getBoundingClientRect();
    setTip({ left: bounds.right + 12, top: Math.max(24, Math.min(innerHeight - 24, bounds.top + bounds.height / 2)) });
  };
  return <>
    <button data-navigation-key={navigationKey} id={id} aria-expanded={expanded} className={`rail-button ${className}`} aria-label={label + (unread ? " · 有新动态" : "")} aria-current={active ? "page" : undefined}
      aria-describedby={tip ? tooltipId : undefined} disabled={disabled} data-plugin-navigation={plugin || undefined}
      onPointerDown={event => {
        setTip(null);
        event.currentTarget.querySelector('.rail-icon-line')?.getAnimations().forEach(animation => animation.cancel());
      }} onMouseEnter={event => { animateIcon(event.currentTarget); if (tooltip) show(event.currentTarget); }} onMouseLeave={() => setTip(null)}
      onFocus={event => {
        if (event.currentTarget.matches(':focus-visible')) animateIcon(event.currentTarget);
        if (tooltip) show(event.currentTarget);
      }} onBlur={() => setTip(null)}
      onKeyDown={event => { if (event.key === "Escape") setTip(null); }}
      onClick={() => { setTip(null); onClick(); }}>
      {children}{unread && <span className="rail-unread" aria-hidden="true" />}
    </button>
    {tip && createPortal(<div id={tooltipId} role="tooltip" className="rail-tooltip" style={{ left: tip.left, top: tip.top }}><span>{label}{unread ? " · 有新动态" : ""}</span>{shortcut && <kbd>{shortcut}</kbd>}</div>, document.body)}
  </>;
}

const PINNED_NAVIGATION_KEY = "beings:pinned-navigation";
const defaultPins = ["bonfire", "firesides", "mail"];
function readPinnedNavigation(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PINNED_NAVIGATION_KEY) || "null");
    if (Array.isArray(saved) && saved.every(key => typeof key === "string")) return saved;
  } catch { /* Use defaults when local preferences are unavailable. */ }
  return defaultPins;
}

export function WorkspaceNavigation({ app }: { app: AppModel }) {
  const town = useModel(app.town), plugins = useModel(app.plugins);
  const name = town.displayName || app.snapshot?.settings.being || "Being";
  const [pins, setPins] = useState(readPinnedNavigation);
  const [order, setOrder] = useState<string[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem("beings:navigation-order") || "null");
      return Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string") : [];
    } catch { return []; }
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const morePanel = useRef<HTMLDivElement>(null);
  const closeMore = (restoreFocus = false) => {
    setMoreOpen(false);
    if (restoreFocus) document.getElementById("rail-more-trigger")?.focus();
  };
  useEffect(() => {
    if (!moreOpen) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!morePanel.current?.contains(target) && !document.getElementById("rail-more-trigger")?.contains(target)) setMoreOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeMore(true); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    morePanel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [moreOpen]);
  const entries = [
    ...destinations.map(([key, label, glyph]) => ({
      key, label, glyph, icon: undefined, active: app.view === key, plugin: false,
      unread: key === "bonfire" || key === "firesides" || key === "mail" ? town.unread(key) : false,
      open: () => app.navigate(key),
    })),
    ...plugins.navigationViews().map(({ plugin, view }) => ({
      key: `plugin:${plugin.id}:${view.id}`, label: view.title, icon: plugins.icon(plugin.id, view.id),
      glyph: "plugin-navigation" as const, plugin: true, unread: false,
      active: app.view === "plugins" && plugins.selected?.id === plugin.id && plugins.selected.view === view.id,
      open: () => plugins.open(plugin.id, view.id, undefined, "navigation"),
    })),
  ];
  const togglePin = (key: string) => {
    const next = pins.includes(key) ? pins.filter(pin => pin !== key) : [...pins, key];
    setPins(next);
    try { localStorage.setItem(PINNED_NAVIGATION_KEY, JSON.stringify(next)); } catch { /* Keep the session preference. */ }
  };
  const visibleKeys = ["chat", "search", ...pins.filter(key => entries.some(entry => entry.key === key))];
  const orderedKeys = [...new Set([...order.filter(key => visibleKeys.includes(key)), ...visibleKeys])];
  const sort = useNavigationSort(orderedKeys, next => {
    setOrder(next);
    try { localStorage.setItem("beings:navigation-order", JSON.stringify(next)); } catch { /* Keep session order. */ }
  });
  const connected = Boolean(app.snapshot?.settings.hasToken);
  return <nav className="workspace-rail" aria-label="主导航">
    {app.startup === 'ready' && <ChatSceneIndicator
      beingName={name} onHome={() => void app.returnToMainChat()}
      createRequest={app.chatSessionCreateRequest}
      scene={app.snapshot?.chatScene} sessions={app.snapshot?.chatSessions} activity={app.chatSceneActivity}
      onSession={(operation, value, sceneId) => app.changeChatSession(operation, value, sceneId)}
      connected={connected} scope={app.chatHistoryScope}
      scopeReady={connected && !app.chatLoading && app.chatHistoryScopeKnown}
      onScope={scope => app.changeChatHistoryScope(scope)}
      onCopy={id => void app.run(async () => { await app.api.copyText(id); app.toast('场景 ID 已复制'); })}
    />}
    <div className="rail-links" {...sort}>
      {orderedKeys.map(key => {
        if (key === "chat") return <RailButton key={key} navigationKey={key} id="rail-chat-trigger" tooltip={false} label="对话" shortcut={app.api.platform === 'darwin' ? '⌘1' : 'Ctrl 1'} active={app.view === "chat"} onClick={() => app.navigate("chat")}><NavigationIcon name="rail-chat" /></RailButton>;
        if (key === "search") return <RailButton key={key} navigationKey={key} id="toggle-chat-search" expanded={app.searchOpen} label="查找对话" shortcut={app.api.platform === 'darwin' ? '⌘F' : 'Ctrl F'} disabled={!app.snapshot?.settings.hasToken} onClick={() => app.openSearch()}><NavigationIcon name="rail-search" /></RailButton>;
        const entry = entries.find(entry => entry.key === key)!;
        return <RailButton key={key} navigationKey={key} label={entry.label} active={entry.active}

          plugin={entry.plugin} unread={entry.unread} onClick={entry.open}>{entry.plugin ? <PluginIcon icon={entry.icon} /> : <NavigationIcon name={entry.glyph} />}</RailButton>;
      })}
      <div id="dsh-navigation" className="dsh-navigation" ref={dshRuntime.setNavigationHost} />
      <RailButton id="rail-more-trigger" label={moreOpen ? "收起更多功能" : "更多功能"} expanded={moreOpen}
        active={entries.some(entry => !pins.includes(entry.key) && entry.active)}
        unread={entries.some(entry => !pins.includes(entry.key) && entry.unread)} onClick={() => setMoreOpen(open => !open)}>
        <NavigationIcon name={moreOpen ? "rail-collapse" : "rail-more"} />
      </RailButton>
    </div>
    <div className="rail-settings-placeholder" aria-hidden="true" />
    {moreOpen && createPortal(<div ref={morePanel} className="rail-more-panel" role="dialog" aria-label="更多功能">
      <header><div><strong>更多功能</strong><p>将常用功能固定到左侧</p></div><button aria-label="收起更多功能" onClick={() => closeMore(true)}>×</button></header>
      <div className="rail-more-list">{entries.map(entry => <div className="rail-more-row" key={entry.key}>
        <button className="rail-more-destination" aria-current={entry.active ? "page" : undefined} data-plugin-navigation={entry.plugin || undefined}
          onClick={() => { closeMore(); entry.open(); }}>{entry.plugin ? <PluginIcon icon={entry.icon} /> : <NavigationIcon name={entry.glyph} />}<span>{entry.label}</span>{entry.unread && <i aria-label="有新动态" />}</button>
        <button className="rail-pin-button" aria-label={`${pins.includes(entry.key) ? "取消固定" : "固定到左侧"}：${entry.label}`}
          aria-pressed={pins.includes(entry.key)} title={pins.includes(entry.key) ? "取消固定" : "固定到左侧"} onClick={() => togglePin(entry.key)}>
          <NavigationIcon name="rail-pin" />
        </button>
      </div>)}</div>
    </div>, document.body)}
  </nav>;
}
// Load on first visit, then keep state when the tab or the whole panel is hidden.
function RetainedBeingTab({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(false);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  return active || visited ? children : null;
}

export function BeingInfo({ app }: { app: AppModel }) {
  const town = useModel(app.town);
  const panel = useRef<HTMLElement>(null);
  const [width, setWidth] = usePanelWidth("being", 320);
  const [browserHost, setBrowserHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setBrowserHost(panel.current?.parentElement || null); }, []);
  const [tab, setTab] = useState<typeof beingTabs[number][0]>("library");
  const [privacyOpen, setPrivacyOpen] = useState(false);
  useLayoutEffect(() => { if (app.beingInfoOpen) { setTab('library'); setPrivacyOpen(false); } }, [app.beingInfoOpen]);
  const privacyEntry = useRef<HTMLButtonElement>(null);
  const privacyBack = useRef<HTMLButtonElement>(null);
  const closePrivacy = () => { setPrivacyOpen(false); requestAnimationFrame(() => privacyEntry.current?.focus()); };
  useEffect(() => { if (privacyOpen) privacyBack.current?.focus(); }, [privacyOpen]);
  const name = town.displayName || app.snapshot?.settings.being || "Being";
  const status = !app.snapshot?.settings.hasToken ? "未连接" : ({online:"已连接",connecting:"连接中",reconnecting:"重连中",offline:"已离线",degraded:"连接不稳定"}[app.connection] || "正在确认连接");
  const hidden = !app.beingInfoOpen || app.view !== "chat" || (app.subagentSettingsOpen && !app.settingsRoute);
  const browserAvailable = app.view === "chat" && !(app.subagentSettingsOpen && !app.settingsRoute);
  const modelKey = JSON.stringify([app.snapshot?.settings.endpoint, app.snapshot?.settings.being, app.snapshot?.settings.hasToken]);
  const content = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  useLayoutEffect(() => { scrollPositions.current = {}; }, [modelKey]);
  useLayoutEffect(() => {
    if (!hidden && !privacyOpen && content.current) content.current.scrollTop = scrollPositions.current[tab] || 0;
  }, [tab, hidden, privacyOpen, modelKey]);
  const libraryActive = !hidden && !privacyOpen && tab === 'library';
  const activityActive = !hidden && !privacyOpen && tab === 'activity';
  const [modelPreview, setModelPreview] = useState({ key: '', label: '' });
  const currentModel = modelPreview.key === modelKey ? modelPreview.label : '';
  const connected = Boolean(app.snapshot?.settings.hasToken);
  useEffect(() => {
    let active = true;
    if (!hidden && connected && !app.subagentSettingsOpen) {
      void app.api.beingModelConfig().then(config => {
        if (active) setModelPreview({ key: modelKey, label: typeof config.model === 'string' ? config.model : '查看与配置' });
      }).catch(() => { if (active) setModelPreview(previous => previous.key === modelKey && previous.label ? previous : { key: modelKey, label: '查看与配置' }); });
    }
    return () => { active = false; };
  }, [app, hidden, connected, modelKey, app.subagentSettingsOpen]);

  const closeInfo = () => { app.toggleBeingInfo(); document.getElementById("toggle-being-info")?.focus(); };
  return <WorkspaceDrawer ref={panel} open={!hidden} style={{ width, flexBasis: width }} id="being-info" className="being-info" aria-label={privacyOpen ? "隐私说明" : "Being 信息"}
    onKeyDown={event => {
      if (event.key === "Escape" && !event.defaultPrevented && !privacyOpen) {
        event.stopPropagation(); closeInfo();
      }
    }}>
    <PanelResizeHandle panel={panel} label="调整 Being 信息宽度" width={width} onResize={setWidth} initial={320} max={900} reserve={396} disabled={hidden} />
    <div className="being-info-body">
    <button className="close being-info-close" aria-label={privacyOpen ? "关闭隐私说明" : "关闭 Being 信息"} onClick={() => {
      if (privacyOpen) { closePrivacy(); return; }
      closeInfo();
    }} />
    <div className="being-overview" hidden={privacyOpen}>
    <div className="being-profile">
      <div className="being-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</div>
      <h2>{name}</h2><p className="being-status" data-online={app.connection === "online"}><span aria-hidden="true" />{status}</p>
    </div>
    <div className="being-tabs" role="tablist" aria-label="Being 信息分类">
      {beingTabs.map(([key,label], index) => <button type="button" key={key} id={`being-${key}-tab`} role="tab" aria-selected={tab === key} aria-controls={`being-${key}-panel`} tabIndex={tab === key ? 0 : -1}
        onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? beingTabs.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + beingTabs.length) % beingTabs.length;
          const next = beingTabs[nextIndex][0];
          setTab(next); document.getElementById(`being-${next}-tab`)?.focus();
        }}
        onClick={() => setTab(key)}>{label}</button>)}
    </div>
    <div ref={content} className="being-info-content" onScroll={event => {
      if (!hidden && !privacyOpen) scrollPositions.current[tab] = event.currentTarget.scrollTop;
    }}>
    <section id="being-profile-panel" role="tabpanel" tabIndex={0} aria-labelledby="being-profile-tab" hidden={tab !== "profile"}>
      <h3>当前状态</h3>
      <dl className="being-details">
        <div><dt>当前场景</dt><dd>{app.snapshot?.chatScene?.scene_meta.scene_label || "尚未创建"}</dd></div>
        <div><dt>自主醒来</dt><dd><button className="being-wake-switch" type="button" role="switch" aria-label="自主醒来" aria-checked={app.sbsKnown && app.sbsEnabled} disabled={!app.snapshot?.settings.hasToken || !app.sbsKnown || app.chatLoading} onClick={() => app.toggleSbs()}>
          <span>{app.sbsKnown ? app.sbsEnabled ? "已开启" : "已关闭" : "待同步"}</span><span className="being-wake-track" aria-hidden="true" />
        </button></dd></div>
      </dl>
      <button className="being-action-row being-model-entry" disabled={!connected} onClick={() => app.openModelSettings()}><span><strong>模型设置</strong><small>{connected ? currentModel || "正在读取模型…" : "连接后配置模型"}</small></span><span aria-hidden="true">›</span></button>
      <button ref={privacyEntry} className="being-action-row" onClick={() => setPrivacyOpen(true)}>隐私说明<span aria-hidden="true">›</span></button>
      <button className="being-action-row being-connect" onClick={() => app.showSettings()}>连接设置 <span aria-hidden="true">›</span></button>
    </section>
    <section id="being-activity-panel" role="tabpanel" tabIndex={0} aria-labelledby="being-activity-tab" hidden={tab !== "activity"}>
      <RetainedBeingTab key={modelKey} active={activityActive}><RecentHistory app={app} visible={activityActive} /></RetainedBeingTab>
    </section>
    <section id="being-library-panel" role="tabpanel" tabIndex={0} aria-labelledby="being-library-tab" hidden={tab !== "library"}>
      <RetainedBeingTab key={modelKey} active={libraryActive}><BeingLibrary api={app.api.home} active={libraryActive} onConnect={() => setTab('computer')} /></RetainedBeingTab>
    </section>
    <section id="being-computer-panel" role="tabpanel" tabIndex={0} aria-labelledby="being-computer-tab" hidden={tab !== "computer"}>
      <BeingComputer name={name} api={app.api.home} active={!hidden && !privacyOpen && tab === "computer"} context={app.snapshot?.settings.endpoint || ""} browserHost={browserHost} available={browserAvailable} />
    </section>
    </div>
    </div>
    {privacyOpen && <section className="being-privacy-panel" aria-labelledby="being-privacy-title" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); closePrivacy(); } }}>
      <header><button ref={privacyBack} className="topbar-icon-button" aria-label="返回资料页" onClick={closePrivacy}>‹</button><h2 id="being-privacy-title">隐私说明</h2></header>
      <div className="being-privacy-content"><PrivacyContent /></div>
    </section>}
    </div>
  </WorkspaceDrawer>;
}

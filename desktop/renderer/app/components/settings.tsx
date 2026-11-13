import { Icon } from '../../shared/icons/icon';
import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { PermissionPicker } from '../../shared/components/permission-picker';
import type { AppModel } from "../models/app";
import { Dialog } from "../../shared/components/dialog";
import { SettingsSurface, SettingsItem, SettingsField, type SettingsDetail } from "../../shared/components/settings-surface";
import { SubagentModelSettings } from "./subagent-model-settings";
import { TownAuth } from "../../town/components/auth";
import { Portal } from "../../portal/page";
import { Diagnostics } from "./diagnostics";
import { NavigationControls } from "../../shared/components/navigation-controls";
import { navigateTabs } from "../../shared/lib/tab-navigation";
import { MAX_CHAT_HISTORY_LIMIT, validChatHistoryLimit } from '../../../shared/chat-history';
import { dshRuntime } from '../../plugins/dsh/runtime';
import { PluginCard } from '../../plugins/page';
import { useManagerFocus } from '../../plugins/dsh/use-manager-focus';
import { useModel } from '../../shared/hooks/use-model';
import { ConnectorSettings } from './connectors';
const baseSettingsTabs = [
  { id: "being", label: "Being", group: "connection", icon: "settings-being" as const },
  { id: "portal", label: "Portal", group: "connection", icon: "settings-portal" as const },
  { id: "town", label: "Town", group: "connection", icon: "settings-town" as const },
  { id: "models", label: "模型", group: "workspace", icon: "settings-models" as const },
  { id: "appearance", label: "外观与阅读", group: "workspace", icon: "settings-appearance" as const },
  { id: "general", label: "通用", group: "workspace", icon: "menu-settings" as const },
  { id: "apps", label: "应用", group: "extensions", icon: "web-grid" as const },
];
export const ClientSettings = memo(function ClientSettings({ model }: { model: AppModel }) {
  // A closed dialog retains its form state without reconciling
  // every control on background chat, Portal and Town notifications.
  useSyncExternalStore(model.subscribe, () => model.clientSettingsOpen || model.settingsRoute ? model.getVersion() : -1);
  useSyncExternalStore(model.town.subscribe, () => model.settingsRoute === "town" ? model.town.getVersion() : -1);
  const app = model;
  const plugins = useModel(app.plugins);
  const [pluginKind, setPluginKind] = useState<'town' | 'dsh'>('town');
  const [townPluginId, setTownPluginId] = useState('');
  const dshPluginId = useSyncExternalStore(dshRuntime.subscribe, () => dshRuntime.managedPlugin || '');
  useEffect(() => {
    dshRuntime.settingsNavigate = () => { setPluginKind('dsh'); app.openPluginSettings(); };
    return () => { dshRuntime.settingsNavigate = undefined; };
  }, [app]);
  const open = app.clientSettingsOpen || Boolean(app.settingsRoute);
  const settingsTabs = app.api.dshPlugins ? [...baseSettingsTabs, {id:'plugins', label:'插件', group:'extensions', icon:'settings-plugins' as const}] : baseSettingsTabs;
  const [tabQuery, setTabQuery] = useState("");
  const normalizedTabQuery = tabQuery.trim().toLocaleLowerCase();
  const visibleSettingsTabs = normalizedTabQuery
    ? settingsTabs.filter(item => item.label.toLocaleLowerCase().includes(normalizedTabQuery))
    : settingsTabs;
  const route = app.settingsRoute;
  const [connectorDetail, setConnectorDetail] = useState<SettingsDetail | null>(null);
  const [modelDetail, setModelDetail] = useState<SettingsDetail | null>(null);
  const [generalDetail, setGeneralDetail] = useState<'notifications' | null>(null);
  const [modelBusy, setModelBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const pluginBusy = useSyncExternalStore(dshRuntime.subscribe, () => Boolean(dshRuntime.settingsHost && dshRuntime.settingsBusy));
  const busy = pluginBusy || app.saving || modelBusy || leaving || (route === "town" && app.town.authBusy && !app.town.autoPairId);
  const leave = async (close = false, discard = false) => {
    if (busy) return false;
    if (close && app.hasConnectionDraft && !discard) { setConfirmClose(true); return false; }
    setConfirmClose(false);
    if (route === "town") {
      setLeaving(true);
      try { await app.town.closeAuth(); }
      finally { setLeaving(false); }
      if (app.town.authOpen) return false;
    }
    if (close) app.closeClientSettings();
    else app.returnToClientSettings();
    return true;
  };
  useEffect(() => {
    dshRuntime.closeSettings = open ? () => leave(true) : undefined;
    return () => { dshRuntime.closeSettings = undefined; };
  }, [app, open, busy, route]);
  const [downloadDirectory,setDownloadDirectory]=useState("");
  const [downloadError,setDownloadError]=useState("");
  const [choosingDownload,setChoosingDownload]=useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setDownloadError("");
    void app.api.downloadDirectory?.().then(value => { if (active) setDownloadDirectory(value || ""); })
      .catch(() => { if (active) setDownloadError("下载设置读取失败，请重新打开设置重试。"); });
    return () => { active = false; };
  }, [open, app.api]);
  const [tab, setTab] = useState("being");
  const body = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(max-width:720px)").matches);
  useEffect(() => {
    const media = matchMedia("(max-width:720px)");
    const update = () => setCompact(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const pageScroll = useRef(new Map<string, number>());
  const [historyLimit, setHistoryLimit] = useState(String(app.chatHistoryLimit));
  useEffect(() => { setHistoryLimit(String(app.chatHistoryLimit)); }, [app.chatHistoryLimit, app.clientSettingsOpen]);

  const routeTab = route === 'connection' ? (app.connectionSettingsSection === 'subagent' ? 'models' : app.connectionSettingsSection)
    : route === 'diagnostics' ? 'general' : route === 'model' ? 'models' : route;
  useLayoutEffect(() => { if (routeTab) setTab(routeTab); if (routeTab === 'plugins') setPluginKind('dsh'); }, [routeTab]);
  const activeTab = routeTab || tab;
  useEffect(() => {
    if (!open || activeTab !== 'apps') setConnectorDetail(null);
  }, [open, activeTab]);
  useLayoutEffect(() => {
    if (open && compact) document.getElementById(`settings-tab-${activeTab}`)?.scrollIntoView({block:'nearest', inline:'nearest'});
  }, [activeTab, open, compact]);
  useEffect(() => { if (open && activeTab === 'plugins') void dshRuntime.refresh().catch(app.toast); }, [open, activeTab, app]);
  const townPlugin = plugins.library.plugins.find(plugin => plugin.manifest.id === townPluginId);
  const detailId = activeTab === 'plugins' ? (pluginKind === 'dsh' ? dshPluginId : townPlugin?.manifest.id) : undefined;
  const detail: SettingsDetail | null = activeTab === 'apps' ? connectorDetail : activeTab === 'models' ? modelDetail
    : route === 'connection' && activeTab === 'portal' ? { id: 'connection', title: '本机配置', back: app.returnToClientSettings }
    : route === 'diagnostics' ? { id: 'diagnostics', title: '连接诊断', back: app.returnToClientSettings }
    : activeTab === 'general' && generalDetail ? { id: generalDetail, title: '通知设置', back: () => setGeneralDetail(null) } : null;
  const title = detail?.title || (detailId ? (pluginKind === 'town' ? townPlugin?.manifest.name : dshPluginId) : settingsTabs.find(item => item.id === activeTab)?.label);
  // A path identifies the right-hand page independently of the outer modal.
  const pagePath = activeTab === 'plugins' ? `${activeTab}/${pluginKind}${detailId ? `/${detailId}` : ''}` : `${activeTab}${detail ? `/${detail.id}` : ''}`;
  const backToPlugins = () => {
    const back = () => { if (pluginKind === 'dsh') dshRuntime.openManager(); else setTownPluginId(''); };
    if (pluginKind === 'dsh' && dshRuntime.requestSettingsLeave) dshRuntime.requestSettingsLeave(back); else back();
  };
  const heading = useRef<HTMLHeadingElement>(null);
  const continueEditing = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    if (body.current) body.current.scrollTop = pageScroll.current.get(pagePath) || 0;
    heading.current?.focus({ preventScroll: true });
  }, [pagePath, open]);
  useLayoutEffect(() => { if (confirmClose) continueEditing.current?.focus(); }, [confirmClose]);
  useEffect(() => { if (!open || !app.hasConnectionDraft) setConfirmClose(false); }, [open, app.hasConnectionDraft]);
  // The outer modal stays mounted while the right-hand page changes.
  const previouslyOpen = useRef(false);
  useLayoutEffect(() => {
    const opening = open && !previouslyOpen.current;
    previouslyOpen.current = open;
    if (!open) return;
    if (route === 'model' || opening && activeTab === 'models') app.openConnectionSettings('subagent');
    else if (opening && activeTab === 'being' && !app.settingsOpen) app.openConnectionSettings();
  }, [app, open, activeTab, route]);
  const selectTab = async (next: string) => {
    if (busy || next === activeTab) return;
    if (route && !await leave()) return;
    setTabQuery('');
    setConnectorDetail(null);
    setGeneralDetail(null);
    setModelDetail(null);
    setTab(next);
    if (next === 'being') app.openConnectionSettings();
    else if (next === 'portal') app.openPortalSettings();
    else if (next === 'town') app.openTownSettings();
    else if (next === 'models') {
      app.subagentFromConnection = false;
      app.modelSettingsTarget = 'Heart';
      app.openConnectionSettings('subagent');
    }
  };
  const close = () => {
    const action = () => void leave(true);
    if (dshRuntime.settingsHost && dshRuntime.requestSettingsLeave) dshRuntime.requestSettingsLeave(action);
    else action();
  };
  // Community settings open editors/previews in document.body. Keep the frame
  // out of Chromium's top layer, with the same background and focus isolation.
  useManagerFocus(open, close, 'client-settings-dialog');
  return (
    <>
    {open && <div className="client-settings-backdrop" />}
    <Dialog
      open={open}
      modal={false}
      aria-modal="true"
      busy={busy}
      onClose={close}
      id="client-settings-dialog"
      aria-labelledby="client-settings-title"
    >
      <div className="client-settings-content">
        <div className="dialog-heading">
          <div className="dialog-heading-main">
            <h2 id="client-settings-title">设置</h2>
          </div>
          <label className="settings-nav-search">
            <Icon name="search-20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.6} />
            <input
              type="search"
              aria-label="搜索设置"
              placeholder="搜索设置"
              value={tabQuery}
              onChange={event => setTabQuery(event.target.value)}
            />
          </label>
          <button
            type="button"
            id="close-client-settings"
            className="close"
            aria-label="关闭客户端设置"
            disabled={busy}
            onClick={close}
          ></button>
        </div>
        <div className="settings-tabs" role="tablist" aria-label="设置分类" aria-orientation={compact ? "horizontal" : "vertical"} onKeyDown={navigateTabs}>
          {visibleSettingsTabs.map((item, index) => <div key={item.id} className="settings-tab-wrap">
            {index > 0 && item.group !== visibleSettingsTabs[index - 1]?.group && <span className="settings-tab-separator" aria-hidden="true" />}
            <button id={`settings-tab-${item.id}`} role="tab"
              aria-controls={`settings-panel-${item.id}`} aria-selected={activeTab === item.id}
              disabled={busy} tabIndex={activeTab === item.id || index === 0 && !visibleSettingsTabs.some(tab => tab.id === activeTab) ? 0 : -1} onClick={() => { const action = () => void selectTab(item.id); if (dshRuntime.settingsHost && dshRuntime.requestSettingsLeave) dshRuntime.requestSettingsLeave(action); else action(); }}
              >
              <Icon name={item.icon} />
              {item.label}
            </button>
          </div>)}
          {!visibleSettingsTabs.length && <p className="settings-tabs-empty">没有匹配的设置</p>}
        </div>
        <section className="settings-page">
        <div className="settings-page-heading">
          {(detailId || detail) && <button className="settings-page-back"
            aria-label={detailId ? '返回插件列表' : `返回${settingsTabs.find(item => item.id === activeTab)?.label}`}
            disabled={busy} onClick={detailId ? backToPlugins : detail?.back}><Icon name="chevron-left-20" /></button>}
          <h2 className="settings-page-title" ref={heading} tabIndex={-1}>{title}</h2>
        </div>
        {confirmClose && <div className="settings-unsaved" role="alert">
          <span>配置尚未保存。关闭会放弃本次修改。</span>
          <div><button ref={continueEditing} type="button" disabled={busy} onClick={async () => {
            if (route !== "connection") {
              if (!await leave()) return;
              app.openConnectionSettings(app.connectionSettingsSection);
            } else setConfirmClose(false);
            heading.current?.focus();
          }}>继续编辑</button>
          <button type="button" disabled={busy} onClick={() => void leave(true, true)}>放弃并关闭</button></div>
        </div>}
        <div className="dialog-body settings-home-body settings-inline-body" ref={body} onScroll={event => pageScroll.current.set(pagePath, event.currentTarget.scrollTop)}>
        <div id="settings-panel-plugins" role="tabpanel" aria-labelledby="settings-tab-plugins" hidden={activeTab !== 'plugins'}>
          <div className="plugin-library-tabs" hidden={Boolean(detailId)} role="tablist" aria-label="设置中的插件类型" onKeyDown={navigateTabs}>
            {([['town','官方插件'],['dsh','第三方插件']] as const).map(([kind,label]) => <button key={kind} role="tab" id={`settings-plugin-${kind}`} aria-controls={`settings-plugin-content-${kind}`} aria-selected={pluginKind === kind} tabIndex={pluginKind === kind ? 0 : -1} onClick={() => { const change = () => setPluginKind(kind); if (dshRuntime.requestSettingsLeave) dshRuntime.requestSettingsLeave(change); else change(); }}>{label}</button>)}
          </div>
          <div id="settings-plugin-content-town" role="tabpanel" aria-labelledby="settings-plugin-town" hidden={pluginKind !== 'town'}>
            {townPlugin ? <PluginCard embedded key={townPlugin.manifest.id} model={plugins} plugin={townPlugin} beforeOpen={() => leave(true)} /> : <div className="settings-plugin-list">{plugins.library.plugins.map(plugin => <button className="settings-plugin-link" key={plugin.manifest.id} onClick={() => setTownPluginId(plugin.manifest.id)}>
              <span><strong>{plugin.manifest.name}</strong><small>{plugin.manifest.description}</small></span><Icon name="chevron-right-20" />
            </button>)}</div>}
            {!plugins.library.plugins.length && <p className="field-help">尚未安装官方插件，可在工具库的 Plugin 中添加。</p>}
          </div>
          <div id="settings-plugin-content-dsh" role="tabpanel" aria-labelledby="settings-plugin-dsh" hidden={pluginKind !== 'dsh'}>
            {open && <div className="dsh-settings-host" ref={dshRuntime.setSettingsHost} />}
          </div>

        </div>
        <div id="settings-panel-being" role="tabpanel" aria-labelledby="settings-tab-being" hidden={activeTab !== 'being'}>
          {open && activeTab === 'being' && <>
            <SettingsItem label="自主醒来" htmlFor="settings-sbs" description={app.sbsKnown ? "允许 Being 在没有新消息时主动思考与行动。" : "连接 Being 后同步开关状态。"}>
              <input id="settings-sbs" type="checkbox" role="switch" checked={app.sbsKnown && app.sbsEnabled}
                disabled={!app.snapshot?.settings.hasToken || !app.sbsKnown || app.chatLoading || busy} onChange={() => app.toggleSbs()} />
            </SettingsItem>
            <ConnectionSettings model={app} embedded inline />
          </>}
        </div>
        <div id="settings-panel-town" role="tabpanel" aria-labelledby="settings-tab-town" hidden={activeTab !== 'town'}>
          {open && activeTab === 'town' && <TownAuth model={app.town} embedded inline />}
        </div>
        <div id="settings-panel-models" role="tabpanel" aria-labelledby="settings-tab-models" hidden={activeTab !== 'models'}>
          {open && activeTab === 'models' && <>
            <SubagentModelSettings app={app} embedded inline onBusyChange={setModelBusy} onDetailChange={setModelDetail} detailOpen={Boolean(modelDetail)}
              subagentConfiguration={route === 'connection' && <ConnectionSettings model={app} embedded inline locked={modelBusy} />} />
          </>}
        </div>
        <div id="settings-panel-portal" role="tabpanel" aria-labelledby="settings-tab-portal" hidden={activeTab !== 'portal'}>
          {open && activeTab === 'portal' && (detail ? <ConnectionSettings model={app} embedded inline /> : <Portal model={app} embedded configuration={
            <button className="settings-page-link" onClick={() => app.openConnectionSettings('portal')}><span><strong>本机配置</strong><small>名称、工作目录、后台常驻与工具权限</small></span><Icon name="chevron-right-20" /></button>
          } />)}
        </div>
        <div
          id="settings-panel-appearance"
          role="tabpanel"
          aria-labelledby="settings-tab-appearance"
          hidden={activeTab !== "appearance"}
        >
          <section
            className="settings-group appearance-settings-group"
            aria-labelledby="settings-appearance"
          >
            <h3 id="settings-appearance">外观</h3>
            <div className="settings-section-card">
              <SettingsItem label="主题配色">
                <div id="theme-toggle" className="theme-options" role="group" aria-label="主题配色">
                  {(["light", "dark"] as const).map(theme => (
                    <button key={theme} id={`theme-${theme}`} type="button"
                      aria-pressed={app.colorScheme === theme}
                      onClick={() => void app.setTheme(theme)}>
                      <Icon name={theme === 'light' ? 'sun-20' : 'moon-20'}  />
                      {theme === "light" ? "浅色" : "深色"}
                    </button>
                  ))}
                </div>
              </SettingsItem>
              <div className="reading-setting">
                <label htmlFor="reading-size">
                  阅读字号{" "}
                  <output id="reading-size-value" htmlFor="reading-size">
                    {app.readingSize} px
                  </output>
                </label>
                <input
                  id="reading-size"
                  type="range"
                  min="13"
                  max="21"
                  step="1"
                  value={app.readingSize}
                  style={{ backgroundImage: `linear-gradient(to right, var(--accent) ${(app.readingSize - 13) / 8 * 100}%, var(--line) ${(app.readingSize - 13) / 8 * 100}%)` }}
                  aria-describedby="reading-size-help"
                  onChange={(event) => app.setReadingSize(Number(event.target.value))}
                />
                <div className="reading-sample" aria-label="阅读字号预览">
                  <span>预览</span><p style={{fontSize:app.readingSize}}>今天，从一个小想法开始。</p>
                </div>
                <div className="reading-setting-footer">
                  <p id="reading-size-help">应用于对话与 Town 正文</p>
                  <button id="reading-reset" type="button" onClick={() => app.setReadingSize(16)}>恢复默认</button>
                </div>
              </div>
            </div>
            <h3>阅读与对话</h3>
            <div className="settings-section-card">
              <SettingsItem label="显示思考链路" htmlFor="show-reasoning" descriptionId="show-reasoning-help" description="查看服务端返回的思考过程与工具调用。关闭时，以省略号气泡提示正在处理。">
                <input id="show-reasoning" type="checkbox" role="switch" aria-label="显示思考链路" aria-describedby="show-reasoning-help"
                  checked={app.showReasoning} onChange={event => app.setShowReasoning(event.target.checked)} />
              </SettingsItem>
              <form className="reading-setting history-setting" onSubmit={event => { event.preventDefault(); app.setChatHistoryLimit(Number(historyLimit)); }}>
                <SettingsItem label="每次加载的历史消息数" descriptionId="chat-history-limit-help" description={`可设为 1–${MAX_CHAT_HISTORY_LIMIT} 条，默认 100 条。保存后用于后续加载，已有记录会保留。`}>
                  <span className="history-setting-input">
                    <input id="chat-history-limit" aria-label="每次加载的历史消息数" type="number" min="1" max={MAX_CHAT_HISTORY_LIMIT} step="1" required
                      value={historyLimit} aria-describedby="chat-history-limit-help" onChange={event => setHistoryLimit(event.target.value)} />
                    <span aria-hidden="true">条</span>
                  </span>
                  <button type="submit" disabled={!validChatHistoryLimit(Number(historyLimit)) || Number(historyLimit) === app.chatHistoryLimit}>保存</button>
                </SettingsItem>
              </form>
            </div>
          </section>
        </div>
        <div
          id="settings-panel-general"
          role="tabpanel"
          aria-labelledby="settings-tab-general"
          hidden={activeTab !== "general"}
        >
          <div hidden={Boolean(detail)}>
          <section className="settings-group general-settings-group" aria-labelledby="settings-downloads-heading">
            <h3 id="settings-downloads-heading">其他</h3>
            <div className="settings-section-card">
              <SettingsItem label={<span id="settings-downloads">下载位置</span>} description={downloadDirectory || '首次下载时选择保存位置'}>
                <button className="download-setting-change" type="button" aria-label="设置下载位置" disabled={choosingDownload} onClick={async()=>{
                  setChoosingDownload(true);setDownloadError('');
                  try {const value=await app.api.downloadDirectory?.(true);if(value)setDownloadDirectory(value);}
                  catch {setDownloadError('无法设置下载位置，请重试');}finally{setChoosingDownload(false);}
                }}>{choosingDownload ? '选择中…' : downloadDirectory ? '更改' : '选择'}</button>
              </SettingsItem>
              {downloadError && <p className="general-setting-help" role="alert">{downloadError}</p>}
            </div>
          </section>
          <section className="settings-group general-settings-group" aria-labelledby="settings-notifications-link-heading">
            <h3 id="settings-notifications-link-heading">通知</h3>
            <div className="settings-section-card">
              <button className="settings-page-link" onClick={() => setGeneralDetail('notifications')}><span><strong>通知设置</strong><small>桌面通知、私信、围炉与场景提醒</small></span><Icon name="chevron-right-20" /></button>
            </div>
          </section>
          <section className="settings-group general-settings-group" aria-labelledby="settings-system-heading">
            <h3 id="settings-system-heading">系统</h3>
            <div className="settings-section-card">
              <SettingsItem label="开机自启" htmlFor="client-startup-input" description={app.clientStartup && !app.clientStartup.supported ? app.clientStartup.message : undefined}>
                <input id="client-startup-input" type="checkbox" role="switch" checked={Boolean(app.clientStartup?.enabled)}
                  disabled={app.startupBusy || !app.clientStartup?.supported} onChange={event => void app.changeClientStartup(event.target.checked)} />
              </SettingsItem>
              {app.clientError && <p className="form-error" id="client-settings-error" role="alert">
                {app.clientError}
              </p>}
              <button id="open-diagnostics" className="settings-page-link" onClick={() => app.openDiagnostics()}><span><strong>连接诊断</strong><small>检查本机服务与连接，导出诊断报告</small></span><Icon name="chevron-right-20" /></button>
            </div>
          </section>
          </div>
          {open && route === 'diagnostics' && <Diagnostics model={app} embedded />}
          <div hidden={route === 'diagnostics' || generalDetail !== 'notifications'}>
          <section className="settings-group general-settings-group" aria-labelledby="settings-notifications">
            <h3 id="settings-notifications">通知</h3>
            <div className="settings-section-card">
              <SettingsItem label="桌面通知" htmlFor="notification-enabled"
                description={app.notificationSettings ? app.notificationSettings.message || '选择允许显示桌面提醒的通知类型。' : '正在读取通知设置…'}>
                <input id="notification-enabled" type="checkbox" role="switch" aria-label="开启桌面通知"
                  checked={Boolean(app.notificationSettings?.preferences.enabled)} disabled={app.notificationsBusy || !app.notificationSettings?.supported}
                  onChange={event => void app.changeNotifications({ enabled: event.target.checked })} />
              </SettingsItem>
              <div className="notification-switches" role="group" aria-label="通知类型">
                {([
                  ["mail", "私信", "私信通知"],
                  ["firesides", "围炉", "围炉通知"],
                  ["bonfire", "篝火", "篝火通知"],
                  ["scenes", "场景对话完成", "场景对话完成通知"],
                ] as const).map(([key, title, help]) => (
                  <SettingsItem key={key} label={title} htmlFor={`notification-${key}`}>
                    <input id={`notification-${key}`} type="checkbox" role="switch"
                      aria-label={help}
                      checked={Boolean(app.notificationSettings?.preferences[key])}
                      disabled={app.notificationsBusy || !app.notificationSettings?.supported || !app.notificationSettings.preferences.enabled}
                      onChange={event => void app.changeNotifications({ [key]: event.target.checked })} />
                  </SettingsItem>
                ))}
              </div>
              {import.meta.env.DEV && <button id="notification-test" type="button"
                disabled={app.notificationsBusy || !app.notificationSettings?.supported || !app.notificationSettings.preferences.enabled}
                onClick={() => void app.testNotification()}>发送测试通知</button>}
              {app.notificationsError && <p className="form-error" role="alert">{app.notificationsError}</p>}
            </div>
          </section>
          </div>
        </div>
        <div
          id="settings-panel-apps"
          role="tabpanel"
          aria-labelledby="settings-tab-apps"
          hidden={activeTab !== "apps"}
        >
          {open && activeTab === 'apps' && <ConnectorSettings model={app} onDetailChange={setConnectorDetail} />}
        </div>
        </div>
        </section>
      </div>
    </Dialog>
    </>
  );
});

export const ConnectionSettings = memo(function ConnectionSettings({ model, embedded = false, inline = false, locked = false }: { model: AppModel; embedded?: boolean; inline?: boolean; locked?: boolean }) {
  useSyncExternalStore(model.subscribe, () => model.settingsOpen ? model.getVersion() : -1);
  const app = model;
  const form = app.form;
  const saving = app.saving || locked;
  const section = app.connectionSettingsSection;
  const error = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (app.settingsOpen && app.formError) error.current?.focus();
  }, [app.settingsOpen, app.formError]);
  const imported = Boolean(form?.portalConfigPath);
  const [subagentEnabled, setSubagentEnabled] = useState<boolean>();
  // Saving/discarding rebuilds the form while this surface remains mounted.
  // Refresh its persisted baseline without fetching again on every draft edit.
  useEffect(() => {
    if (!app.settingsOpen || section !== 'subagent') return;
    let active = true;
    setSubagentEnabled(undefined);
    void app.api.subagentConfig().then(config => {
      if (active) setSubagentEnabled(config.enabled !== false);
    }).catch(() => { if (active) { app.formError = '无法读取 subagent 开关状态'; app.changed(); } });
    return () => { active = false; };
  }, [app, app.settingsOpen, section, app.connectionFormRevision]);
  return (
    <SettingsSurface embedded={embedded} className={inline ? "settings-inline-form" : undefined}
      open={app.settingsOpen}
      busy={saving}
      onClose={() => app.closeSettings()}
      id="settings-dialog"
    >
      <form
        id="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          void app.saveSettings();
        }}
      >
        {!embedded && <div className="dialog-heading">
          <div className="dialog-heading-main">
            <h2>连接与设置</h2>
            <NavigationControls back={app.settingsRoute === "connection" && !saving ? app.returnToClientSettings : undefined} />
          </div>
          <button
            type="button"
            id="close-settings"
            disabled={saving}
            className="close"
            aria-label="关闭设置"
            onClick={() => app.closeSettings()}
          ></button>
        </div>}
        <fieldset className="dialog-body settings-fields" disabled={saving}>
          {section === 'being' && <>
          <SettingsField label="Being 完整连接地址" htmlFor="connection-link" descriptionId="connection-help" description="粘贴包含 token 的完整 Loom 地址，Being 由地址确定。凭据加密保存在系统密钥库支持的本地配置中。">
          <input
            id="connection-link"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={form?.connectionLink || ""}
            onChange={(event) =>
              app.editForm("connectionLink", event.target.value)
            }
            required={!app.snapshot?.settings.hasToken}
            placeholder={
              app.snapshot?.settings.hasToken
                ? `${app.snapshot.settings.endpoint}/ · 已安全保存，留空保留`
                : "https://echo.beings.town/your_being/?token=…"
            }
          />
          </SettingsField>
          </>}
          {section !== 'being' && !app.snapshot?.settings.hasToken && <p className="field-help">
            请先连接 Being，再保存本机配置。<button type="button" className="text-button" onClick={() => app.openConnectionSettings()}>前往 Being 连接</button>
          </p>}
          {section === 'portal' && <>
          <SettingsField label="本机 Portal 名称" htmlFor="portal-name-input" descriptionId="portal-name-help" description={app.portalNameHelp}>
              <input
                id="portal-name-input"
                required
                maxLength={80}
                pattern={"[a-zA-Z0-9_\\-]+"}
                value={form?.portalName || ""}
                onChange={(event) =>
                  app.editForm("portalName", event.target.value)
                }
              />
          </SettingsField>
          <SettingsField label="工作目录" htmlFor="workspace-input" description="使用客户端自带的 Portal，安装和升级后自动使用配套版本，沿用已有配置。">
          <div className="picker">
            <input
              id="workspace-input"
              required
              value={form?.workspace || ""}
              onChange={(event) => app.editForm("workspace", event.target.value)}
              readOnly={imported}
            />
            <button
              type="button"
              data-pick="workspace"
              disabled={imported}
              onClick={() =>
                void app.run(async () => {
                  const value = await app.api.choose("workspace");
                  if (value) app.editForm("workspace", value);
                })
              }
            >
              选择…
            </button>
          </div>
          </SettingsField>
          <p className="field-help" id="existing-config-note" hidden={!imported}>
            {imported
              ? `沿用现有配置：${form?.portalConfigPath}。工作目录、命令、截图及扩展工具以该文件为准；在原配置中修改后重启 Portal 生效。`
              : ""}
          </p>
          <div className="settings-item-list">
            <SettingsItem label="Portal 后台常驻与登录自启" description="打开客户端时自动启动 Portal；退出后继续运行，连续故障最多重试 5 次。未启用时，退出客户端后停止。" htmlFor="background-input">
              <input
                id="background-input"
                type="checkbox"
                role="switch"
                checked={Boolean(form?.backgroundEnabled)}
                disabled={app.snapshot?.background?.supported === false}
                onChange={(event) =>
                  app.editForm("backgroundEnabled", event.target.checked)
                }
              />
            </SettingsItem>
            <SettingsItem label="允许命令执行" description="同时受下方工具权限模式约束" htmlFor="exec-input">
              <input
                id="exec-input"
                type="checkbox"
                role="switch"
                checked={Boolean(form?.allowExec)}
                onChange={(event) =>
                  app.editForm("allowExec", event.target.checked)
                }
              />
            </SettingsItem>
            <SettingsItem label="启用 Kits 与自定义工具" description="允许调用已安装的扩展和工具" htmlFor="kits-input">
              <input
                id="kits-input"
                type="checkbox"
                role="switch"
                checked={Boolean(form?.kitsEnabled)}
                onChange={(event) =>
                  app.editForm("kitsEnabled", event.target.checked)
                }
              />
            </SettingsItem>
            <section className="permission-settings-section"><div className="permission-section-heading"><strong>访问权限</strong><small>主助手与子代理共用</small></div>
              <PermissionPicker value={form?.permissionMode ?? 'auto-review'} onChange={mode => app.editForm('permissionMode', mode)}/>
              <p className="permission-note">仅适用于 Portal 调用，主助手和子代理共用。</p>
            </section>
          </div>
          </>}
          {section === 'subagent' && <div className="settings-item-list">
            <SettingsItem label="启用 subagent" htmlFor="subagent-enabled-input" description="允许 Being 在场景内委派子任务，关闭后保留模型配置。">
                <input id="subagent-enabled-input" type="checkbox" role="switch"
                  checked={form?.subagentEnabled ?? subagentEnabled ?? false}
                  disabled={saving || subagentEnabled === undefined}
                  onChange={event => app.editForm('subagentEnabled', event.target.checked)} />
            </SettingsItem>
            {form?.subagentSetup && <p className="field-help">{form.subagentSetup.provider} / {form.subagentSetup.model} · 随连接保存</p>}
            {!inline && <button type="button" disabled={saving || !(form?.subagentEnabled ?? subagentEnabled ?? false)} onClick={() => app.openSubagentSettings(true)}>配置模型</button>}
            {form?.subagentSetup && <button type="button" className="text-button" disabled={saving} onClick={() => app.editForm("subagentSetup", undefined)}>取消本次 subagent 配置</button>}
          </div>}
          <p ref={error} tabIndex={-1} className="form-error" id="settings-error" role="alert">
            {app.formError}
          </p>
        </fieldset>
        <div className="dialog-footer">
          <span>{app.hasConnectionDraft ? "尚未保存 · 保存会一并应用 Being、Portal 与子代理的待保存配置" : "修改后保存生效，验证连接后启动 Portal"}</span>
          {app.hasConnectionDraft && <button type="button" disabled={saving} onClick={() => app.discardConnectionDraft()}>放弃修改</button>}
          <button
            className="primary"
            id="save-settings"
            type="submit"
            disabled={saving || section !== 'being' && !app.snapshot?.settings.hasToken}
          >
            {saving ? (form?.subagentSetup ? "正在连接、安装并配置…" : "正在连接…") : "保存、连接并启动"}
          </button>
        </div>
      </form>
    </SettingsSurface>
  );
});

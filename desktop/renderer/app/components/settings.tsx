import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { PermissionPicker } from '../../shared/components/permission-picker';
import type { AppModel } from "../models/app";
import { Dialog } from "../../shared/components/dialog";
import { SettingsSurface } from "../../shared/components/settings-surface";
import { SubagentModelSettings } from "./subagent-model-settings";
import { TownAuth } from "../../town/components/auth";
import { Portal } from "../../portal/page";
import { Diagnostics } from "./diagnostics";
import { NavigationControls } from "../../shared/components/navigation-controls";
import { navigateTabs } from "../../shared/components/tab-navigation";
import { MAX_CHAT_HISTORY_LIMIT, validChatHistoryLimit } from '../../../shared/chat-history';
const settingsTabs = [
  { id: "being", label: "Being", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0" },
  { id: "portal", label: "Portal", icon: "M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm3 16h8m-4-4v4" },
  { id: "town", label: "Town", icon: "m3 10 9-7 9 7M5 9v12h14V9m-9 12v-7h4v7" },
  { id: "models", label: "模型", icon: "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" },
  { id: "appearance", label: "外观与阅读", icon: "M4 4h16v13H4V4Zm4 17h8m-4-4v4M8 8h8m-8 4h5" },
  { id: "general", label: "通用", icon: "M4 7h16M4 17h16M8 4v6m8 4v6" },
];
function DisclosureIcon() {
  return <svg className="settings-disclosure-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg>;
}
export const ClientSettings = memo(function ClientSettings({ model }: { model: AppModel }) {
  // A closed dialog retains its form state without reconciling
  // every control on background chat, Portal and Town notifications.
  useSyncExternalStore(model.subscribe, () => model.clientSettingsOpen || model.settingsRoute ? model.getVersion() : -1);
  useSyncExternalStore(model.town.subscribe, () => model.settingsRoute === "town" ? model.town.getVersion() : -1);
  const app = model;
  const open = app.clientSettingsOpen || Boolean(app.settingsRoute);
  const route = app.settingsRoute;
  const [modelBusy, setModelBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const busy = app.saving || modelBusy || leaving || (route === "town" && app.town.authBusy && !app.town.autoPairId);
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
  const [compact, setCompact] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(max-width:600px)").matches);
  useEffect(() => {
    const media = matchMedia("(max-width:600px)");
    const update = () => setCompact(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => { if (body.current) body.current.scrollTop = 0; }, [tab, open]);
  const [historyLimit, setHistoryLimit] = useState(String(app.chatHistoryLimit));
  useEffect(() => { setHistoryLimit(String(app.chatHistoryLimit)); }, [app.chatHistoryLimit, app.clientSettingsOpen]);

  const routeTab = route === 'connection' ? (app.connectionSettingsSection === 'subagent' ? 'models' : app.connectionSettingsSection)
    : route === 'diagnostics' ? 'general' : route === 'model' ? 'models' : route;
  useLayoutEffect(() => { if (routeTab) setTab(routeTab); }, [routeTab]);
  const activeTab = routeTab || tab;
  useLayoutEffect(() => {
    if (open && compact) document.getElementById(`settings-tab-${activeTab}`)?.scrollIntoView({block:'nearest', inline:'nearest'});
  }, [activeTab, open, compact]);
  const title = settingsTabs.find(item => item.id === activeTab)?.label;
  const heading = useRef<HTMLHeadingElement>(null);
  const continueEditing = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { if (confirmClose) continueEditing.current?.focus(); }, [confirmClose]);
  useEffect(() => { if (!open || !app.hasConnectionDraft) setConfirmClose(false); }, [open, app.hasConnectionDraft]);
  // Routes only select a category or expand an in-page section. They never
  // replace the category with another settings page.
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
  return (
    <Dialog
      open={open}
      busy={busy}
      onClose={() => void leave(true)}
      id="client-settings-dialog"
      aria-labelledby="client-settings-title"
    >
      <div className="client-settings-content">
        <div className="dialog-heading">
          <div className="dialog-heading-main">
            <h2 id="client-settings-title">设置</h2>
          </div>
          <button
            type="button"
            id="close-client-settings"
            className="close"
            aria-label="关闭客户端设置"
            disabled={busy}
            onClick={() => void leave(true)}
          ></button>
        </div>
        <div className="settings-tabs" role="tablist" aria-label="设置分类" aria-orientation={compact ? "horizontal" : "vertical"} onKeyDown={navigateTabs}>
          {settingsTabs.map(item => <button key={item.id} id={`settings-tab-${item.id}`} role="tab"
            aria-controls={`settings-panel-${item.id}`} aria-selected={activeTab === item.id}
            disabled={busy} tabIndex={activeTab === item.id ? 0 : -1} onClick={() => void selectTab(item.id)}
            >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={item.icon} /></svg>
            {item.label}
          </button>)}
        </div>
        <section className="settings-page">
        <h2 className="settings-page-title" ref={heading} tabIndex={-1}>{title}</h2>
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
        <div className="dialog-body settings-home-body settings-inline-body" ref={body}>
        <div id="settings-panel-being" role="tabpanel" aria-labelledby="settings-tab-being" hidden={activeTab !== 'being'}>
          {open && activeTab === 'being' && <>
            <section className="general-settings-group">
              <label className="general-setting-row" htmlFor="settings-sbs">
                <span>自主醒来</span>
                <input id="settings-sbs" type="checkbox" role="switch" checked={app.sbsKnown && app.sbsEnabled}
                  disabled={!app.snapshot?.settings.hasToken || !app.sbsKnown || app.chatLoading || busy}
                  onChange={() => app.toggleSbs()} />
              </label>
              <p className="general-setting-help">{app.sbsKnown ? "允许 Being 在没有新消息时主动思考与行动。" : "连接 Being 后同步开关状态。"}</p>
            </section>
            <ConnectionSettings model={app} embedded inline />
          </>}
        </div>
        <div id="settings-panel-town" role="tabpanel" aria-labelledby="settings-tab-town" hidden={activeTab !== 'town'}>
          {open && activeTab === 'town' && <TownAuth model={app.town} embedded inline />}
        </div>
        <div id="settings-panel-models" role="tabpanel" aria-labelledby="settings-tab-models" hidden={activeTab !== 'models'}>
          {open && activeTab === 'models' && <>
            {route === 'connection' && <ConnectionSettings model={app} embedded inline locked={modelBusy} />}
            <SubagentModelSettings app={app} embedded inline onBusyChange={setModelBusy} />
          </>}
        </div>
        <div id="settings-panel-portal" role="tabpanel" aria-labelledby="settings-tab-portal" hidden={activeTab !== 'portal'}>
          {open && activeTab === 'portal' && <Portal model={app} embedded configuration={
            <details className="settings-disclosure" open={route === 'connection'} onToggle={event => {
              if (event.currentTarget.open && route !== 'connection') app.openConnectionSettings('portal');
              else if (!event.currentTarget.open && route === 'connection' && !busy) app.openPortalSettings();
            }}>
              <summary onClick={event => { if (busy) event.preventDefault(); }}><span><strong>本机配置</strong><small>名称、工作目录、后台常驻与工具权限</small></span><DisclosureIcon /></summary>
              {route === 'connection' && <ConnectionSettings model={app} embedded inline />}
            </details>
          } />}
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
            <div className="appearance-setting-row">
              <span id="settings-appearance">主题配色</span>
              <div id="theme-toggle" className="theme-options" role="group" aria-label="主题配色">
                {(["light", "dark"] as const).map(theme => (
                  <button key={theme} id={`theme-${theme}`} type="button"
                    aria-pressed={app.theme === theme}
                    onClick={() => { if (app.theme !== theme) void app.toggleTheme(); }}>
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      {theme === "light" ? <><circle cx="10" cy="10" r="3.25" /><path d="M10 1.5v2m0 13v2M1.5 10h2m13 0h2M4 4l1.4 1.4m9.2 9.2L16 16M4 16l1.4-1.4m9.2-9.2L16 4" /></>
                        : <path d="M16.8 12.1A7 7 0 0 1 7.9 3.2a7 7 0 1 0 8.9 8.9Z" />}
                    </svg>
                    {theme === "light" ? "浅色" : "深色"}
                  </button>
                ))}
              </div>
            </div>
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
                onChange={(event) =>
                  app.setReadingSize(Number(event.target.value))
                }
              />
              <div className="reading-sample" aria-label="阅读字号预览">
                <span>预览</span><p style={{fontSize:app.readingSize}}>今天，从一个小想法开始。</p>
              </div>
              <div className="reading-setting-footer">
                <p id="reading-size-help">应用于对话与 Town 正文</p>
                <button
                  id="reading-reset"
                  type="button"
                  onClick={() => app.setReadingSize(16)}
                >
                  恢复默认
                </button>
              </div>
            </div>
            <label className="reasoning-setting" htmlFor="show-reasoning">
              <span><strong>显示思考链路</strong><small id="show-reasoning-help">查看服务端返回的思考过程与工具调用。关闭时，以省略号气泡提示正在处理。</small></span>
              <input id="show-reasoning" type="checkbox" role="switch" aria-label="显示思考链路" aria-describedby="show-reasoning-help"
                checked={app.showReasoning} onChange={event => app.setShowReasoning(event.target.checked)} />
            </label>
            <form className="reading-setting history-setting" onSubmit={event => { event.preventDefault(); app.setChatHistoryLimit(Number(historyLimit)); }}>
              <div className="history-setting-row">
                <label htmlFor="chat-history-limit">每次加载的历史消息数</label>
                <div className="history-setting-input">
                  <input id="chat-history-limit" type="number" min="1" max={MAX_CHAT_HISTORY_LIMIT} step="1" required
                    value={historyLimit} aria-describedby="chat-history-limit-help" onChange={event => setHistoryLimit(event.target.value)} />
                  <span aria-hidden="true">条</span>
                </div>
              </div>
              <div className="reading-setting-footer">
                <p id="chat-history-limit-help">可设为 1–{MAX_CHAT_HISTORY_LIMIT} 条，默认 100 条。<br />保存后用于后续加载，已有记录会保留。</p>
                <button type="submit" disabled={!validChatHistoryLimit(Number(historyLimit)) || Number(historyLimit) === app.chatHistoryLimit}>保存</button>
              </div>
            </form>
          </section>
        </div>
        <div
          id="settings-panel-general"
          role="tabpanel"
          aria-labelledby="settings-tab-general"
          hidden={activeTab !== "general"}
        >
          <section className="general-settings-group" aria-labelledby="settings-downloads">
            <div className="download-setting-row">
              <div className="download-setting-info">
                <span id="settings-downloads">下载位置</span>
                <p title={downloadDirectory || undefined}>{downloadDirectory || '首次下载时选择保存位置'}</p>
              </div>
            <button className="download-setting-change" type="button" aria-label="设置下载位置" disabled={choosingDownload} onClick={async()=>{
              setChoosingDownload(true);setDownloadError('');
              try {const value=await app.api.downloadDirectory?.(true);if(value)setDownloadDirectory(value);}
              catch {setDownloadError('无法设置下载位置，请重试');}finally{setChoosingDownload(false);}
            }}>{choosingDownload ? '选择中…' : downloadDirectory ? '更改' : '选择'}</button>
            </div>
            {downloadError && <p className="general-setting-help" role="alert">{downloadError}</p>}
          </section>
          <section className="general-settings-group" aria-labelledby="settings-notifications">
            <label className="general-setting-row">
              <span id="settings-notifications">桌面通知</span>
              <input id="notification-enabled" type="checkbox" role="switch"
                aria-label="开启桌面通知"
                checked={Boolean(app.notificationSettings?.preferences.enabled)}
                disabled={app.notificationsBusy || !app.notificationSettings?.supported}
                onChange={event => void app.changeNotifications({ enabled: event.target.checked })} />
            </label>
            <p className="general-setting-help">
              {app.notificationSettings?.message || "正在读取通知设置…"}
            </p>
            <div className="notification-switches" role="group" aria-label="通知类型">
              {([
                ["mail", "私信", "私信通知"],
                ["firesides", "围炉", "围炉通知"],
                ["bonfire", "篝火", "篝火通知"],
                ["scenes", "场景对话完成", "场景对话完成通知"],
              ] as const).map(([key, title, help]) => (
                <label key={key}>
                  <span>{title}</span>
                  <input id={`notification-${key}`} type="checkbox" role="switch"
                    aria-label={help}
                    checked={Boolean(app.notificationSettings?.preferences[key])}
                    disabled={app.notificationsBusy || !app.notificationSettings?.supported || !app.notificationSettings.preferences.enabled}
                    onChange={event => void app.changeNotifications({ [key]: event.target.checked })} />
                </label>
              ))}
            </div>
            {import.meta.env.DEV && <button id="notification-test" type="button"
              disabled={app.notificationsBusy || !app.notificationSettings?.supported || !app.notificationSettings.preferences.enabled}
              onClick={() => void app.testNotification()}>发送测试通知</button>}
            {app.notificationsError && <p className="form-error" role="alert">{app.notificationsError}</p>}
          </section>
          <section className="general-settings-group" aria-label="启动设置">
              <label className="general-setting-row">
                <span>开机自启</span>
                <input
                  id="client-startup-input"
                  type="checkbox"
                  role="switch"
                  checked={Boolean(app.clientStartup?.enabled)}
                  disabled={app.startupBusy || !app.clientStartup?.supported}
                  onChange={(event) =>
                    void app.changeClientStartup(event.target.checked)
                  }
                />
              </label>
            {app.clientStartup && !app.clientStartup.supported &&
              <p className="general-setting-help" id="client-startup-help">{app.clientStartup.message}</p>}
            {app.clientError && <p className="form-error" id="client-settings-error" role="alert">
              {app.clientError}
            </p>}
          </section>

          <details className="settings-disclosure" open={route === 'diagnostics'} onToggle={event => {
            if (event.currentTarget.open && route !== 'diagnostics') app.openDiagnostics();
            else if (!event.currentTarget.open && route === 'diagnostics') app.returnToClientSettings();
          }}>
            <summary id="open-diagnostics"><span><strong>连接诊断</strong><small>检查本机服务与连接，导出诊断报告</small></span><DisclosureIcon /></summary>
            {open && route === 'diagnostics' && <Diagnostics model={app} embedded />}
          </details>
        </div>
        </div>
        </section>
      </div>
    </Dialog>
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
          <label htmlFor="connection-link">Being 完整连接地址</label>
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
          <p className="field-help" id="connection-help">
            粘贴包含 token 的完整 Loom 地址，Being
            由地址确定。凭据加密保存在系统密钥库支持的本地配置中。
          </p>
          </>}
          {section !== 'being' && !app.snapshot?.settings.hasToken && <p className="field-help">
            请先连接 Being，再保存本机配置。<button type="button" className="text-button" onClick={() => app.openConnectionSettings()}>前往 Being 连接</button>
          </p>}
          {section === 'portal' && <>
          <div className="field-row">
            <div>
              <label htmlFor="portal-name-input">本机 Portal 名称</label>
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
            </div>
          </div>
          <p id="portal-name-help" className="field-help">
            {app.portalNameHelp}
          </p>
          <label htmlFor="workspace-input">工作目录</label>
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
          <p className="field-help">
            使用客户端自带的 Portal，安装和升级后自动使用配套版本，沿用已有配置。
          </p>
          <p className="field-help" id="existing-config-note" hidden={!imported}>
            {imported
              ? `沿用现有配置：${form?.portalConfigPath}。工作目录、命令、截图及扩展工具以该文件为准；在原配置中修改后重启 Portal 生效。`
              : ""}
          </p>
          <div className="switch-list">
            <label>
              <span>
                <strong>Portal 后台常驻与登录自启</strong>
                <small>退出客户端后继续运行；连续故障最多重试 5 次</small>
              </span>
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
            </label>
            <p id="portal-startup-help">打开客户端时自动启动 Portal；未启用后台常驻时，退出客户端后停止。</p>
            <label>
              <span>
                <strong>允许命令执行</strong>
                <small>同时受下方工具权限模式约束</small>
              </span>
              <input
                id="exec-input"
                type="checkbox"
                role="switch"
                checked={Boolean(form?.allowExec)}
                onChange={(event) =>
                  app.editForm("allowExec", event.target.checked)
                }
              />
            </label>
            <label>
              <span>
                <strong>启用 Kits 与自定义工具</strong>
                <small>允许调用已安装的扩展和工具</small>
              </span>
              <input
                id="kits-input"
                type="checkbox"
                role="switch"
                checked={Boolean(form?.kitsEnabled)}
                onChange={(event) =>
                  app.editForm("kitsEnabled", event.target.checked)
                }
              />
            </label>
            <section className="permission-settings-section"><div className="permission-section-heading"><strong>工作权限</strong><small>主助手与子代理共用</small></div>
              <PermissionPicker value={form?.permissionMode ?? 'auto-review'} onChange={mode => app.editForm('permissionMode', mode)}/>
              <p className="permission-note">仅适用于 Portal 调用，主助手和子代理共用。</p>
            </section>
          </div>
          </>}
          {section === 'subagent' && <div className="switch-list">
            <div className="subagent-switch-row">
              <label htmlFor="subagent-enabled-input">
                <strong>启用 subagent</strong>
                <small>允许 Being 在场景内委派子任务，关闭后保留模型配置</small>
                {form?.subagentSetup && <small>{form.subagentSetup.provider} / {form.subagentSetup.model} · 随连接保存</small>}
              </label>
              <div className="subagent-switch-actions">
                {!inline && <button type="button"
                  disabled={saving || !(form?.subagentEnabled ?? subagentEnabled ?? false)}
                  onClick={() => app.openSubagentSettings(true)}>配置 ›</button>}
                <input id="subagent-enabled-input" type="checkbox" role="switch"
                  checked={form?.subagentEnabled ?? subagentEnabled ?? false}
                  disabled={saving || subagentEnabled === undefined}
                  onChange={event => app.editForm('subagentEnabled', event.target.checked)} />
              </div>
              {form?.subagentSetup && <button type="button" className="subagent-skip" disabled={saving || !(form?.subagentEnabled ?? subagentEnabled ?? false)} onClick={() => app.editForm("subagentSetup", undefined)}>取消本次 subagent 配置</button>}
            </div>
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

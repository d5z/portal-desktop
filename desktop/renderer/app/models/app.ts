import type {
  DesktopAPI,
  Snapshot,
  ChatSceneActivity,
  PortalState,
  SaveSettings,
  ClientStartup,
  NotificationPreferences,
  NotificationSettings,
  UpdateState,
} from "../../../shared/types";
import { Store, errorText } from "../../shared/models/store";
import { PluginsModel } from '../../plugins/model';
import { hostPluginContext } from '../../plugins/context';
import { WorkspaceModel } from "./workspace";
import { TownModel } from "../../town/models/town";
import type { HistoryScope } from "../../chat/models/scenes";
import { CHAT_HISTORY_LIMIT_KEY, DEFAULT_CHAT_HISTORY_LIMIT, chatHistoryLimit, validChatHistoryLimit } from '../../../shared/chat-history';

type SettingsRoute = "" | "connection" | "town" | "model" | "portal" | "diagnostics";

export class AppModel extends Store {
  snapshot?: Snapshot;
  theme: "light" | "dark" = "light";
  startup: "loading" | "ready" | "error" = "loading";
  view = "chat";
  chatSplitOpen = false;
  toggleChatSplit = () => { this.chatSplitOpen = !this.chatSplitOpen; this.changed(); };
  beingInfoOpen = true;
  toggleBeingInfo = () => {
    this.beingInfoOpen = !this.beingInfoOpen;
    if (this.beingInfoOpen) this.chatSplitOpen = false;
    this.changed();
  };

  returnToMainChat = async () => {
    this.chatSplitOpen = false;
    this.navigate("chat");
    const main = this.snapshot?.chatSessions?.[0];
    if (main && (main.scene_id !== this.snapshot?.chatScene?.scene_id || this.chatHistoryScope !== "current"))
      await this.run(() => this.changeChatSession("select", main.scene_id));
  };

  chatSource = "";
  chatLoading = false;
  chatHistoryScope: HistoryScope = "current";
  chatHistoryScopeKnown = false;
  chatSessionCreateRequest = 0;
  chatSceneActivity: Record<string, ChatSceneActivity> = {};
  private readSceneReplies = new Set<string>();
  setChatSceneActivity(activity: Record<string, ChatSceneActivity>) {
    for (const id of this.readSceneReplies) if (activity[id] !== "done") this.readSceneReplies.delete(id);
    const current = this.snapshot?.chatScene?.scene_id;
    if (this.view === "chat" && this.chatHistoryScope === "current" && current && activity[current] === "done") this.readSceneReplies.add(current);
    this.chatSceneActivity = Object.fromEntries(Object.entries(activity).filter(([id, status]) =>
      status !== "done" || !this.readSceneReplies.has(id)));
    this.changed();
  }
  connection = "";
  sbsEnabled = true;
  sbsKnown = false;
  toastMessage = "";
  settingsOpen = false;
  subagentSettingsOpen = false;
  subagentFromConnection = false;
  modelSettingsTarget: "Heart" | "subagent" = "Heart";
  openSubagentSettings(fromConnection = false) {
    this.modelSettingsTarget = "subagent";
    this.subagentFromConnection = fromConnection;
    if (fromConnection) this.settingsOpen = false;
    else this.post({ type: "beings:chat-action", action: "close" });
    this.subagentSettingsOpen = true;
    this.changed();
  }
  closeSubagentSettings = () => {
    this.subagentSettingsOpen = false;
    if (!this.subagentFromConnection) this.dismissSettingsRoute();
    if (this.subagentFromConnection) this.settingsOpen = true;
    this.changed();
  };
  async enableSubagent() {
    if (!this.snapshot) throw new Error('请先连接 Being。');
    const config = await this.api.subagentConfig();
    if (!config.provider?.trim() || !config.model?.trim()) throw new Error('请先配置 subagent 模型。');
    const next = await this.api.save({ ...this.snapshot.settings, subagentEnabled: true });
    const persisted = await this.api.subagentConfig();
    if (persisted.enabled === false) throw new Error('subagent 未能启动，请重试。');
    this.applySnapshot(next, true);
  }
  clientSettingsOpen = false;
  settingsRoute: SettingsRoute = "";
  settingsForwardRoute: SettingsRoute = "";
  diagnosticsOpen = false;
  searchOpen = false;
  search = "";
  searchEntries: import("../../chat/services/conversation-search").SearchEntry[] = [];
  searchLoading = false;
  searchError = "";
  readingSize = 16;
  chatHistoryLimit = DEFAULT_CHAT_HISTORY_LIMIT;
  update?: UpdateState;
  updateChecking = false;
  async checkClientUpdates() {
    if (this.updateChecking || this.update?.phase === "checking" || this.update?.activity) return;
    this.updateChecking = true;
    this.changed();
    try {
      const state = await this.api.checkUpdates();
      if (!this.update?.activity) this.update = state;
      if (state.phase !== "available") this.toast(state.message);
    } catch (error) {
      this.toast(error);
    } finally {
      this.updateChecking = false;
      this.changed();
    }
  }
  async downloadClientUpdate() {
    if (this.update?.phase !== "available" || !this.update.latestVersion || this.update.activity) return;
    const activity: NonNullable<UpdateState["activity"]> = { phase: "metadata", version: this.update.latestVersion };
    this.update = { ...this.update, activity };
    this.changed();
    try {
      await this.api.downloadUpdate();
    } catch (error) {
      this.toast(error);
    } finally {
      // Main-process progress replaces this immediate pending state.
      if (this.update?.activity === activity) {
        this.update = { ...this.update, activity: undefined };
        this.changed();
      }
    }
  }
  portalAction: "start" | "stop" | "restart" | "force" | null = null;
  portalError = "";
  logsLoading = false;
  collectingLogs = false;
  async collectLogs() {
    if (this.collectingLogs) return;
    this.collectingLogs = true; this.changed();
    try {
      await this.api.collectLogs();
      this.toast('日志已打包，已在下载文件夹中显示。');
    } catch (error) { this.toast(error); }
    finally { this.collectingLogs = false; this.changed(); }
  }
  private logsRequest = "";
  clientStartup?: ClientStartup;
  notificationSettings?: NotificationSettings;
  notificationsBusy = false;
  notificationsError = "";
  startupBusy = false;
  clientError = "";
  form?: SaveSettings;
  saving = false;
  formError = "";
  portalNameHelp = "";
  private nameEdited = false;
  private defaultsRevision = 0;
  private initializeRevision = 0;
  private defaultsTimer?: ReturnType<typeof setTimeout>;
  private toastTimer?: ReturnType<typeof setTimeout>;
  post: (data: unknown) => void = () => {};
  readonly workspace = new WorkspaceModel(
    (view) => this.navigate(view),
    (error) => this.toast(error),
    (data) => this.post(data),
    () => Boolean(this.chatSource),
  );
  readonly town: TownModel;
  readonly plugins: PluginsModel;
  constructor(readonly api: DesktopAPI) {
    super();
    this.plugins = new PluginsModel(api?.plugins, this.navigate, {
      notice: text => this.toast(text), post: message => this.post(message),
      scene: () => this.snapshot?.chatScene?.scene_id || '', ready: () => Boolean(this.chatSource && !this.chatLoading),
      showChat: () => { if (this.view !== 'chat') { this.chatSplitOpen = true; this.changed(); } },
    });
    this.town = new TownModel(
      api,
      this.toast,
      this.navigate,
      this.workspace.scenes,
      () => {
        this.navigate("chat");
        this.workspace.toggle(true);
      },
      (data) => this.post(data),
      () => this.changed(),
      () => Boolean(this.chatSource && !this.chatLoading),
    );
    this.town.plugins = this.plugins;
  }
  start() {
    void this.plugins.refresh();
    let active = true;
    const cleanupWorkspace = this.workspace.start();
    if (!this.api) {
      this.startup = "error";
      this.toast("请通过 Portal Desktop 桌面客户端打开此页面。");
      return () => {
        active = false;
        clearTimeout(this.toastTimer);
        cleanupWorkspace();
      };
    }
    try {
      this.chatHistoryLimit = chatHistoryLimit(Number(localStorage.getItem(CHAT_HISTORY_LIMIT_KEY)));
      const size = Number(localStorage.getItem("beings:reading-size"));
      if (Number.isInteger(size) && size >= 13 && size <= 21)
        this.readingSize = size;
    } catch {
      /* Optional preference. */
    }
    const cleanups = [
      this.plugins.start(),
      this.subscribe(() => this.plugins.updateContext(hostPluginContext(this))),
      this.workspace.subscribe(() => this.plugins.updateContext(hostPluginContext(this))),
      this.town.subscribe(() => this.plugins.updateContext(hostPluginContext(this))),
      this.plugins.subscribe(() => this.town.changed()),
      cleanupWorkspace,
      this.town.start(),
      this.api.onNotificationOpen(() => {
        if (this.startup === "ready") void this.openNotification();
      }),
      this.api.onPortal((state) => {
        if (this.snapshot) {
          this.snapshot = { ...this.snapshot, portal: state };
          this.changed();
        }
        void this.run(async () => {
          const next = await this.api.snapshot();
          if (active) this.applySnapshot(next);
        });
      }),
      this.api.onUpdate((state) => {
        this.update = state;
        this.changed();
      }),
    ];
    void this.api
      .updateState()
      .then((state) => {
        if (active) {
          this.update = state;
          this.changed();
        }
      })
      .catch((error) => {
        if (active) this.toast(error);
      });
    void this.initialize();
    return () => {
      active = false;
      ++this.initializeRevision;
      ++this.defaultsRevision;
      clearTimeout(this.defaultsTimer);
      clearTimeout(this.toastTimer);
      this.logsRequest = "";
      this.logsLoading = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }
  async initialize() {
    const revision = ++this.initializeRevision;
    this.startup = "loading";
    this.changed();
    try {
      const [theme, state] = await Promise.all([
        this.api.appearance(),
        this.api.snapshot(),
      ]);
      if (revision !== this.initializeRevision) return;
      this.theme = theme;
      this.applySnapshot(state);
      this.startup = "ready";
      await this.openNotification();
    } catch {
      if (revision === this.initializeRevision) this.startup = "error";
    }
    this.changed();
  }
  toast = (error: unknown) => {
    this.toastMessage = errorText(error);
    this.changed();
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastMessage = "";
      this.changed();
    }, 6000);
  };
  run = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      this.toast(error);
    }
  };
  navigate = (view: string, id?: string) => {
    if (view === 'plugin-library') { view = 'kits'; this.town.groveKind = 'plugin'; }
    this.view = view;
    const scene = this.snapshot?.chatScene?.scene_id;
    if (view === "chat" && this.chatHistoryScope === "current" && scene && this.chatSceneActivity[scene] === "done") {
      this.readSceneReplies.add(scene);
      delete this.chatSceneActivity[scene];
    }
    this.workspace.enter(view);
    this.workspace.toggle(false);
    this.town.show(view, id);
    this.changed();
  };
  applySnapshot(next: Snapshot, reload = false) {
    const sameChat = Boolean(this.chatSource &&
      this.snapshot?.settings.endpoint === next.settings.endpoint &&
      this.snapshot?.settings.being === next.settings.being &&
      this.snapshot?.chatScene?.scene_id === next.chatScene?.scene_id);
    if (reload || !next.settings.hasToken || (this.snapshot && next.settings.endpoint !== this.snapshot.settings.endpoint)) {
      this.logsRequest = "";
      this.logsLoading = false;
    }
    reload ||= Boolean(this.snapshot && next.settings.endpoint !== this.snapshot.settings.endpoint);
    this.snapshot = next;
    this.workspace.snapshot(next);
    if (next.settings.hasToken && (!this.chatSource || reload)) {
      this.chatSceneActivity = {};
      this.readSceneReplies.clear();
      this.sbsKnown = false;
      this.chatLoading = true;
      if (!sameChat) this.chatHistoryScope = next.chatScene ? "current" : "all";
      this.chatHistoryScopeKnown = false;
      this.connection = "connecting";
      this.chatSource = `beings://chat/?name=${encodeURIComponent(next.settings.being)}&history_scope=${encodeURIComponent(next.settings.endpoint)}&history_limit=${this.chatHistoryLimit}&scene_scope=${this.chatHistoryScope}&scene_strict=1&theme=${this.theme}&revision=${crypto.randomUUID()}`;
      if (next.chatScene) {
        this.chatSource += `&scene_id=${encodeURIComponent(next.chatScene.scene_id)}&scene_label=${encodeURIComponent(next.chatScene.scene_meta.scene_label)}`;
      }
    }
    if (!next.settings.hasToken) {
      this.chatSceneActivity = {};
      this.readSceneReplies.clear();
      this.sbsKnown = false;
      this.chatSource = "";
      this.chatLoading = false;
      this.chatHistoryScopeKnown = false;
      this.connection = "";
      this.searchEntries = [];
    }
    this.changed();
  }
  frameLoaded() {
    this.chatLoading = false;
    this.search = "";
    this.searchEntries = [];
    this.workspace.frameLoaded();
    this.postCurrentSession();
    this.postAppearance();
    this.post({ type: "beings:sbs-request" });
    if (this.chatSource) this.post({ type: "beings:history-scope-request", revision: new URL(this.chatSource).searchParams.get("revision") });
    this.town.updateLive();
    this.post({ type: "beings:search-request", query: this.searchOpen ? this.search : "" });
    this.changed();
  }
  toggleSbs() {
    if (!this.snapshot?.settings.hasToken || !this.sbsKnown || this.chatLoading)
      return;
    this.sbsKnown = false;
    this.post({ type: "beings:sbs-toggle" });
    this.changed();
  }
  async changeChatSession(operation: "create" | "bind" | "select" | "rename" | "delete", value: string, sceneId?: string) {
    const endpoint = this.snapshot?.settings.endpoint;
    if (!endpoint) throw new Error("请先连接 Being。");
    const previousSceneId = this.snapshot?.chatScene?.scene_id;
    const next = await this.api.changeChatSession(operation, value, endpoint, sceneId);
    if (this.snapshot?.settings.endpoint !== endpoint) return;
    this.applySnapshot(next);
    this.chatHistoryScope = "current";
    if (!this.chatSplitOpen) this.navigate("chat");
    this.postCurrentSession();
    if (next.chatScene && next.chatScene.scene_id !== previousSceneId)
      this.toast(`已切到「${next.chatScene.scene_meta.scene_label}」场景`);
  }
  private postCurrentSession() {
    if (this.chatSource && this.snapshot?.chatScene) this.post({
      type: "beings:session-select", scene: this.snapshot.chatScene, scope: this.chatHistoryScope,
      scenes: this.snapshot.chatSessions,
      revision: new URL(this.chatSource).searchParams.get("revision"),
    });
  }
  changeChatHistoryScope(scope: HistoryScope) {
    if (!this.chatSource || this.chatLoading || !this.chatHistoryScopeKnown || (scope === "current" && !this.snapshot?.chatScene)) return;
    this.chatHistoryScope = scope;
    if (!this.chatSplitOpen) this.navigate("chat");
    this.post({ type: "beings:history-scope", scope, revision: new URL(this.chatSource).searchParams.get("revision") });
  }
  setChatHistoryScope(scope: HistoryScope) {
    this.chatHistoryScope = scope;
    this.chatHistoryScopeKnown = true;
    this.changed();
  }
  setSbsEnabled(enabled?: boolean) {
    if (typeof enabled === "boolean") this.sbsEnabled = enabled;
    this.sbsKnown = typeof enabled === "boolean";
    this.changed();
  }
  postAppearance() {
    this.post({ type: "beings:appearance", theme: this.theme });
    this.post({ type: "beings:reading", size: this.readingSize });
    if (this.chatSource) this.post({ type: 'beings:history-limit', limit: this.chatHistoryLimit, revision: new URL(this.chatSource).searchParams.get('revision') });
  }
  setChatHistoryLimit(limit: number) {
    if (!validChatHistoryLimit(limit)) return;
    try { localStorage.setItem(CHAT_HISTORY_LIMIT_KEY, String(limit)); }
    catch { this.toast('无法保存历史消息设置，请重试。'); return; }
    this.chatHistoryLimit = limit;
    this.postAppearance();
    this.changed();
    this.toast('历史消息条数已保存，将用于后续加载。');
  }
  async toggleTheme() {
    await this.run(async () => {
      this.theme = await this.api.appearance(
        this.theme === "light" ? "dark" : "light",
      );
      this.postAppearance();
      this.changed();
    });
  }
  setReadingSize(size: number) {
    this.readingSize = size;
    this.postAppearance();
    this.changed();
    try {
      localStorage.setItem("beings:reading-size", String(size));
    } catch {
      /* Optional preference. */
    }
  }
  openSearch() {
    if (!this.snapshot?.settings.hasToken) return;
    this.searchOpen = true;
    this.post({ type: "beings:search-request", query: this.searchOpen ? this.search : "" });
    this.changed();
  }
  chatAction(action: string) {
    this.clientSettingsOpen = false;
    this.settingsRoute = "";
    this.settingsForwardRoute = "";
    this.navigate("chat");
    this.post({ type: "beings:chat-action", action });
  }
  private beginSettingsRoute(route: SettingsRoute) {
    this.settingsRoute = route;
    this.settingsForwardRoute = "";
    this.clientSettingsOpen = false;
    this.changed();
  }
  openConnectionSettings() {
    this.beginSettingsRoute("connection");
    this.showSettings(true);
  }
  openTownSettings() {
    this.beginSettingsRoute("town");
    void this.town.auth();
  }
  openModelSettings() {
    this.beginSettingsRoute("model");
    this.navigate("chat");
    this.subagentFromConnection = false;
    this.modelSettingsTarget = "Heart";
    this.subagentSettingsOpen = true;
    this.changed();
  }
  openPortalSettings() {
    this.beginSettingsRoute("portal");
    this.navigate("portal");
  }
  openDiagnostics() {
    this.beginSettingsRoute("diagnostics");
    this.diagnosticsOpen = true;
    this.changed();
  }
  dismissSettingsRoute = () => {
    this.settingsRoute = "";
    this.settingsForwardRoute = "";
    this.changed();
  };
  returnToClientSettings = () => {
    const route = this.settingsRoute;
    if (!route) return;
    this.settingsRoute = "";
    this.settingsForwardRoute = route;
    if (this.settingsOpen) {
      this.settingsOpen = false;
      ++this.defaultsRevision;
      clearTimeout(this.defaultsTimer);
      if (this.form) { this.form.connectionLink = ""; this.form.subagentSetup = undefined; }
    }
    this.diagnosticsOpen = false;
    this.subagentSettingsOpen = false;
    if (route === "model")
      this.post({ type: "beings:chat-action", action: "close" });
    if (this.view !== "chat") this.navigate("chat");
    void this.openClientSettings(true);
  };
  forwardSettingsRoute = () => {
    const route = this.settingsForwardRoute;
    if (!route) return;
    if (route === "connection") this.openConnectionSettings();
    else if (route === "town") this.openTownSettings();
    else if (route === "model") this.openModelSettings();
    else if (route === "portal") this.openPortalSettings();
    else if (route === "diagnostics") this.openDiagnostics();
  };
  closeClientSettings = () => {
    this.clientSettingsOpen = false;
    this.settingsRoute = "";
    this.settingsForwardRoute = "";
    this.changed();
  };
  closePlace = () => {
    this.settingsRoute = "";
    this.settingsForwardRoute = "";
    this.navigate("chat");
  };
  returnFromPlace = () => {
    if (this.settingsRoute === "portal") this.returnToClientSettings();
    else this.town.returnToSource();
  };
  forwardFromPlace = () => {
    this.town.forwardToDestination();
  };
  async sharePortalLogs() {
    if (this.logsLoading) return;
    if (!this.snapshot?.settings.hasToken || !this.chatSource) {
      this.toast("请先连接 Being，再一起看 Portal 日志。");
      return;
    }
    this.logsLoading = true;
    const request = this.logsRequest = crypto.randomUUID();
    this.changed();
    const endpoint = this.snapshot.settings.endpoint, source = this.chatSource;
    try {
      const logs = await this.api.portalLogReference();
      if (this.logsRequest !== request) return;
      if (logs.endpoint !== endpoint || this.snapshot?.settings.endpoint !== endpoint || this.chatSource !== source) {
        throw new Error("连接已切换，请重新选择 Portal 日志。");
      }
      this.workspace.enter("portal");
      this.workspace.scenes.select({ id: `portal-logs:${request}`, title: "Portal 日志",
        author: "本机 Portal", excerpt: logs.text, private: true });
      this.workspace.scenes.pin();
      this.navigate("chat");
      this.workspace.toggle(true);
    } catch (error) {
      if (this.logsRequest === request) this.toast(error);
    } finally {
      if (this.logsRequest === request) {
        this.logsRequest = "";
        this.logsLoading = false;
        this.changed();
      }
    }
  }
  async changePortal(operation: "start" | "stop" | "restart" | "force") {
    if (this.portalAction || !this.snapshot) return;
    this.portalAction = operation;
    this.portalError = "";
    this.changed();
    try {
      const portal: PortalState = await (operation === "start"
        ? this.api.startPortal()
        : operation === "restart" ? this.api.restartPortal()
          : operation === "force" ? this.api.forceStartPortal() : this.api.stopPortal());
      this.snapshot = { ...this.snapshot, portal };
      this.changed();
      this.applySnapshot(await this.api.snapshot());
    } catch (error) {
      this.portalError = errorText(error);
    } finally {
      this.portalAction = null;
      this.changed();
    }
  }
  async openClientSettings(preserveHistory = false) {
    this.settingsRoute = "";
    if (!preserveHistory) this.settingsForwardRoute = "";
    this.clientSettingsOpen = true;
    this.clientError = "";
    this.startupBusy = true;
    this.changed();
    void this.loadNotifications();
    try {
      this.clientStartup = await this.api.clientStartup();
    } catch (error) {
      this.clientError = errorText(error);
    } finally {
      this.startupBusy = false;
      this.changed();
    }
  }
  async changeClientStartup(enabled: boolean) {
    if (this.startupBusy) return;
    this.startupBusy = true;
    this.clientError = "";
    this.changed();
    try {
      this.clientStartup = await this.api.clientStartup(enabled);
    } catch (error) {
      this.clientError = errorText(error);
      try {
        this.clientStartup = await this.api.clientStartup();
      } catch {
        if (this.clientStartup)
          this.clientStartup = { ...this.clientStartup, supported: false };
      }
    } finally {
      this.startupBusy = false;
      this.changed();
    }
  }
  private async openNotification() {
    const revision = this.initializeRevision;
    await this.run(async () => {
      const target = await this.api.takeNotificationTarget();
      if (!target || revision !== this.initializeRevision) return;
      this.closeClientSettings();
      this.closeSettings();
      this.diagnosticsOpen = false;
      this.searchOpen = false;
      if (target.channel === "mail") this.town.tabs.mail = "inbox";
      if (target.channel === "firesides") {
        if (target.firesideId) this.town.selectedRing = target.firesideId;
        this.town.ringSearch = "";
      }
      // Open the normal group page, with its room list and selected group.
      // directId is reserved for content links and bypasses that page.
      this.navigate(target.channel);
    });
  }
  async loadNotifications() {
    if (this.notificationsBusy) return;
    this.notificationsBusy = true;
    this.notificationsError = "";
    this.changed();
    try { this.notificationSettings = await this.api.notifications(); }
    catch (error) { this.notificationsError = errorText(error); }
    finally { this.notificationsBusy = false; this.changed(); }
  }
  async changeNotifications(patch: Partial<NotificationPreferences>) {
    if (this.notificationsBusy) return;
    const previous = this.notificationSettings;
    if (previous) this.notificationSettings = {
      ...previous, preferences: { ...previous.preferences, ...patch },
    };
    this.notificationsBusy = true;
    this.notificationsError = "";
    this.changed();
    try { this.notificationSettings = await this.api.notifications(patch); }
    catch (error) {
      this.notificationSettings = previous;
      this.notificationsError = errorText(error);
    }
    finally { this.notificationsBusy = false; this.changed(); }
  }
  async testNotification() {
    if (this.notificationsBusy) return;
    this.notificationsBusy = true;
    this.notificationsError = "";
    this.changed();
    try {
      await this.api.testNotification();
      this.toast("已请求系统显示测试通知；若未看到，请检查系统通知权限与勿扰模式。");
      this.notificationSettings = await this.api.notifications();
    } catch (error) { this.notificationsError = errorText(error); }
    finally { this.notificationsBusy = false; this.changed(); }
  }
  showSettings(fromClientSettings = false) {
    if (!this.snapshot) return;
    if (!fromClientSettings) {
      this.settingsRoute = "";
      this.settingsForwardRoute = "";
    }
    this.clientSettingsOpen = false;
    this.settingsOpen = true;
    const s = this.snapshot.settings;
    this.form = {
      connectionLink: "",
      workspace: s.workspace,
      portalBinary: s.portalBinary,
      portalName: s.portalName,
      autoStart: s.autoStart,
      backgroundEnabled: Boolean(s.backgroundEnabled),
      allowExec: s.allowExec,
      kitsEnabled: s.kitsEnabled,
      portalConfigPath: s.portalConfigPath,
      portalEnvironmentPath: s.portalEnvironmentPath,
    };
    this.nameEdited = false;
    this.formError = "";
    this.portalNameHelp = "已有本机 Portal 时默认沿用名称，也可以自行修改。";
    this.changed();
    void this.fillDefaults();
  }
  closeSettings() {
    this.settingsOpen = false;
    this.settingsRoute = "";
    this.settingsForwardRoute = "";
    ++this.defaultsRevision;
    clearTimeout(this.defaultsTimer);
    if (this.form) { this.form.connectionLink = ""; this.form.subagentSetup = undefined; }
    this.changed();
  }
  editForm<K extends keyof SaveSettings>(key: K, value: SaveSettings[K]) {
    if (!this.form) return;
    this.form = { ...this.form, [key]: value };
    if (key === "portalName") this.nameEdited = true;
    if (key === "connectionLink") {
      ++this.defaultsRevision;
      clearTimeout(this.defaultsTimer);
      this.defaultsTimer = setTimeout(() => void this.fillDefaults(), 300);
    }
    this.changed();
  }
  async fillDefaults() {
    const revision = ++this.defaultsRevision,
      link = this.form?.connectionLink;
    if (!link && !this.snapshot?.settings.hasToken) return;
    try {
      const defaults = await this.api.connectionDefaults({
        connectionLink: link,
      });
      if (
        revision !== this.defaultsRevision ||
        !this.settingsOpen ||
        !this.form
      )
        return;
      if (!this.nameEdited)
        this.form = { ...this.form, portalName: defaults.portalName };
      this.portalNameHelp = defaults.source
        ? `检测到原 Portal 名称：${defaults.portalName}。${this.nameEdited ? "保留你填写的名称。" : "已默认沿用，可修改。"}`
        : "未发现同一 Being 的本机 Portal，可设置新名称。";
      this.changed();
    } catch {
      /* Incomplete links are validated when saving. */
    }
  }
  async saveSettings() {
    if (this.saving || !this.form) return;
    this.saving = true;
    this.formError = "";
    this.changed();
    try {
      if (!this.nameEdited) await this.fillDefaults();
      const expectedSubagent = this.form.subagentEnabled;
      const next = await this.api.save({ ...this.form });
      this.applySnapshot(next, true);
      if (expectedSubagent !== undefined) {
        const persisted = await this.api.subagentConfig();
        if ((persisted.enabled !== false) !== expectedSubagent)
          throw new Error('subagent 开关未写入配置，请完全退出并重新打开客户端后重试。');
      }
      this.closeSettings();
      this.navigate("chat");
    } catch (error) {
      this.formError = errorText(error);
    } finally {
      this.saving = false;
      this.changed();
    }
  }
}

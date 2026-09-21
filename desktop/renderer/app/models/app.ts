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
import { WorkspaceModel } from "./workspace";
import { TownModel } from "../../town/models/town";
import type { HistoryScope } from "../../chat/models/scenes";

type SettingsRoute = "" | "connection" | "town" | "model" | "portal" | "diagnostics";

export class AppModel extends Store {
  snapshot?: Snapshot;
  theme: "light" | "dark" = "light";
  startup: "loading" | "ready" | "error" = "loading";
  view = "chat";
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
  clientSettingsOpen = false;
  settingsRoute: SettingsRoute = "";
  settingsForwardRoute: SettingsRoute = "";
  diagnosticsOpen = false;
  searchOpen = false;
  search = "";
  searchEntries: { id: string; text: string }[] = [];
  readingSize = 15;
  update?: UpdateState;
  portalAction: "start" | "stop" | "restart" | "force" | null = null;
  portalError = "";
  logsLoading = false;
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
  constructor(readonly api: DesktopAPI) {
    super();
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
  }
  start() {
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
      const size = Number(localStorage.getItem("beings:reading-size"));
      if (Number.isInteger(size) && size >= 13 && size <= 21)
        this.readingSize = size;
    } catch {
      /* Optional preference. */
    }
    const cleanups = [
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
      this.chatSource = `beings://chat/?name=${encodeURIComponent(next.settings.being)}&history_scope=${encodeURIComponent(next.settings.endpoint)}&scene_scope=${this.chatHistoryScope}&scene_strict=1&theme=${this.theme}&revision=${crypto.randomUUID()}`;
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
    this.post({ type: "beings:search-request" });
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
    const next = await this.api.changeChatSession(operation, value, endpoint, sceneId);
    if (this.snapshot?.settings.endpoint !== endpoint) return;
    this.applySnapshot(next);
    this.chatHistoryScope = "current";
    this.navigate("chat");
    this.postCurrentSession();
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
    this.navigate("chat");
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
    this.post({ type: "beings:search-request" });
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
    this.post({ type: "beings:chat-action", action: "model", returnToSettings: true });
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
      if (this.form) this.form.connectionLink = "";
    }
    this.diagnosticsOpen = false;
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
    if (this.form) this.form.connectionLink = "";
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
      const next = await this.api.save({ ...this.form });
      this.applySnapshot(next, true);
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

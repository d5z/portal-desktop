import { describe, expect, it, vi, afterEach } from "vitest";
import { AppModel } from "../desktop/renderer/app/models/app";
import {
  TownModel,
  firesideMemberCount,
  firesideMemberDetails,
  firesideMembers,
} from "../desktop/renderer/town/models/town";
import { WorkspaceModel } from "../desktop/renderer/app/models/workspace";
import { SceneStore } from "../desktop/renderer/shared/models/scene";
import {
  feedMessages,
  filterMessages,
  newFeedFilters,
} from "../desktop/renderer/town/models/feed";
import type {
  DesktopAPI,
  Snapshot,
  TownLiveState,
  TownResult,
} from "../desktop/shared/types";
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const state = (being = "willow"): Snapshot => ({
  settings: {
    being,
    endpoint: "https://fixture.test/" + being,
    hasToken: true,
    workspace: "/workspace",
    portalBinary: "/portal",
    portalName: "portal",
    autoStart: false,
    allowExec: true,
    kitsEnabled: true,
  },
  portal: { phase: "stopped", message: "stopped", logs: [] },
});
const live = (
  generation = 1,
  revision = 1,
  beingId = "willow",
): TownLiveState => ({
  phase: "connected",
  generation,
  revision,
  beingId,
  sync: 1,
  message: "connected",
  versions: { bonfire: 0, mail: 0, firesides: 0 },
});
const result = (data: Record<string, unknown>): TownResult => ({
  ok: true,
  data,
  fetchedAt: "2026-09-12T00:00:00Z",
});
function api(overrides: Partial<DesktopAPI> = {}) {
  const subscriptions = new Set<unknown>();
  const on = (callback: unknown) => {
    subscriptions.add(callback);
    return () => {
      subscriptions.delete(callback);
    };
  };
  const value = {
    snapshot: vi.fn(async () => state()),
    appearance: vi.fn(async () => "light"),
    updateState: vi.fn(async () => ({ phase: "idle" })),
    onPortal: on,
    onUpdate: on,
    onTownLive: on,
    onNotificationOpen: on,
    takeNotificationTarget: vi.fn(async () => null),
    notifications: vi.fn(async () => ({ supported: true, message: '', preferences: { enabled: false, mail: false, firesides: false, bonfire: false } })),
    townLive: vi.fn(async () => live()),
    townAuth: vi.fn(async () => ({ configured: true, beingId: "willow" })),
    town: vi.fn(async () => result({ messages: [] })),
    connectionDefaults: vi.fn(async () => ({ portalName: "original-portal" })),
    ...overrides,
  } as unknown as DesktopAPI;
  return { value, subscriptions };
}
function town(overrides: Partial<DesktopAPI> = {}) {
  const fixture = api(overrides);
  return {
    ...fixture,
    model: new TownModel(
      fixture.value,
      vi.fn(),
      vi.fn(),
      new SceneStore(),
      vi.fn(),
      vi.fn(),
    ),
  };
}
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};
afterEach(() => vi.useRealTimers());
describe("React desktop state lifecycle", () => {
  it("loads the saved Town name at startup without opening pairing or querying public pages", async () => {
    let receive!: (state: TownLiveState) => void;
    const townQuery = vi.fn(), autoPairTown = vi.fn();
    const saved = { configured: true, pairedBeingId: "t_Willow", display: "柳树 (t_Willow)" };
    const { model } = town({
      town: townQuery,
      autoPairTown,
      townAuth: vi.fn(async () => saved),
      townLive: vi.fn(async () => ({ ...live(), phase: "connecting" as const, beingId: undefined, sync: 0 })),
      onTownLive: callback => { receive = callback; return () => {}; },
    });
    const stop = model.start();
    try {
      await settle();
      expect(model.displayName).toBe("柳树");
      expect(model.live?.phase).toBe("connecting");
      expect(model.authOpen).toBe(false);
      const changed = vi.fn();
      const unsubscribe = model.subscribe(changed);
      receive({ ...live(1, 2, "t_Willow"), display: "新柳树" });
      await settle();
      expect(model.displayName).toBe("新柳树");
      expect(changed).toHaveBeenCalled();
      expect(model.live?.phase).toBe("connected");
      expect(model.authOpen).toBe(false);
      expect(townQuery).not.toHaveBeenCalled();
      expect(autoPairTown).not.toHaveBeenCalled();
      unsubscribe();
    } finally { stop(); }
  });
  it("keeps saved names while reconnecting and ignores names for a different confirmed identity", async () => {
    const { model } = town({ townAuth: vi.fn(async () => ({ configured: true, pairedBeingId: "t_Willow", display: "柳树" })) });
    model.receiveLive({ ...live(), phase: "reconnecting", beingId: undefined });
    await settle();
    expect(model.displayName).toBe("柳树");
    model.receiveLive(live(1, 2, "t_River"));
    await settle();
    expect(model.displayName).toBe("");
  });
  it.each(["identity", "auth-error", "disposal"])("ignores delayed pairing metadata after %s", async change => {
    const pending = deferred<Awaited<ReturnType<DesktopAPI["townAuth"]>>>();
    const { model } = town({
      townAuth: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ configured: false }),
      townLive: vi.fn(async () => live(1, 1, "t_Willow")),
    });
    const stop = model.start();
    try {
      await settle();
      if (change === "identity") model.receiveLive(live(2, 2, "t_River"));
      else if (change === "auth-error") model.receiveLive({ ...live(1, 2), phase: "auth-error", beingId: undefined });
      else stop();
      pending.resolve({ configured: true, pairedBeingId: "t_Willow", display: "旧配对名" });
      await settle();
      expect(model.displayName).toBe("");
    } finally { stop(); }
  });
  it("sends a selected Town message straight to the Being chat for reply drafting", () => {
    const post = vi.fn(), navigate = vi.fn(), scenes = new SceneStore();
    scenes.configure("willow", "https://fixture.test/willow");
    const model = new TownModel(api().value, vi.fn(), navigate, scenes, vi.fn(), post, vi.fn(), () => true);
    model.view = "bonfire";
    model.live = live();
    model.compose({
      id: 7,
      author: "河流",
      preview: "你怎么看？",
      content: "你怎么看？",
      context: "柳树：前一条消息",
    });
    model.content = "语气温和一些";
    model.askBeing();
    expect(navigate).toHaveBeenCalledWith("chat");
    const request = post.mock.calls[0][0];
    expect(request).toMatchObject({ type: "beings:town-reply" });
    expect(request.text).toContain("请帮我拟一段回复，直接发送，并将回复正文发给我。");
    expect(request.text).toContain("位置：篝火");
    expect(request.text).toContain("回复对象：河流");
    expect(request.text).toContain("> 柳树：前一条消息");
    expect(request.text).toContain("> 你怎么看？");
    expect(request.text).toContain("> 语气温和一些");
    expect(model.sendOpen).toBe(false);
  });
  it("asks the Being to write and send a new Town post from the user's description and place", () => {
    const post = vi.fn(), navigate = vi.fn(), scenes = new SceneStore();
    scenes.configure("willow", "https://fixture.test/willow");
    const model = new TownModel(api().value, vi.fn(), navigate, scenes, vi.fn(), post, vi.fn(), () => true);
    model.view = "firesides";
    model.selectedRing = "10";
    model.ringTitle = "产品讨论";
    model.live = live();
    model.compose();
    model.content = "提醒大家周五前提交反馈，语气轻松一些";
    expect(model.canAskBeingSend).toBe(true);
    model.askBeing();
    expect(navigate).toHaveBeenCalledWith("chat");
    const request = post.mock.calls[0][0];
    expect(request).toMatchObject({ type: "beings:town-reply" });
    expect(request.text).toContain("请根据我的描述和场景位置，帮我写一句适合发布的内容，直接发送");
    expect(request.text).toContain("场景位置：围炉「产品讨论」");
    expect(request.text).toContain("> 提醒大家周五前提交反馈，语气轻松一些");
    expect(model.sendOpen).toBe(false);
  });
  it("passes the proxy's exact scene identity to the chat without changing the cache identity", () => {
    const app = new AppModel(api().value);
    const snapshot = state();
    snapshot.chatScene = { scene_id: "desktop-fixed", scene_meta: { client: "portal-desktop/0.1.3", scene_label: "桌面·测试 & PC" } };
    app.applySnapshot(snapshot);
    const url = new URL(app.chatSource);
    expect(url.searchParams.get("scene_id")).toBe(snapshot.chatScene.scene_id);
    expect(url.searchParams.get("scene_label")).toBe(snapshot.chatScene.scene_meta.scene_label);
    expect(url.searchParams.get("history_scope")).toBe(snapshot.settings.endpoint);
    expect(url.searchParams.has("token")).toBe(false);
  });
  it.each(['all', 'current'] as const)("preserves the selected %s history view when refreshing the same chat", scope => {
    const app = new AppModel(api().value);
    const snapshot = { ...state(), chatScene: { scene_id: 'desktop-fixed', scene_meta: { client: 'portal-desktop', scene_label: 'Desktop' } } };
    app.applySnapshot(snapshot);
    app.frameLoaded();
    app.setChatHistoryScope('current');
    app.changeChatHistoryScope('all');
    app.setChatHistoryScope('all');
    if (scope === 'current') {
      app.changeChatHistoryScope('current');
      app.setChatHistoryScope('current');
    }
    const source = app.chatSource;
    app.applySnapshot(snapshot, true);
    expect(app.chatSource).not.toBe(source);
    expect(app.chatHistoryScope).toBe(scope);
    expect(new URL(app.chatSource).searchParams.get('scene_scope')).toBe(scope);
    expect(app.chatHistoryScopeKnown).toBe(false);
    app.applySnapshot(snapshot, true);
    expect(new URL(app.chatSource).searchParams.get('scene_scope')).toBe(scope);
    app.applySnapshot({ ...snapshot, settings: state('river').settings }, true);
    expect(app.chatHistoryScope).toBe('current');
    expect(new URL(app.chatSource).searchParams.get('scene_scope')).toBe('current');
  });
  it("announces the scene context only when a session change enters another scene", async () => {
    vi.useFakeTimers();
    const original = { scene_id: "desktop-original", scene_meta: { client: "portal-desktop", scene_label: "日常对话" } };
    const discussion = { scene_id: "desktop-discussion", scene_meta: { client: "portal-desktop", scene_label: "方案讨论" } };
    const initial = { ...state(), chatScene: original, chatSessions: [original, discussion] };
    const changed = { ...initial, chatScene: discussion };
    const changeChatSession = vi.fn()
      .mockResolvedValueOnce(changed)
      .mockResolvedValueOnce({ ...changed, chatScene: { ...discussion, scene_meta: { ...discussion.scene_meta, scene_label: "技术方案" } } });
    const app = new AppModel(api({ changeChatSession }).value);
    app.applySnapshot(initial);
    app.setPlacePresentation("panel");
    app.navigate("bonfire");

    await app.changeChatSession("select", discussion.scene_id);
    expect(app.toastMessage).toBe("已切到「方案讨论」场景");
    expect(app.view).toBe("bonfire");

    app.toastMessage = "";
    await app.changeChatSession("rename", "技术方案", discussion.scene_id);
    expect(app.toastMessage).toBe("");
  });
  it("previews Portal logs through Together without posting until the user composes a reference", async () => {
    vi.useFakeTimers();
    const pending = deferred<{ endpoint: string; text: string }>();
    const getLogs = vi.fn(() => pending.promise);
    const app = new AppModel(api({ portalLogReference: getLogs }).value), post = vi.fn();
    const messages = () => post.mock.calls.map(call => call[0]).filter(message => message.type !== 'beings:town-activity');
    app.post = post;
    app.applySnapshot(state()); app.frameLoaded(); app.connection = 'online';
    post.mockClear();
    const selecting = app.sharePortalLogs();
    await app.sharePortalLogs();
    expect(getLogs).toHaveBeenCalledOnce();
    pending.resolve({ endpoint: state().settings.endpoint, text: 'redacted log fixture' });
    await selecting;
    expect(messages()).toEqual([]);
    expect(app.logsLoading).toBe(false);
    expect(app.view).toBe('chat');
    expect(app.workspace.open).toBe(true);
    expect(app.workspace.scenes.reference).toMatchObject({ view: 'portal', title: 'Portal 设置',
      selection: { title: 'Portal 日志', author: '本机 Portal', excerpt: 'redacted log fixture', private: true } });
    app.applySnapshot({ ...state(), portal: { phase: 'connected', message: 'new state', logs: ['later output'] } });
    expect(app.workspace.scenes.reference?.selection?.excerpt).toBe('redacted log fixture');
    app.workspace.compose();
    expect(messages()).toHaveLength(1);
    const message = messages()[0];
    expect(message).toMatchObject({ type: 'beings:scene-draft',
      text: '一起看看Portal 设置里的这段（本机 Portal）：\n\n> redacted log fixture' });
    app.workspace.receive({ type: 'beings:scene-draft-result', id: message.id, ok: true });
    expect(app.workspace.open).toBe(false);
    expect(messages()).toHaveLength(1);
  });
  it("discards a Portal log reference collected before an identity change", async () => {
    vi.useFakeTimers();
    const pending = deferred<{ endpoint: string; text: string }>();
    const app = new AppModel(api({ portalLogReference: () => pending.promise }).value), post = vi.fn();
    app.post = post;
    app.applySnapshot(state()); app.frameLoaded(); app.connection = 'online'; post.mockClear();
    const selecting = app.sharePortalLogs();
    app.applySnapshot(state('other'), true);
    pending.resolve({ endpoint: state().settings.endpoint, text: 'old logs' });
    await selecting;
    expect(post).not.toHaveBeenCalled();
    expect(app.logsLoading).toBe(false);
    expect(app.workspace.scenes.reference).toBeNull();
    expect(app.workspace.open).toBe(false);
  });
  it("invalidates SBS on refresh and waits for confirmed state instead of toggling optimistically", () => {
    const app = new AppModel(api().value), post = vi.fn();
    app.post = post;
    app.applySnapshot(state());
    app.frameLoaded();
    expect(post).toHaveBeenCalledWith({ type: 'beings:sbs-request' });
    expect(app.sbsKnown).toBe(false);
    app.setSbsEnabled(false);
    app.applySnapshot(state());
    expect(app.sbsKnown).toBe(true);
    const source = app.chatSource;
    app.applySnapshot(state(), true);
    expect(app.chatSource).not.toBe(source);
    expect(app.sbsKnown).toBe(false);
    post.mockClear();
    app.toggleSbs();
    expect(post).not.toHaveBeenCalled();
    app.frameLoaded();
    expect(post).toHaveBeenCalledWith({ type: 'beings:sbs-request' });
    app.setSbsEnabled(false);
    post.mockClear();
    app.toggleSbs();
    app.toggleSbs();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({ type: 'beings:sbs-toggle' });
    expect(app.sbsEnabled).toBe(false);
    expect(app.sbsKnown).toBe(false);
    app.setSbsEnabled(true);
    expect(app.sbsKnown).toBe(true);
    expect(app.sbsEnabled).toBe(true);
    app.setSbsEnabled();
    expect(app.sbsKnown).toBe(false);
    app.setSbsEnabled(true);
    const disconnected = state();
    disconnected.settings.hasToken = false;
    app.applySnapshot(disconnected);
    expect(app.sbsKnown).toBe(false);
  });

  it("refreshes each place navigation and clears pending details when changing features", async () => {
    const pending = deferred<TownResult>();
    const query = vi.fn<DesktopAPI['town']>(async query => {
      if (query.kind === 'seed') return pending.promise;
      if (query.kind === 'seeds') return result({ seeds: [], count: 0 });
      return result({ messages: [{ content: 'fresh bonfire' }] });
    });
    const app = new AppModel(api({ town: query }).value);
    app.navigate('seeds', 'pending-seed');
    await settle();
    expect(app.town.detailLoading).toBe(true);
    app.navigate('bonfire');
    await settle();
    expect(app.view).toBe('bonfire');
    expect(app.town.directId).toBeUndefined();
    expect(app.town.detailLoading).toBe(false);
    app.navigate('seeds');
    await settle();
    expect(app.town.detailLoading).toBe(false);
    expect(app.town.data).toEqual({ seeds: [], count: 0 });
    pending.resolve(result({ brief: 'old seed' }));
    await settle();
    expect(app.town.detail).toBeUndefined();
    app.navigate('bonfire');
    await settle();
    app.navigate('bonfire');
    await settle();
    expect(query.mock.calls.filter(([query]) => query.kind === 'bonfire')).toHaveLength(3);
    expect(app.town.data?.messages).toEqual([{ content: 'fresh bonfire' }]);
  });

  it("releases IPC subscriptions and ignores startup reads from an earlier mount", async () => {
    const old = deferred<Snapshot>(),
      fresh = deferred<Snapshot>();
    const fixture = api({
      snapshot: vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(fresh.promise),
    });
    const app = new AppModel(fixture.value),
      stop = app.start();
    expect(fixture.subscriptions.size).toBe(4);
    stop();
    expect(fixture.subscriptions.size).toBe(0);
    const stopAgain = app.start();
    expect(fixture.subscriptions.size).toBe(4);
    fresh.resolve(state("river"));
    await settle();
    old.resolve(state("willow"));
    await settle();
    expect(app.snapshot?.settings.being).toBe("river");
    expect(app.startup).toBe("ready");
    stopAgain();
    expect(fixture.subscriptions.size).toBe(0);
  });
  it("preserves the chat document during status updates and reloads explicitly", () => {
    const app = new AppModel(api().value);
    app.applySnapshot(state());
    const src = app.chatSource;
    app.applySnapshot({
      ...state(),
      portal: { phase: "connected", message: "online", logs: ["ready"] },
    });
    expect(app.chatSource).toBe(src);
    app.applySnapshot(state(), true);
    expect(app.chatSource).not.toBe(src);
    app.applySnapshot({
      ...state(),
      settings: { ...state().settings, hasToken: false },
    });
    expect(app.chatSource).toBe("");
  });
  it("does not overwrite an edited Portal name with late defaults", async () => {
    const pending = deferred<{ portalName: string; source: string }>();
    const app = new AppModel(
      api({ connectionDefaults: () => pending.promise }).value,
    );
    app.applySnapshot(state());
    app.showSettings();
    app.editForm("portalName", "my-portal");
    pending.resolve({ portalName: "detected", source: "old config" });
    await settle();
    expect(app.form?.portalName).toBe("my-portal");
    expect(app.portalNameHelp).toContain("保留你填写的名称");
    app.closeSettings();
  });
  it("invalidates closed forms and clears the connection secret", async () => {
    const pending = deferred<{ portalName: string }>();
    const app = new AppModel(
      api({ connectionDefaults: () => pending.promise }).value,
    );
    app.applySnapshot(state());
    app.showSettings();
    app.editForm("connectionLink", "https://fixture.test/?token=secret");
    app.closeSettings();
    pending.resolve({ portalName: "late" });
    await settle();
    expect(app.form?.connectionLink).toBe("");
    expect(app.form?.portalName).toBe("portal");
  });
  it("returns from the subagent side panel without losing connection drafts", () => {
    const fixture = api();
    const app = new AppModel(fixture.value), post = vi.fn();
    app.post = post;
    app.applySnapshot(state());
    app.showSettings();
    app.editForm("connectionLink", "https://fixture.test/?token=draft");
    const form = app.form;
    app.openSubagentSettings(true);
    expect(app.settingsOpen).toBe(false);
    expect(app.subagentSettingsOpen).toBe(true);
    app.closeSubagentSettings();
    expect(app.settingsOpen).toBe(true);
    expect(app.form).toBe(form);
    expect(app.form?.connectionLink).toContain("token=draft");
    app.closeSettings();
    app.openSubagentSettings();
    expect(post).toHaveBeenCalledWith({ type: "beings:chat-action", action: "close" });
    app.closeSubagentSettings();
    expect(app.settingsOpen).toBe(false);
  });
  it("returns from every settings destination to the settings hub", async () => {
    const fixture = api({ clientStartup: vi.fn(async () => ({ supported: true, enabled: false, message: "关闭" })) });
    const app = new AppModel(fixture.value), post = vi.fn();
    app.post = post;
    app.applySnapshot(state());

    await app.openClientSettings();
    app.openConnectionSettings();
    expect(app.settingsRoute).toBe("connection");
    expect(app.settingsOpen).toBe(true);
    app.returnToClientSettings();
    expect(app.clientSettingsOpen).toBe(true);
    expect(app.settingsOpen).toBe(false);
    expect(app.settingsForwardRoute).toBe("connection");
    app.forwardSettingsRoute();
    expect(app.settingsOpen).toBe(true);
    app.returnToClientSettings();

    app.openModelSettings();
    expect(app.subagentSettingsOpen).toBe(true);
    expect(app.modelSettingsTarget).toBe("Heart");
    app.returnToClientSettings();
    expect(app.subagentSettingsOpen).toBe(false);
    expect(app.clientSettingsOpen).toBe(true);

    app.openPortalSettings();
    expect(app.view).toBe("portal");
    app.returnFromPlace();
    expect(app.view).toBe("chat");
    expect(app.clientSettingsOpen).toBe(true);
    expect(app.settingsForwardRoute).toBe("portal");

    app.openDiagnostics();
    expect(app.diagnosticsOpen).toBe(true);
    app.returnToClientSettings();
    expect(app.diagnosticsOpen).toBe(false);
    expect(app.clientSettingsOpen).toBe(true);
    expect(app.settingsForwardRoute).toBe("diagnostics");
    app.closeClientSettings();
    expect(app.settingsForwardRoute).toBe("");
  });
});
describe("Town request and identity isolation", () => {
  it('defaults to automatic pairing for the connected chat and falls back to manual on failure', async () => {
    const autoPairTown = vi.fn(async () => { throw new Error('自动配对超时'); });
    const { model } = town({ townAuth: async () => ({ configured: false, chatBeing: 'willow' }), autoPairTown });
    model.view = 'chat';
    await model.auth();
    expect(model.authManual).toBe(false);
    await model.autoPair();
    expect(autoPairTown).toHaveBeenCalledWith({ requestId: expect.any(String), beingId: 'willow' });
    expect(model.authManual).toBe(true);
    expect(model.authBeing).toBe('willow');
    expect(model.authError).toContain('超时');
    expect(model.authBusy).toBe(false);
  });
  it('closes after cancellation even if the aborted request rejects before the cancel reply arrives', async () => {
    let reject!: (error: Error) => void;
    const autoPairTown = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    const cancelTownPair = vi.fn(async () => { reject(new Error('自动配对已取消')); await settle(); return true; });
    const { model } = town({ townAuth: async () => ({ configured: false, chatBeing: 'willow' }), autoPairTown, cancelTownPair });
    model.view = 'chat';
    await model.auth();
    const pending = model.autoPair();
    await model.autoPair();
    expect(autoPairTown).toHaveBeenCalledOnce();
    await model.closeAuth();
    await pending;
    expect(cancelTownPair).toHaveBeenCalledOnce();
    expect(model.authOpen).toBe(false);
    expect(model.authBusy).toBe(false);
    expect(model.authError).toBe('');
  });
  it('keeps a completed pairing when cancellation arrives during atomic credential storage', async () => {
    const pending = deferred<void>();
    const { model } = town({ townAuth: async () => ({ configured: false, chatBeing: 'willow' }), autoPairTown: () => pending.promise, cancelTownPair: async () => false });
    model.view = 'chat';
    await model.auth();
    const run = model.autoPair();
    await model.closeAuth();
    expect(model.authOpen).toBe(true);
    expect(model.authBusy).toBe(true);
    pending.resolve(); await run;
    expect(model.authOpen).toBe(false);
    expect(model.authBusy).toBe(false);
  });
  it("ignores a response from the previous page", async () => {
    const pending = deferred<TownResult>();
    const { model } = town({
      town: vi
        .fn()
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValue(result({ scrolls: [{ id: "story" }] })),
    });
    model.show("bonfire");
    model.show("embers");
    await settle();
    pending.resolve(result({ messages: [{ content: "old private content" }] }));
    await settle();
    expect(model.view).toBe("embers");
    expect(model.data).toEqual({ scrolls: [{ id: "story" }] });
    expect(model.loading).toBe(false);
  });
  it("discards stale details and private drafts when the identity changes", async () => {
    const pending = deferred<TownResult>();
    const { model } = town({ town: () => pending.promise });
    model.live = live();
    model.view = "chat";
    model.sendTarget = { kind: "dm", beingId: "willow", generation: 1 };
    model.content = "private draft";
    model.recipient = "friend";
    model.mentionNames = new Map([['t_Friend', { name: '私信伙伴', at: 0 }]]);
    model.sendOpen = true;
    const read = model.loadDetail({ kind: "scroll", id: "private" });
    model.receiveLive(live(2, 2, "river"));
    pending.resolve(result({ title: "private", content: "must not appear" }));
    await read;
    expect(model.detail).toBeUndefined();
    expect(model.content).toBe("");
    expect(model.recipient).toBe("");
    expect(model.sendTarget).toBeUndefined();
    expect(model.sendOpen).toBe(false);
    expect(model.mentionNames.size).toBe(0);
  });
  it("sends once and never retries an uncertain result automatically", async () => {
    const pending = deferred<TownResult>(),
      sendTown = vi.fn(() => pending.promise);
    const { model } = town({ sendTown });
    model.live = live();
    model.view = "bonfire";
    model.compose();
    model.content = "hello";
    const send = model.send();
    await model.send();
    expect(sendTown).toHaveBeenCalledTimes(1);
    pending.resolve({
      ok: false,
      code: "network",
      message: "请先核对是否送达",
    });
    await send;
    expect(model.sendOpen).toBe(true);
    expect(model.content).toBe("hello");
    expect(model.sendError).toContain("核对");
    expect(sendTown).toHaveBeenCalledTimes(1);
  });
  it("keeps successful mention warnings visible and clears the sent draft so it cannot be resent by another click", async () => {
    const sendTown = vi.fn(async (): Promise<TownResult> => ({ ok: true, data: { ok: true, seq: 7 }, fetchedAt: '2026-09-14T00:00:00Z', warnings: ['Neo · ambiguous · 候选：t_NeoA；t_NeoB'] }));
    const { model } = town({ sendTown });
    model.live = live();
    model.view = 'bonfire';
    model.compose();
    model.content = '@Neo 你好';
    await model.send();
    expect(model.sendOpen).toBe(true);
    expect(model.sendNotice).toContain('消息已发送');
    expect(model.sendNotice).toContain('t_NeoB');
    expect(model.sendError).toBe('');
    expect(model.content).toBe('');
    expect(model.canSend).toBe(false);
    await model.send();
    expect(sendTown).toHaveBeenCalledTimes(1);
    model.compose();
    expect(model.content).toBe('');
    expect(model.sendNotice).toBe('');
  });
  it("loads the private All tab by merging inbox and sent messages", async () => {
    const townApi = vi.fn(async (query: import("../desktop/shared/types").TownQuery) =>
      result({
        messages:
          query.kind === "inbox"
            ? [{ id: "incoming", sender: "river", recipient: "willow" }]
            : [{ id: "outgoing", sender: "willow", recipient: "river" }],
      }),
    );
    const { model } = town({ town: townApi });
    model.live = live();
    model.show("mail");
    await settle();
    expect(model.tab).toBe("all");
    expect(model.data?.messages).toHaveLength(2);
    expect(townApi.mock.calls.map(([query]) => query.kind)).toEqual([
      "inbox",
      "sent",
    ]);
  });
  it("keeps the private-message tab selected after sending", async () => {
    const townApi = vi.fn(async (_query: import("../desktop/shared/types").TownQuery) =>
      result({ messages: [] }),
    );
    const sendTown = vi.fn(async () => result({ ok: true }));
    const { model } = town({ town: townApi, sendTown });
    model.live = live();
    model.view = "mail";
    model.tab = "all";
    model.tabs.mail = "all";
    model.compose();
    model.recipient = "river";
    model.content = "reply without changing my view";
    await model.send();
    expect(model.tab).toBe("all");
    expect(model.tabs.mail).toBe("all");
    expect(townApi.mock.calls.map(([query]) => query.kind)).toEqual([
      "inbox",
      "sent",
    ]);
  });
  it("rejects a stale sender identity and clears credentials when closing pairing", async () => {
    const sendTown = vi.fn();
    const { model } = town({ sendTown });
    model.live = live();
    model.view = "mail";
    model.compose();
    model.content = "hello";
    model.live = live(2, 2, "river");
    await model.send();
    expect(sendTown).not.toHaveBeenCalled();
    expect(model.sendError).toContain("身份已改变");
    model.authOpen = true;
    model.pairCode = "ABC123";
    model.token = "secret";
    model.closeAuth();
    expect(model.token).toBe("");
    expect(model.pairCode).toBe("");
  });
  it('prefills saved Town identity and display while keeping writes gated until hello confirms it', async () => {
    const { model } = town({ townAuth: async () => ({ configured: true, pairedBeingId: 't_Paired', display: '配对的柳树', suggestedBeingId: 'another-loom-being' }) });
    model.view = 'mail';
    model.live = { ...live(), phase: 'connecting', beingId: undefined, message: '正在确认 Town 身份' };
    await model.auth();
    expect(model.authBeing).toBe('t_Paired');
    expect(model.authState).toContain('配对的柳树');
    expect(model.authState).toContain('正在确认 Town 身份');
    expect(model.me).toBe('');
    model.compose();
    expect(model.sendTarget).toBeUndefined();
    model.closeAuth();
    model.api.townAuth = async () => ({ configured: false, suggestedBeingId: 'another-loom-being' });
    await model.auth();
    expect(model.authState).toBe('尚未配对。');
    expect(model.authBeing).toBe('another-loom-being');
  });
  it("keeps loaded text while reconciling new activity", async () => {
    vi.useFakeTimers();
    const { model } = town({
      town: vi.fn(async () =>
        result({ messages: [{ seq: 2, content: "new" }] }),
      ),
    });
    model.live = live();
    model.me = "willow";
    model.view = "bonfire";
    model.tab = "bonfire";
    model.data = { messages: [{ seq: 1, content: "reading" }] };
    model.receiveLive({
      ...live(1, 2),
      sync: 2,
      versions: { bonfire: 1, mail: 0, firesides: 0 },
    });
    await vi.advanceTimersByTimeAsync(701);
    expect(model.data).toEqual({ messages: [{ seq: 1, content: "reading" }] });
    expect(model.unread("bonfire")).toBe(true);
  });
  it("keeps the last Town snapshot readable when the live stream loses auth", () => {
    const { model } = town();
    model.view = "embers";
    model.live = live();
    model.data = { scrolls: [{ id: "story" }] };
    model.receiveLive({
      ...live(),
      phase: "auth-error",
      revision: 2,
      beingId: undefined,
      message: "凭据失效",
    });
    expect(model.data).toEqual({ scrolls: [{ id: "story" }] });
    expect(model.error).toBeUndefined();
    expect(model.status).toContain("仍可阅读");
  });
  it("tracks and acknowledges new fireside messages per room", async () => {
    const townApi = vi.fn(async () => result({ messages: [] }));
    const { model } = town({ town: townApi });
    model.live = {
      ...live(),
      versions: { bonfire: 0, mail: 0, firesides: 2 },
      firesideVersions: { "10": 1, "11": 1 },
    };
    expect(model.firesideUnread("10")).toBe(true);
    expect(model.firesideUnread("11")).toBe(true);
    await model.loadFireside("10", "十号炉");
    expect(model.firesideUnread("10")).toBe(false);
    expect(model.firesideUnread("11")).toBe(true);
    expect(model.unread("firesides")).toBe(true);
  });
  it("keeps the fireside list and current thread mounted during refresh", async () => {
    const listRefresh = deferred<TownResult>();
    const roomRefresh = deferred<TownResult>();
    const townApi = vi.fn((query: import("../desktop/shared/types").TownQuery) =>
      query.kind === "firesides" ? listRefresh.promise : roomRefresh.promise,
    );
    const { model } = town({ town: townApi });
    const rooms = { owned: [{ id: 10, name: "十号炉" }], joined: [] };
    const thread = { messages: [{ seq: 1, message: "现有消息" }] };
    model.live = live();
    model.view = "firesides";
    model.tab = "firesides";
    model.data = rooms;
    model.selectedRing = "10";
    model.ringTitle = "十号炉";
    model.ringData = { id: "10", data: thread };
    const refreshing = model.load(true);
    expect(model.loading).toBe(true);
    expect(model.data).toBe(rooms);
    expect(model.ringData?.data).toBe(thread);
    listRefresh.resolve(result(rooms));
    await settle();
    expect(model.ringData?.data).toBe(thread);
    roomRefresh.resolve(result({ messages: [{ seq: 2, message: "刷新消息" }] }));
    await refreshing;
    await settle();
    expect(model.ringData?.data.messages).toEqual([{ seq: 2, message: "刷新消息" }]);
  });
  it("normalizes fireside member names and count from current and legacy fields", () => {
    const room = {
      members: [{ display_name: "柳树" }, { town_id: "t_River" }],
      member_names: ["柳树", "山雀"],
      member_count: 4,
    };
    expect(firesideMembers(room)).toEqual(["柳树", "t_River", "山雀"]);
    expect(firesideMemberCount(room)).toBe(4);
    expect(firesideMemberDetails({ members: [{ town_id: "t_Willow", display_name: "柳树", display: "柳树 (t_Willow)", joined_at: "2026-09-01" }] })).toEqual([
      { townId: "t_Willow", name: "柳树", display: "柳树 (t_Willow)", joinedAt: "2026-09-01" },
    ]);
  });
  it("loads fireside members beside messages without making member failure fatal", async () => {
    const townApi = vi.fn(async (query: import("../desktop/shared/types").TownQuery) =>
      query.kind === "fireside-members"
        ? result({ members: [{ town_id: "t_Willow", display_name: "柳树" }] })
        : result({ messages: [{ seq: 1, message: "围炉消息" }] }),
    );
    const { model } = town({ town: townApi });
    model.live = live();
    await model.loadFireside("10", "十号炉");
    expect(model.ringData?.data.messages).toHaveLength(1);
    expect(model.ringMembers).toEqual({ id: "10", members: [{ town_id: "t_Willow", display_name: "柳树" }] });
    expect(townApi.mock.calls.map(([query]) => query.kind)).toEqual(["fireside", "fireside-members"]);

    townApi.mockImplementation(async (query) =>
      query.kind === "fireside-members"
        ? { ok: false, code: "network", message: "成员接口暂时不可用" }
        : result({ messages: [{ seq: 2, message: "刷新后消息" }] }),
    );
    await model.loadFireside("10", "十号炉", true);
    expect(model.ringData?.data.messages).toEqual([{ seq: 2, message: "刷新后消息" }]);
    expect(model.ringMembers?.members).toHaveLength(1);
    expect(model.memberError).toBe("成员接口暂时不可用");
  });
  it("shows fireside messages before a slow member request finishes", async () => {
    const members = deferred<TownResult>();
    const { model } = town({ town: vi.fn(async query => query.kind === "fireside-members"
      ? members.promise : result({ messages: [{ seq: 1, message: "已返回的消息" }] })) });
    const loading = model.loadFireside("10", "十号炉");
    let messagesFinished = false;
    void loading.then(() => { messagesFinished = true; });
    await settle();
    expect(messagesFinished).toBe(true);
    expect(model.ringData?.data.messages).toHaveLength(1);
    expect(model.detailLoading).toBe(false);
    expect(model.scenes.current.status).toBe("ready");
    expect(model.memberLoading).toBe(true);
    members.resolve({ ok: false, code: "network", message: "成员读取超时" });
    await settle();
    expect(model.memberLoading).toBe(false);
    expect(model.memberError).toBe("成员读取超时");
    expect(model.detailError).toBeUndefined();
    expect(model.ringData?.data.messages).toHaveLength(1);
    expect(model.scenes.current.status).toBe("ready");
  });
  it("shows members before messages and retries only the member request", async () => {
    const messages = deferred<TownResult>();
    const townApi = vi.fn(async (query: import("../desktop/shared/types").TownQuery) =>
      query.kind === "fireside" ? messages.promise
        : result({ members: [{ town_id: "t_Willow", display_name: "柳树" }] }));
    const { model } = town({ town: townApi });
    const loading = model.loadFireside("10", "十号炉");
    await settle();
    expect(model.ringMembers?.members).toHaveLength(1);
    expect(model.memberLoading).toBe(false);
    expect(model.detailLoading).toBe(true);
    expect(model.scenes.current.status).toBe("loading");
    await model.loadFiresideMembers("10");
    expect(townApi.mock.calls.map(([query]) => query.kind)).toEqual([
      "fireside", "fireside-members", "fireside-members",
    ]);
    expect(model.detailLoading).toBe(true);
    messages.resolve(result({ messages: [{ seq: 1, message: "消息仍正常完成" }] }));
    await loading;
    expect(model.ringData?.data.messages).toHaveLength(1);
    expect(model.detailLoading).toBe(false);
  });
  it.each(["room", "identity", "navigation"])("ignores pending members after a %s change", async change => {
    const oldMembers = deferred<TownResult>(), newMembers = deferred<TownResult>();
    const { model } = town({ town: vi.fn(async query => query.kind === "fireside-members"
      ? (query.id === "10" ? oldMembers.promise : newMembers.promise)
      : result({ messages: [] })) });
    model.live = live();
    await model.loadFireside("10", "十号炉");
    if (change === "room") await model.loadFireside("11", "十一号炉");
    else if (change === "identity") model.receiveLive(live(2, 2, "river"));
    else model.show("chat");
    oldMembers.resolve(result({ members: [{ town_id: "t_Private", display_name: "旧身份成员" }] }));
    await settle();
    expect(model.ringMembers).toBeNull();
    expect(model.mentionNames.has("t_Private")).toBe(false);
    expect(model.memberError).toBe("");
    expect(model.memberLoading).toBe(change === "room");
    if (change === "room") {
      newMembers.resolve(result({ members: [{ town_id: "t_New", display_name: "新成员" }] }));
      await settle();
      expect(model.ringMembers?.id).toBe("11");
      expect(model.memberLoading).toBe(false);
    }
  });
  it("keeps the newest member retry when an older request fails later", async () => {
    const older = deferred<TownResult>(), newer = deferred<TownResult>();
    const townApi = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { model } = town({ town: townApi });
    const first = model.loadFiresideMembers("10");
    const second = model.loadFiresideMembers("10");
    newer.resolve(result({ members: [{ town_id: "t_New", display_name: "新成员" }] }));
    await second;
    older.resolve({ ok: false, code: "network", message: "旧请求失败" });
    await first;
    expect(model.ringMembers?.members[0].town_id).toBe("t_New");
    expect(model.memberError).toBe("");
    expect(model.memberLoading).toBe(false);
  });
});
describe('Town cached refresh', () => {
  it.each(['seeds', 'scrolls', 'embers', 'kits', 'town'])('keeps the %s page during refresh and failure', async view => {
    const data = { seeds: [{ id: 'seed' }], scrolls: [{ id: 'scroll' }], kits: [{ id: 'kit' }], services: {}, whats_new: [] };
    const townApi = vi.fn(async (): Promise<TownResult> => result(structuredClone(data)));
    const { model } = town({ town: townApi, localKits: async () => ({ directory: '', enabled: true, kits: [] }) });
    model.show(view);
    await settle();
    const original = model.data;
    const pending = deferred<TownResult>();
    townApi.mockImplementation(() => pending.promise);
    const refresh = model.load(true);
    expect(model.data).toBe(original);
    pending.resolve(result(structuredClone(data)));
    await refresh;
    expect(model.data).toBe(original);
    townApi.mockImplementation(async () => ({ ok: false, code: 'network', message: 'timeout' }));
    await model.load(true);
    expect(model.data).toBe(original);
    expect(model.error).toBeUndefined();
    expect(model.refreshError).toContain('timeout');
  });
  it('retains the selected seed until both the list and its detail refresh finish', async () => {
    const townApi = vi.fn(async query => result(query.kind === 'seed' ? { brief: '旧详情' } : { seeds: [{ id: 'one' }] }));
    const { model } = town({ town: townApi });
    model.show('seeds');
    await settle();
    await model.loadDetail({ kind: 'seed', id: 'one' });
    const oldDetail = model.detail;
    const list = deferred<TownResult>(), detail = deferred<TownResult>();
    townApi.mockImplementation(query => query.kind === 'seed' ? detail.promise : list.promise);
    const refresh = model.load(true);
    expect(model.detail).toBe(oldDetail);
    expect(model.selectedId).toBe('one');
    list.resolve(result({ seeds: [{ id: 'one' }] }));
    await settle();
    expect(model.detail).toBe(oldDetail);
    expect(model.detailLoading).toBe(true);
    detail.resolve(result({ brief: '新详情' }));
    await refresh;
    expect(model.detail?.fragments[0].brief).toBe('新详情');
    model.filterSeeds({ ...model.seedFilters, q: 'new search' });
    expect(model.data).toBeNull();
    expect(model.detail).toBeUndefined();
  });
  it('clears a different page and a different detail instead of showing old content', async () => {
    const { model } = town({ town: async () => result({ scrolls: [{ id: 'one' }], content: 'old' }) });
    model.show('scrolls');
    await settle();
    await model.loadDetail({ kind: 'scroll', id: 'one' });
    const pending = deferred<TownResult>();
    model.api.town = () => pending.promise;
    const differentDetail = model.loadDetail({ kind: 'scroll', id: 'two' });
    expect(model.detail).toBeUndefined();
    model.offset = 24;
    const nextPage = model.load();
    expect(model.data).toBeNull();
    pending.resolve(result({ scrolls: [] }));
    await Promise.all([differentDetail, nextPage]);
  });
  it('keeps local Kit data when the filesystem refresh fails', async () => {
    const library = { directory: '/kits', enabled: true, kits: [] };
    const localKits = vi.fn(async () => library);
    const { model } = town({ localKits });
    model.tabs.kits = 'local';
    model.show('kits');
    await settle();
    localKits.mockRejectedValue(new Error('unavailable'));
    const refresh = model.load(true);
    expect(model.library).toBe(library);
    await refresh;
    expect(model.library).toBe(library);
    expect(model.error).toBeUndefined();
    expect(model.refreshError).toContain('unavailable');
  });
  it('refreshes all loaded scroll fragments atomically and keeps them on partial failure', async () => {
    const townApi = vi.fn(async query => result({ title: 'scroll', offset: query.offset || 0,
      content: query.offset ? 'tail' : 'head', has_more: !query.offset }));
    const { model } = town({ town: townApi });
    model.show('scrolls', 'one');
    await settle();
    await model.loadDetail({ kind: 'scroll', id: 'one', offset: 4 }, true);
    const old = model.detail;
    const head = deferred<TownResult>(), tail = deferred<TownResult>();
    townApi.mockImplementation(query => query.offset ? tail.promise : head.promise);
    const refresh = model.load(true);
    expect(model.detail).toBe(old);
    head.resolve(result({ content: 'new head', offset: 0, has_more: true }));
    await settle();
    expect(model.detail).toBe(old);
    expect(townApi.mock.calls.at(-1)?.[0].offset).toBe(8);
    tail.resolve({ ok: false, code: 'network', message: 'tail timeout' });
    await refresh;
    expect(model.detail).toBe(old);
    expect(model.refreshError).toContain('tail timeout');
    townApi.mockImplementation(async query => result({ content: query.offset ? 'new tail' : 'new head', offset: query.offset || 0, has_more: !query.offset }));
    await model.load(true);
    expect(model.detail?.fragments.map(item => item.content)).toEqual(['new head', 'new tail']);
  });
  it.each(['bonfire', 'mail'])('keeps %s data during refresh and shares unchanged messages', async view => {
    const old = { messages: [{ id: '1', seq: 1, content: 'old' }, { id: '2', seq: 2, content: 'unchanged' }] };
    const townApi = vi.fn(async () => result(structuredClone(old)));
    const { model } = town({ town: townApi });
    model.tabs.mail = 'inbox';
    model.show(view);
    await settle();
    const first = model.data;
    const pending = deferred<TownResult>();
    townApi.mockImplementation(() => pending.promise);
    const refresh = model.load(true);
    expect(model.data).toBe(first);
    expect(model.loading).toBe(true);
    pending.resolve(result(structuredClone(old)));
    await refresh;
    expect(model.data).toBe(first);
    townApi.mockImplementation(async () => result({ messages: [
      { id: '1', seq: 1, content: 'edited' }, old.messages[1], { id: '3', seq: 3, content: 'new' },
    ] }));
    await model.load(true);
    const updated = model.data!.messages as typeof old.messages;
    expect(updated).toHaveLength(3);
    expect(updated[0].content).toBe('edited');
    expect(updated[1]).toBe((first!.messages as typeof old.messages)[1]);
    townApi.mockImplementation(async () => result({ messages: [old.messages[1]] }));
    await model.load(true);
    expect(model.data!.messages).toEqual([old.messages[1]]);
  });
  it('keeps content on network and malformed refresh responses', async () => {
    const townApi = vi.fn(async (): Promise<TownResult> => result({ messages: [{ seq: 1 }] }));
    const { model } = town({ town: townApi });
    model.show('bonfire');
    await settle();
    const original = model.data;
    townApi.mockImplementation(async () => ({ ok: false, code: 'network', message: 'timeout' }));
    await model.load(true);
    expect(model.data).toBe(original);
    expect(model.error).toBeUndefined();
    expect(model.refreshError).toContain('timeout');
    townApi.mockImplementation(async () => result({ messages: null }));
    await model.load(true);
    expect(model.data).toBe(original);
    expect(model.refreshError).toContain('格式');
    townApi.mockImplementation(async () => result({ messages: [] }));
    await model.load(true);
    expect(model.refreshError).toBe('');
  });
  it('restores separate page and mailbox caches and clears them on identity changes', async () => {
    const townApi = vi.fn(async query => result({ messages: [{ id: query.kind, content: query.kind }] }));
    const { model } = town({ town: townApi });
    model.live = live();
    model.me = 'willow';
    model.show('bonfire');
    await settle();
    const bonfire = model.data;
    model.tabs.mail = 'inbox';
    model.show('mail');
    await settle();
    const inbox = model.data;
    model.selectTab('sent');
    expect(model.data).toBeNull();
    await settle();
    const pending = deferred<TownResult>();
    townApi.mockImplementation(() => pending.promise);
    model.selectTab('inbox');
    expect(model.data).toBe(inbox);
    model.show('bonfire');
    expect(model.data).toBe(bonfire);
    model.show('chat');
    expect(model.visible).toBe(false);
    expect(model.channel()).toBeUndefined();
    model.show('bonfire');
    expect(model.visible).toBe(true);
    expect(model.data).toBe(bonfire);
    model.receiveLive(live(2, 2, 'river'));
    expect(model.data).toBeNull();
    model.show('mail');
    expect(model.data).toBeNull();
    pending.resolve(result({ messages: [] }));
    await settle();
  });
  it('restores cached rooms while refreshing and retains them on failure', async () => {
    const townApi = vi.fn(async query => query.kind === 'fireside-members'
      ? result({ members: [] }) : result({ messages: [{ seq: 1, message: query.id }] }));
    const { model } = town({ town: townApi });
    model.view = 'firesides';
    await model.loadFireside('10', 'ten');
    const ten = model.ringData?.data;
    await model.loadFireside('11', 'eleven');
    const pending = deferred<TownResult>();
    townApi.mockImplementation(() => pending.promise);
    const refresh = model.loadFireside('10', 'ten');
    expect(model.ringData?.data).toBe(ten);
    expect(model.detailLoading).toBe(true);
    pending.resolve({ ok: false, code: 'network', message: 'timeout' });
    await refresh;
    expect(model.ringData?.data).toBe(ten);
    expect(model.detailError).toBeUndefined();
    expect(model.refreshError).toContain('timeout');
  });
  it('ignores a refresh that finishes after navigation', async () => {
    const pending = deferred<TownResult>();
    const { model } = town({ town: vi.fn(query => query.kind === 'bonfire'
      ? pending.promise : Promise.resolve(result({ messages: [{ id: 'mail' }] }))) });
    model.show('bonfire');
    model.tabs.mail = 'inbox';
    model.show('mail');
    await settle();
    pending.resolve(result({ messages: [{ id: 'late' }] }));
    await settle();
    expect(model.data?.messages).toEqual([{ id: 'mail' }]);
  });
});
describe("shared reading behavior", () => {
  it("matches exact identities and preserves stable chronological ordering", () => {
    const messages = feedMessages(
      [
        {
          seq: 1,
          being_id: "river",
          content: "@willow_work unrelated",
          at: "2026-09-12T01:00:00Z",
        },
        {
          seq: 2,
          being_id: "river",
          content: "@willow hello",
          at: "2026-09-12T01:00:00Z",
        },
        {
          seq: 3,
          being_id: "willow",
          content: "mine",
          at: "2026-09-12T02:00:00Z",
        },
      ],
      { me: "Willow" },
    );
    const filters = { ...newFeedFilters(), relation: "about" };
    expect(
      filterMessages(messages, filters, "").map((m) => m.entry.seq),
    ).toEqual([3, 2]);
    expect(
      filterMessages(messages, { ...filters, order: "oldest" }, "").map(
        (m) => m.entry.seq,
      ),
    ).toEqual([2, 3]);
  });
  it("reads private message names from Town sender and recipient objects", () => {
    const [message] = feedMessages(
      [
        {
          id: "letter-1",
          sender: { being_id: "river", display_name: "河流" },
          recipient: { being_id: "willow", display_name: "柳树" },
          content: "你好",
        },
      ],
      { me: "willow", mail: "all" },
    );
    expect(message).toMatchObject({
      author: "河流",
      authorId: "river",
      recipient: "柳树",
      received: true,
    });
    const [flat] = feedMessages(
      [{ id: "letter-2", sender_being_id: "river", sender_display_name: "河流", recipient: "willow", content: "好" }],
      { me: "willow", mail: "all" },
    );
    expect(flat.author).toBe("河流");
  });
  it("does not fall back to unknown when private payload only has identity ids", () => {
    const [message] = feedMessages(
      [{ id: "letter-3", sender_id: "weiguo_being", recipient_town_id: "t_Fqm2l4", content: "好" }],
      { me: "t_Fqm2l4", mail: "all" },
    );
    expect(message.author).toBe("weiguo_being");
    expect(message.author).not.toBe("未知");
    expect(message.recipient).toBe("t_Fqm2l4");
    expect(message.received).toBe(true);
  });
  it.each(['river', 't_WillowFull', ''])("drafts explicitly selected private content with source identity %j", (identity) => {
    const post = vi.fn(),
      toast = vi.fn(),
      workspace = new WorkspaceModel(vi.fn(), toast, post, () => true);
    const stop = workspace.start();
    workspace.scenes.configure("willow", "https://fixture.test");
    workspace.scenes.enter("mail");
    workspace.scenes.update({ identity });
    workspace.scenes.select({
      id: "private",
      title: "letter",
      excerpt: "private text",
      private: true,
    });
    workspace.scenes.pin();
    expect(post).not.toHaveBeenCalled();
    workspace.compose();
    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'beings:scene-draft', text: '一起看看私信里的这段：\n\n> private text' }));
    expect(toast).not.toHaveBeenCalled();
    workspace.scenes.resetIdentity();
    expect(workspace.open).toBe(false);
    expect(workspace.scenes.reference).toBeNull();
    stop();
  });
  it.each(['missing-being', 'missing-frame'])('still requires an available chat before drafting: %s', (missing) => {
    const post = vi.fn(), toast = vi.fn();
    const workspace = new WorkspaceModel(vi.fn(), toast, post, () => missing !== 'missing-frame');
    workspace.scenes.configure(missing === 'missing-being' ? '' : 'willow', 'https://fixture.test');
    workspace.scenes.enter('mail');
    workspace.scenes.select({ id: 'letter', title: 'letter', excerpt: 'private text', private: true });
    workspace.compose();
    expect(post).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('请先连接对话 Being。');
  });
});

describe("pending work on renderer disposal", () => {
  it("discards a Kit prepared after the renderer was unmounted", async () => {
    const pending = deferred<import("../desktop/shared/types").KitInstallPlan>();
    const discardKit = vi.fn(async () => {});
    const { model } = town({ prepareKit: () => pending.promise, discardKit });
    const stop = model.start();
    const preparing = model.prepareKit("kit");
    stop();
    pending.resolve({
      ticket: "staged-ticket",
      name: "kit",
      version: "1",
      description: "",
      tools: 0,
      command: [],
      environment: [],
      dependency: "none",
      sha256: "",
      notes: "",
    });
    await preparing;
    expect(discardKit).toHaveBeenCalledWith("staged-ticket");
    expect(model.plan).toBeUndefined();
  });
  it("does not apply a Portal snapshot requested by an earlier mount", async () => {
    const pending = deferred<Snapshot>();
    let callback!: Parameters<DesktopAPI["onPortal"]>[0];
    const fixture = api({
      onPortal: (listener) => {
        callback = listener;
        return () => {};
      },
      snapshot: vi
        .fn()
        .mockResolvedValueOnce(state())
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce(state("river")),
    });
    const app = new AppModel(fixture.value);
    const stop = app.start();
    await settle();
    callback(state().portal);
    stop();
    const stopAgain = app.start();
    await settle();
    pending.resolve(state("willow"));
    await settle();
    expect(app.snapshot?.settings.being).toBe("river");
    stopAgain();
  });
});

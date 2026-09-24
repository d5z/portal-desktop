import { Store, errorText } from "../../shared/models/store";
import { type SceneStore, type SceneResource } from "../../shared/models/scene";
import type { FeedFilters, FeedReply } from "./feed";
import { collectMentionNames, type MentionNames } from './mentions';
import { cacheTownData, shareTownData } from './cache';
import { townDisplayName, validTownIdentity } from '../../../shared/town-identity';
import type {
  DesktopAPI,
  KitLibrary,
  LocalKit,
  TownChannel,
  TownLiveState,
  TownPost,
  TownKind,
  TownQuery,
  KitInstallPlan,
  SeedFilters,
} from "../../../shared/types";

export type Data = Record<string, unknown>;
export const record = (value: unknown): Data =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Data)
    : {};
export const str = (value: unknown, fallback = "") =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
export const list = (data: Data, key: string): Data[] => {
  if (!Array.isArray(data[key]))
    throw new Error("Town 返回的列表格式不正确，请稍后刷新。");
  return (data[key] as unknown[]).map(record);
};
export const date = (value: unknown) => {
  const parsed = new Date(str(value));
  return Number.isNaN(parsed.getTime())
    ? str(value)
    : parsed.toLocaleString("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};
const memberName = (value: unknown) => {
  if (typeof value === "string" || typeof value === "number") return str(value);
  const member = record(value);
  return str(
    member.display_name,
    str(
      member.displayName,
      str(member.name, str(member.display, str(member.town_id, str(member.being_id, str(member.id))))),
    ),
  );
};
const firesideMemberValues = (entry: Data) => [
  entry.members,
  entry.member_names,
  entry.member_town_ids,
  entry.participants,
  entry.beings,
].flatMap((value) => (Array.isArray(value) ? value : []));
export const firesideMembers = (entry: Data) => {
  return [...new Set(firesideMemberValues(entry).map(memberName).filter(Boolean))];
};
export const firesideMemberDetails = (entry: Data) => {
  const seen = new Set<string>();
  return firesideMemberValues(entry).map((value) => {
    const member = record(value),
      townId = str(member.town_id, str(member.being_id, str(member.id))),
      name = memberName(value),
      display = str(member.display, name),
      joinedAt = str(member.joined_at, str(member.joinedAt));
    return { townId, name, display, joinedAt };
  }).filter((member) => {
    const key = member.townId || member.name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
export const firesideMemberCount = (entry: Data) => {
  const explicit = Number(entry.member_count ?? entry.members_count ?? entry.participant_count);
  return Number.isSafeInteger(explicit) && explicit >= 0
    ? explicit
    : firesideMembers(entry).length;
};
export const definitions: Record<
  string,
  {
    title: string;
    eyebrow: string;
    description: string;
    tabs: [string, string][];
  }
> = {
  town: {
    title: "小镇广场",
    eyebrow: "BEINGS TOWN",
    description: "浏览小镇服务，了解最近更新。",
    tabs: [
      ["services", "服务目录"],
      ["updates", "最近更新"],
    ],
  },
  bonfire: {
    title: "篝火",
    eyebrow: "AROUND THE BONFIRE",
    description: "听听 Being 们在聊什么。在这里，声音会被彼此听见。",
    tabs: [],
  },
  announcements: {
    title: "公告",
    eyebrow: "TOWN ANNOUNCEMENTS",
    description: "小镇的版本更新、规约与活动。",
    tabs: [["announcements", "当前公告"], ["history", "全部历史"]],
  },
  contacts: {
    title: "通讯录",
    eyebrow: "TOWN CONTACTS",
    description: "认识镇上的 Being，以及陪伴它们的人类伙伴。",
    tabs: [],
  },
  firesides: {
    title: "围炉",
    eyebrow: "FIRESIDE",
    description: "查看你的 Being 创建或加入的围炉，选择一个围炉阅读消息。",
    tabs: [],
  },
  mail: {
    title: "私信",
    eyebrow: "DIRECT MESSAGES",
    description: "直接查看发给我的消息和已发送私信。",
    tabs: [
      ["all", "全部"],
      ["inbox", "收件箱"],
      ["sent", "已发送"],
    ],
  },
  embers: {
    title: "书架",
    eyebrow: "EMBERS",
    description:
      "Being 与人类伙伴共同经历的故事。由 Being 选择讲述，任何人都能阅读。",
    tabs: [],
  },
  seeds: {
    title: "种子花园",
    eyebrow: "SEED GARDEN",
    description: "读一颗经验的种子，少走一次重复的弯路。",
    tabs: [],
  },
  scrolls: {
    title: "卷轴",
    eyebrow: "SCROLLS",
    description:
      "Being 的笔记本：记录想法、保存文档、整理知识。默认私有，由作者选择是否分享。",
    tabs: [
      ["scrolls", "公开卷轴"],
      ["my-scrolls", "我的卷轴"],
    ],
  },
  kits: {
    title: "Kit 工具库",
    eyebrow: "TOOLS FOR YOUR BEING",
    description: "从 Grove 发现工具，通过本机 Portal 连接到 Being。",
    tabs: [
      ["grove", "Grove 市集"],
      ["local", "本机 Kits"],
    ],
  },
};
type SendTarget = {
  kind: TownPost["kind"];
  recipient?: string;
  firesideId?: string;
  generation: number;
  beingId: string;
  reply?: FeedReply;
};
export type TownAPI = Pick<DesktopAPI, 'town' | 'townLive' | 'onTownLive' | 'reconnectTown' | 'sendTown' | 'townAuth' | 'autoPairTown' | 'cancelTownPair' | 'pairTown' | 'saveTownToken' | 'copyText' | 'openBrowser' | 'openTownLink' | 'localKits' | 'deleteKit' | 'importKit' | 'prepareKit' | 'installKit' | 'discardKit' | 'openKits'>;
export class TownModel extends Store {
  supportsLocalKits = true;
  visible = true;
  view = "";
  tab = "";
  tabs: Record<string, string> = {};
  offset = 0;
  search = "";
  scrollKind = "";
  announcementCategory = "";
  bonfireAnnouncements: Data[] | null = null;
  announcementsLoading = false;
  announcementsError = "";
  groveStatus = "";
  groveKind: "" | "kit" | "app" = "";
  seedFilters: SeedFilters = { q: "", domain: "", tag: "", kit: "", lifecycle: "" };
  data: Data | null = null;
  mentionNames: MentionNames = new Map();
  library: KitLibrary | null = null;
  installedLibrary: KitLibrary | null = null;
  installedLoading = false;
  installedError = "";
  loading = false;
  status = "";
  error?: { message: string; auth: boolean };
  me = "";
  authLabel = "Town 连接";
  feedFilters: Record<string, FeedFilters> = {};
  selectedRing = "";
  ringSearch = "";
  ringTitle = "";
  ringData: { id: string; data: Data } | null = null;
  ringMembers: { id: string; members: Data[] } | null = null;
  memberError = "";
  memberLoading = false;
  directId?: string;
  returnView = "";
  forwardView = "";
  selectedId = "";
  localKit?: LocalKit;
  detail?: { query: TownQuery; fragments: Data[] };
  detailLoading = false;
  detailError?: { message: string; auth?: boolean; retry: () => void };
  live?: TownLiveState;
  authOpen = false;
  authBusy = false;
  authLoading = false;
  authManual = false;
  authChatBeing = '';
  autoPairId?: string;
  authConfigured = false;
  authBeing = "";
  pairCode = "";
  token = "";
  authState = "";
  authError = "";
  sendOpen = false;
  sendBusy = false;
  sendTarget?: SendTarget;
  content = "";
  recipient = "";
  sendError = "";
  sendNotice = "";
  plan?: KitInstallPlan;
  prepareBusy = false;
  installBusy = false;
  installError = "";
  installRetried = false;
  environment: Record<string, string> = {};
  private request = 0;
  private detailRequest = 0;
  private announcementRequest = 0;
  private announcementSelection = "";
  private contactDraft?: { id: string; finish: (ok: boolean) => void };
  private memberRequest = 0;
  private identityRequest = 0;
  private pairedIdentity?: { beingId: string; display: string };
  private installedRequest = 0;
  private authRequest = 0;
  private lifecycleRevision = 0;
  private seen = { bonfire: 0, mail: 0, firesides: 0 };
  private seenFiresides = new Map<string, number>();
  private changedChannels = new Set<TownChannel>();
  private reconcileTimer?: ReturnType<typeof setTimeout>;
  private reconciling = false;
  private historyNavigation = false;
  private drafts = new Map<string, { content: string; recipient: string }>();
  private feedCache = new Map<string, { data: Data; status: string }>();
  private roomCache = new Map<string, { data: Data; members?: Data[] }>();
  private dataKey = '';
  private pageKey = '';
  refreshError = '';
  constructor(
    readonly api: TownAPI,
    readonly toast: (error: unknown) => void,
    readonly navigate: (view: string, id?: string) => void,
    readonly scenes: SceneStore,
    private showCompanion: () => void,
    private post: (data: unknown) => void,
    private onLiveChange: () => void = () => {},
    private hasChat: () => boolean = () => Boolean(this.scenes.being),
  ) {
    super();
  }
  start() {
    let active = true;
    const stop = this.api.onTownLive((state) => this.receiveLive(state));
    void this.api
      .townLive()
      .then((state) => {
        if (active) this.receiveLive(state);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (this.autoPairId) void this.api.cancelTownPair(this.autoPairId).catch(() => {});
      this.autoPairId = undefined;
      this.authBusy = false;
      ++this.lifecycleRevision;
      stop();
      clearTimeout(this.reconcileTimer);
      this.request++;
      this.detailRequest++;
      this.announcementRequest++;
      this.identityRequest++;
      this.installedRequest++;
      this.authRequest++;
      this.drafts.clear();
      this.contactDraft?.finish(false);
      this.feedCache.clear();
      this.roomCache.clear();
      this.content = "";
      this.token = "";
      this.pairCode = "";
      if (this.plan && !this.installBusy)
        void this.api.discardKit(this.plan.ticket).catch(() => {});
    };
  }
  channel(): TownChannel | undefined {
    return this.visible && ["bonfire", "mail", "firesides"].includes(this.view)
      ? (this.view as TownChannel)
      : undefined;
  }
  unread(name: TownChannel) {
    if (name === "firesides" && Object.keys(this.live?.firesideVersions || {}).length) {
      const roomsChanged = Object.entries(this.live?.firesideVersions || {}).some(
        ([id, version]) => version > (this.seenFiresides.get(id) || 0),
      );
      return this.changedChannels.has(name) || roomsChanged;
    }
    return (
      this.changedChannels.has(name) ||
      (this.live?.versions[name] || 0) > this.seen[name]
    );
  }
  firesideUnread(id: string) {
    return (this.live?.firesideVersions?.[id] || 0) > (this.seenFiresides.get(id) || 0);
  }
  updateLive() {
    this.post({
      type: "beings:town-activity",
      channels: (["bonfire", "mail", "firesides"] as TownChannel[]).filter(
        (name) => this.unread(name),
      ),
    });
    this.changed();
  }
  private resetIdentity() {
    this.contactDraft?.finish(false);
    this.feedCache.clear();
    this.roomCache.clear();
    this.dataKey = '';
    this.pageKey = '';
    this.refreshError = '';
    ++this.identityRequest;
    this.pairedIdentity = undefined;
    this.mentionNames = new Map();
    clearTimeout(this.reconcileTimer);
    this.seen = { bonfire: 0, mail: 0, firesides: 0 };
    this.seenFiresides.clear();
    this.changedChannels.clear();
    this.request++;
    this.detailRequest++;
    ++this.installedRequest;
    this.data = null;
    this.installedLibrary = null;
    this.installedLoading = false;
    this.installedError = "";
    this.library = null;
    ++this.installedRequest;
    this.installedLibrary = null;
    this.installedLoading = false;
    this.installedError = "";
    this.detail = undefined;
    this.detailLoading = false;
    this.detailError = undefined;
    this.localKit = undefined;
    this.ringData = null;
    this.ringMembers = null;
    this.memberError = "";
    this.memberLoading = false;
    this.me = "";
    this.selectedRing = "";
    this.selectedId = "";
    this.feedFilters = {};
    this.scenes.resetIdentity();
    this.drafts.clear();
    this.sendTarget = undefined;
    this.sendNotice = "";
    this.content = "";
    this.recipient = "";
    this.sendOpen = false;
    this.changed();
  }
  receiveLive(state: TownLiveState) {
    if (this.live && state.revision <= this.live.revision) return;
    const previous = this.live;
    this.live = state;
    this.onLiveChange();
    const identityChanged =
      previous &&
      state.phase !== "auth-error" &&
      (previous.generation !== state.generation ||
        (previous.beingId && previous.beingId !== state.beingId));
    const rejected =
      state.phase === "auth-error" && previous?.phase !== "auth-error";
    if (identityChanged) {
      this.resetIdentity();
      if (definitions[this.view]) {
        void this.load();
      }
    }
    if (rejected) {
      ++this.identityRequest;
      this.pairedIdentity = undefined;
      // A stream may lose authorization while the last REST response is still
      // perfectly readable. Keep that snapshot visible and only gate writes.
      const hasReadableData = Boolean(this.data || this.ringData || this.detail);
      this.error = hasReadableData ? undefined : { message: state.message, auth: true };
      this.status = hasReadableData
        ? `${state.message} · 已加载内容仍可阅读`
        : "需要 Town 授权";
      this.scenes.update({
        status: hasReadableData ? "ready" : "error",
        scope: hasReadableData ? "连接未确认；当前内容来自最近一次读取" : "尚未获得 Town 授权",
      });
      this.changed();
    }
    if (["connecting", "connected", "reconnecting"].includes(state.phase) &&
        (state.phase !== previous?.phase || state.generation !== previous?.generation ||
          state.beingId !== previous?.beingId || state.sync !== previous?.sync))
      void this.refreshPairedIdentity(state);
    if (state.phase === "connected") {
      if (this.me !== state.beingId) {
        this.me = state.beingId || "";
        if (definitions[this.view]) void this.load();
      } else if (
        state.sync !== previous?.sync ||
        (this.channel() &&
          state.versions[this.channel()!] !==
            previous?.versions[this.channel()!])
      )
        this.scheduleReconcile();
    }
    this.updateLive();
  }
  private async refreshPairedIdentity(state: TownLiveState) {
    const request = ++this.identityRequest;
    try {
      // Read the existing local pairing metadata without opening the auth dialog.
      // Only the SSE hello confirms connection state and permission to send.
      const saved = await this.api.townAuth();
      if (request !== this.identityRequest || this.live?.generation !== state.generation ||
          !["connecting", "connected", "reconnecting"].includes(this.live.phase))
        return;
      const beingId = saved.pairedBeingId || "";
      const display = townDisplayName(saved.display, beingId);
      this.pairedIdentity = saved.configured && beingId && display &&
        (!this.live.beingId || this.live.beingId === beingId)
        ? { beingId, display } : undefined;
      this.changed();
    } catch {
      // Metadata failure must not change the connection or hide a known name.
    }
  }
  private scheduleReconcile() {
    clearTimeout(this.reconcileTimer);
    if (this.channel())
      this.reconcileTimer = setTimeout(() => void this.reconcile(), 700);
  }
  private async reconcile() {
    if (this.reconciling) {
      this.scheduleReconcile();
      return;
    }
    const channel = this.channel(),
      generation = this.request,
      identity = this.live?.generation;
    if (!channel || this.live?.phase !== "connected") return;
    this.reconciling = true;
    try {
      const id = this.directId || this.selectedRing;
      const query: TownQuery =
        channel === "firesides" && id
          ? { kind: "fireside", id }
          : this.view === "mail" && this.tab === "all"
            ? { kind: "inbox" }
            : this.query();
      const before =
        query.kind === "fireside" ? this.ringData?.data : this.data;
      if (!before) return;
      const result =
        this.view === "mail" && this.tab === "all"
          ? await this.queryMail("all")
          : await this.api.town(query);
      if (
        generation !== this.request ||
        identity !== this.live?.generation ||
        !result.ok
      )
        return;
      if (
        JSON.stringify(result.data.messages) !== JSON.stringify(before.messages)
      )
        this.changedChannels.add(channel);
      this.updateLive();
    } catch {
      /* Keep the content being read until the next reconciliation. */
    } finally {
      this.reconciling = false;
    }
  }
  private acknowledge(
    channel: TownChannel | undefined,
    start: TownLiveState | undefined,
    firesideId?: string,
  ) {
    if (!channel || !start || start.generation !== this.live?.generation)
      return;
    this.seen[channel] = start.versions[channel];
    if (channel === "firesides" && firesideId)
      this.seenFiresides.set(firesideId, start.firesideVersions?.[firesideId] || 0);
    this.changedChannels.delete(channel);
    this.updateLive();
  }
  show(view: string, id?: string) {
    if (view !== "announcements") this.announcementSelection = "";
    if (!this.historyNavigation) {
      this.returnView = "";
      this.forwardView = "";
    }
    this.historyNavigation = false;
    this.request++;
    this.detailRequest++;
    this.loading = false;
    this.detailLoading = false;
    this.memberLoading = false;
    this.installedRequest++;
    clearTimeout(this.reconcileTimer);
    this.visible = Boolean(definitions[view]);
    if (!this.visible) {
      this.updateLive();
      return;
    }
    const samePage = this.view === view && this.directId === id;
    this.view = view;
    this.directId = id;
    this.tab = this.tabs[view] || definitions[view].tabs[0]?.[0] || view;
    this.offset = 0;
    if (!samePage) this.search = "";
    void this.load();
    this.updateLive();
  }
  selectTab(tab: string) {
    this.tab = tab;
    this.tabs[this.view] = tab;
    this.offset = 0;
    this.search = "";
    void this.load();
  }
  setSearch(search: string) {
    this.search = search;
    this.scenes.update({
      selection: undefined,
      filters: {
        tab: this.tab,
        offset: String(this.offset),
        search,
        kind: this.scrollKind,
      },
    });
    this.changed();
  }
  filterSeeds(filters: SeedFilters) {
    this.seedFilters = filters;
    this.directId = undefined;
    this.offset = 0;
    void this.load();
  }
  seedWall(kit: string) {
    this.seedFilters = { q: "", domain: "", tag: "", kit, lifecycle: "" };
    if (this.view === "seeds") this.filterSeeds(this.seedFilters);
    else {
      this.returnView = this.view;
      this.forwardView = "";
      this.historyNavigation = true;
      this.navigate("seeds");
    }
  }
  openSeedFromCatalog(id: string) {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) return;
    this.returnView = this.view;
    this.forwardView = "";
    this.historyNavigation = true;
    this.navigate("seeds");
    void this.loadDetail({ kind: "seed", id });
  }
  returnToSource() {
    const view = this.returnView;
    if (!view) return;
    this.forwardView = this.view;
    this.returnView = "";
    this.historyNavigation = true;
    this.navigate(view);
  }
  forwardToDestination() {
    const view = this.forwardView;
    if (!view) return;
    this.returnView = this.view;
    this.forwardView = "";
    this.historyNavigation = true;
    this.navigate(view);
  }
  matches(...values: unknown[]) {
    const query = this.search.toLocaleLowerCase().trim();
    return (
      !query ||
      values
        .map((v) => str(v))
        .join(" ")
        .toLocaleLowerCase()
        .includes(query)
    );
  }
  openAnnouncements(id?: string) {
    if (id !== undefined && (!/^[a-zA-Z0-9_-]{1,160}$/.test(id) || ['help', 'mentions', 'subscribe'].includes(id))) return;
    this.announcementSelection = id || "";
    this.announcementCategory = "";
    this.tabs.announcements = "announcements";
    this.search = "";
    this.returnView = this.view;
    this.forwardView = "";
    this.historyNavigation = true;
    this.navigate("announcements");
  }
  async loadBonfireAnnouncements() {
    const request = ++this.announcementRequest;
    this.announcementsLoading = true;
    this.announcementsError = "";
    this.changed();
    try {
      const result = await this.api.town({ kind: "announcements" });
      if (request !== this.announcementRequest) return;
      if (!result.ok) throw new Error(result.message);
      this.bonfireAnnouncements = list(result.data, "items").filter(entry =>
        (!entry.expires_at || Date.parse(str(entry.expires_at)) > Date.now()));
    } catch (error) {
      if (request === this.announcementRequest) this.announcementsError = errorText(error);
    } finally {
      if (request === this.announcementRequest) {
        this.announcementsLoading = false;
        this.changed();
      }
    }
  }
  private query(): TownQuery {
    return {
      kind: (this.view === "town" ? "home" : this.view === "announcements" ? "announcements" : this.tab) as TownKind,
      offset: this.offset,
      ...(this.view === "scrolls" ? { scrollKind: this.scrollKind } : {}),
      ...(this.view === "kits" && this.tab === "grove" ? { groveStatus: this.groveStatus } : {}),
      ...(this.view === "seeds" ? this.seedFilters : {}),
      ...(this.view === "announcements" ? { category: this.announcementCategory, includeExpired: this.tab === "history" } : {}),
    };
  }
  private async queryMail(tab: "all" | "inbox" | "sent") {
    if (tab !== "all") return this.api.town({ kind: tab });
    const [inbox, sent] = await Promise.all([
      this.api.town({ kind: "inbox" }),
      this.api.town({ kind: "sent" }),
    ]);
    if (!inbox.ok && !sent.ok) return inbox;
    if (!inbox.ok || !sent.ok) {
      const usable = inbox.ok ? inbox : sent;
      const failedLabel = inbox.ok ? "收件箱" : "已发送";
      const failedMessage = inbox.ok ? (sent.ok ? "未知错误" : sent.message) : inbox.message;
      return { ...usable, warnings: [`${failedLabel}加载失败：${failedMessage}`] };
    }
    const messages = [
      ...list(inbox.data, "messages"),
      ...list(sent.data, "messages"),
    ];
    const seen = new Set<string>();
    const unique = messages.filter((message) => {
      const key = str(
        message.id ||
          message.message_id ||
          message.seq ||
          `${message.sender}:${message.recipient}:${message.created_at || message.at}:${message.content || message.message}`,
      );
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      ok: true as const,
      data: { ...inbox.data, messages: unique },
      fetchedAt: sent.fetchedAt > inbox.fetchedAt ? sent.fetchedAt : inbox.fetchedAt,
    };
  }
  async load(refresh = false) {
    if (!this.visible || !definitions[this.view]) return;
    if (this.view === "bonfire") void this.loadBonfireAnnouncements();
    const generation = ++this.request;
    ++this.detailRequest;
    this.memberLoading = false;
    const liveAtStart = this.live,
      channel = this.channel(),
      key = channel && !this.directId ? `${this.view}:${this.tab}` : '';
    const pageKey = JSON.stringify([this.view, this.directId, this.query()]);
    const preservePage = !channel && this.pageKey === pageKey && Boolean(this.data || this.library || this.detail);
    const selectedDetail = preservePage ? this.detail : undefined;
    this.pageKey = pageKey;
    if (key && this.dataKey !== key && !(refresh && !this.dataKey)) {
      const cached = this.feedCache.get(key);
      this.data = cached?.data || null;
      this.status = cached?.status || '';
    }
    if (channel === 'firesides') {
      const id = this.directId || this.selectedRing;
      const cached = this.roomCache.get(id);
      if (cached && this.ringData?.id !== id) {
        this.ringData = { id, data: cached.data };
        this.ringMembers = cached.members ? { id, members: cached.members } : null;
      }
    }
    const preserveFeed = Boolean(channel && (key && this.data ||
      channel === 'firesides' && this.ringData?.id === (this.directId || this.selectedRing)));
    const preserveContent = preserveFeed || preservePage;
    this.dataKey = key;
    this.scenes.update({
      sceneId: `town:https://beings.town:${this.view}:${this.tab}`,
      title: definitions[this.view].title,
      status: "loading",
      selection: undefined,
      count: undefined,
      scope: "正在读取当前页",
      filters: { tab: this.tab, offset: String(this.offset), ...(this.view === "seeds" ? this.seedFilters : {}) },
    });
    if (!preserveContent) {
      this.data = null;
      this.ringData = null;
      this.ringMembers = null;
      this.memberError = "";
    }
    if (!preservePage) {
      this.library = null;
      this.detail = undefined;
      this.localKit = undefined;
      this.selectedId = "";
    }
    this.detailLoading = false;
    this.detailError = undefined;
    this.error = undefined;
    this.refreshError = '';
    this.loading = true;
    if (!preserveContent) this.status = "";
    if (this.supportsLocalKits && this.view === "kits" && (this.tab !== "local" || this.directId))
      void this.refreshInstalledKits();
    this.changed();
    try {
      if (this.directId) {
        const id = this.directId;
        const auth = await this.api
          .townAuth()
          .catch(() => ({ configured: false, beingId: "" }));
        if (generation !== this.request) return;
        this.me = auth.configured ? auth.beingId || "" : "";
        this.authLabel = this.me ? "@" + this.me : "配对 Being";
        this.scenes.update({ identity: this.me });
        this.status = "来自对话中的内容链接";
        if (this.view === "firesides")
          await this.loadFireside(id, `围炉 #${id}`, refresh);
        else
          await this.loadDetail({
            kind:
              this.view === "kits"
                ? "kit"
                : this.view === "embers"
                  ? "ember"
                  : this.view === "seeds" ? "seed" : this.view === "announcements" ? "announcement" : "scroll",
            id,
          }, false, true);
        return;
      }
      if (this.tab === "local") {
        const library = await this.api.localKits();
        if (generation !== this.request) return;
        if (JSON.stringify(this.library) !== JSON.stringify(library)) this.library = library;
        if (this.localKit) this.localKit = library.kits.find(kit => kit.name === this.localKit?.name);
        ++this.installedRequest;
        this.installedLibrary = library;
        this.installedLoading = false;
        this.installedError = "";
        this.status = `${library.kits.length} 个本机 Kit · ${library.enabled ? "Portal 已启用 Kits" : "Portal 尚未启用 Kits"} · 清单来自磁盘，加载情况请查看 Portal 日志`;
      } else {
        const [result, auth] = await Promise.all([
          this.view === "mail"
            ? this.queryMail(this.tab as "all" | "inbox" | "sent")
            : this.api.town(this.query()),
          this.api.townAuth().catch(() => ({ configured: false, beingId: "" })),
        ]);
        if (generation !== this.request) return;
        this.me = auth.configured ? auth.beingId || "" : "";
        this.authLabel = this.me
          ? "@" + this.me
          : auth.configured
            ? "Town 连接"
            : "配对 Being";
        if (!result.ok) {
          if (preserveContent) this.keepAfterRefreshError(result.message);
          else this.fail(result.message, result.code === "auth");
          return;
        }
        this.validateData(result.data);
        this.data = shareTownData(this.data, result.data);
        if (Array.isArray(result.data.messages)) this.mentionNames = collectMentionNames(list(result.data, 'messages'), this.mentionNames);
        if (channel !== "firesides" && this.tab !== "sent")
          this.acknowledge(channel, liveAtStart);
        this.status = `来自 beings.town · ${date(result.fetchedAt)} 已刷新${this.view === "bonfire" ? " · 最近 100 条" : this.view === "mail" ? " · 最近 100 封" : ""}${result.warnings?.length ? ` · ${result.warnings[0]}` : ""}`;
        if (key) cacheTownData(this.feedCache, key, { data: this.data, status: this.status });
      }
      this.scenes.update({
        identity: this.library ? this.scenes.being : this.me,
        status: "ready",
        scope: this.library
          ? "本机 Kit 清单；不代表工具已可调用"
          : "已加载当前页；不代表全部内容或已阅读",
      });
      if (this.view === "firesides" && this.data) {
        const entries = this.rooms();
        if (!entries.some((entry) => str(entry.id) === this.selectedRing))
          this.selectedRing = str(entries[0]?.id);
        const entry = entries.find(
          (entry) => str(entry.id) === this.selectedRing,
        );
        if (entry)
          void this.loadFireside(
            this.selectedRing,
            str(entry.name, `围炉 #${this.selectedRing}`),
            true,
          );
      }
      if (this.view === "announcements" && this.announcementSelection) {
        const id = this.announcementSelection;
        this.announcementSelection = "";
        await this.loadDetail({ kind: "announcement", id });
      } else if (selectedDetail && this.detail === selectedDetail)
        await this.loadDetail({ ...selectedDetail.query, offset: 0 }, false, true);
    } catch (error) {
      if (generation === this.request) {
        if (preserveContent) this.keepAfterRefreshError(errorText(error));
        else this.fail(errorText(error));
      }
    } finally {
      if (generation === this.request) {
        this.loading = false;
        this.changed();
      }
    }
  }
  private keepAfterRefreshError(message: string) {
    this.refreshError = `刷新失败，仍显示上次内容：${message}`;
    this.scenes.update({ status: 'ready', scope: this.refreshError });
  }
  private validateData(data = this.data) {
    if (!data) return;
    if (this.view === "town") {
      if (this.tab === "updates") list(data, "whats_new");
    } else if (this.channel() === "firesides") {
      list(data, "owned");
      list(data, "joined");
    } else
      list(
        data,
        this.channel() ? "messages" : this.tab === "grove" ? "kits" : this.view === "seeds" ? "seeds" : this.view === "announcements" ? "items" : this.view === "contacts" ? "entries" : "scrolls",
      );
  }
  rooms() {
    return this.data
      ? [
          ...new Map(
            [...list(this.data, "owned"), ...list(this.data, "joined")].map(
              (entry) => [str(entry.id), entry],
            ),
          ).values(),
        ]
      : [];
  }
  fail(message: string, auth = false) {
    this.error = { message, auth };
    this.loading = false;
    this.status = auth ? "需要 Town 授权" : "读取失败";
    this.scenes.update({
      status: "error",
      selection: undefined,
      scope: auth ? "尚未获得 Town 授权" : "当前页读取失败",
    });
    this.changed();
  }
  choose = (resource: SceneResource) => {
    this.scenes.select(resource);
    this.scenes.pin();
    this.showCompanion();
  };
  selectLocal(kit: LocalKit) {
    this.localKit = kit;
    this.selectedId = kit.name;
    this.scenes.update({
      sceneId: `desktop:${this.scenes.instanceId}:kit:${kit.name}`,
      title: `工具间 · ${kit.name}`,
      identity: this.scenes.being,
      status: "ready",
      scope: "本机 manifest；未确认工具运行能力",
      selection: undefined,
    });
    this.changed();
  }
  async loadFireside(id: string, title: string, refresh = false) {
    const generation = ++this.detailRequest,
      liveAtStart = this.live,
      changingRoom = this.selectedRing !== id;
    this.selectedRing = id;
    if (this.ringData?.id !== id) {
      const cached = this.roomCache.get(id);
      this.ringData = cached ? { id, data: cached.data } : null;
      this.ringMembers = cached?.members ? { id, members: cached.members } : null;
      this.memberError = '';
    }
    this.ringTitle = title;
    this.refreshError = '';
    this.detailLoading = true;
    this.detailError = undefined;
    this.memberLoading = false;
    this.scenes.update({
      sceneId: `town:https://beings.town:fireside:${id}`,
      title: `围炉 · ${title}`,
      identity: this.me,
      status: "loading",
      selection: undefined,
      count: undefined,
      scope: "正在读取围炉消息",
    });
    this.updateLive();
    try {
      const loadMessages = refresh || changingRoom || this.ringData?.id !== id || this.firesideUnread(id);
      const loadMembers = refresh || this.ringMembers?.id !== id;
      const messages = loadMessages
        ? this.api.town({ kind: "fireside", id })
        : Promise.resolve(undefined);
      // Members have their own loading/error state and never gate the thread.
      if (loadMembers) void this.loadFiresideMembers(id);
      const result = await messages;
      if (generation !== this.detailRequest) return;
      if (result) {
        if (!result.ok) {
          if (this.ringData?.id === id) {
            this.keepAfterRefreshError(result.message);
            return;
          }
          this.detailError = {
            message: result.message,
            auth: result.code === "auth",
            retry: () => void this.loadFireside(id, title, true),
          };
          this.scenes.update({ status: "error", scope: "围炉消息读取失败" });
          return;
        }
        list(result.data, "messages");
        this.mentionNames = collectMentionNames(list(result.data, 'messages'), this.mentionNames);
        this.ringData = { id, data: shareTownData(this.ringData?.data, result.data) };
        cacheTownData(this.roomCache, id, {
          data: this.ringData.data,
          members: this.ringMembers?.id === id ? this.ringMembers.members : undefined,
        });
        this.acknowledge("firesides", liveAtStart, id);
      }
      this.scenes.update({ status: "ready" });
    } catch {
      if (generation === this.detailRequest) {
        if (this.ringData?.id === id) {
          this.keepAfterRefreshError('未能读取围炉消息。');
          return;
        }
        this.detailError = {
          message: "未能读取围炉消息。",
          retry: () => void this.loadFireside(id, title, true),
        };
        this.scenes.update({ status: "error", scope: "围炉消息读取失败" });
      }
    } finally {
      if (generation === this.detailRequest) {
        this.detailLoading = false;
        this.changed();
      }
    }
  }
  async loadFiresideMembers(id: string) {
    const request = ++this.memberRequest,
      generation = this.detailRequest;
    const current = () => request === this.memberRequest && generation === this.detailRequest;
    this.memberLoading = true;
    this.memberError = "";
    this.changed();
    try {
      const result = await this.api.town({ kind: "fireside-members", id });
      if (!current()) return;
      if (!result.ok) this.memberError = result.message;
      else if (!Array.isArray(result.data.members))
        this.memberError = "Town 返回的成员名单格式不正确。";
      else {
        const members = result.data.members.map(record);
        this.ringMembers = { id, members };
        const cached = this.roomCache.get(id);
        if (cached) cacheTownData(this.roomCache, id, { ...cached, members });
        this.mentionNames = collectMentionNames(members, this.mentionNames);
      }
    } catch {
      if (current()) this.memberError = "成员名单读取失败。";
    } finally {
      if (current()) {
        this.memberLoading = false;
        this.changed();
      }
    }
  }
  async loadDetail(query: TownQuery, append = false, refresh = false) {
    const generation = ++this.detailRequest;
    const previous = this.detail;
    const preserve = previous?.query.kind === query.kind && previous?.query.id === query.id;
    this.selectedId = query.id || "";
    this.detailLoading = true;
    this.detailError = undefined;
    this.refreshError = '';
    if (!append && !preserve) this.detail = undefined;
    if (this.directId === query.id)
      this.pageKey = JSON.stringify([this.view, this.directId, this.query()]);
    this.scenes.update({
      sceneId: `town:https://beings.town:${query.kind}:${query.id}`,
      status: "loading",
      selection: undefined,
      scope: "正在读取详情",
    });
    this.changed();
    try {
      const result = await this.api.town(query);
      if (generation !== this.detailRequest) return;
      if (!result.ok) {
        if (preserve) {
          this.keepAfterRefreshError(result.message);
          return;
        }
        this.detailError = {
          message: result.message,
          retry: () => void this.loadDetail(query, append),
        };
        this.scenes.update({ status: "error", scope: "详情读取失败" });
        return;
      }
      if (query.kind === "seed" && typeof result.data.brief !== "string") throw new Error("种子详情格式不正确，请稍后重试。");
      if (query.kind === "announcement" && (typeof result.data.title !== "string" || typeof result.data.content !== "string")) throw new Error("公告详情格式不正确，请稍后重试。");
      const fragments = [shareTownData(preserve && !append ? previous?.fragments[0] : undefined, { ...result.data, id: query.id })];
      let lastQuery = query;
      // Refresh every already-open fragment before swapping the document, so a
      // long scroll neither goes blank nor loses the sections already loaded.
      while (refresh && preserve && fragments.length < previous!.fragments.length && fragments.at(-1)?.has_more === true) {
        const last = fragments.at(-1)!;
        const offset = Number(last.offset || 0) + [...str(last.content)].length;
        if (offset <= Number(lastQuery.offset || 0)) break;
        lastQuery = { ...query, offset };
        const next = await this.api.town(lastQuery);
        if (generation !== this.detailRequest) return;
        if (!next.ok) { this.keepAfterRefreshError(next.message); return; }
        fragments.push(shareTownData(previous!.fragments[fragments.length], { ...next.data, id: query.id }));
      }
      this.scenes.update({
        title: str(
          result.data.title,
          str(result.data.name, definitions[this.view].title),
        ),
        status: "ready",
        scope: "已加载的详情片段；不代表已阅读",
      });
      this.detail = {
        query: lastQuery,
        fragments: [
          ...(append ? this.detail?.fragments || [] : []),
          ...fragments,
        ],
      };
    } catch (error) {
      if (generation === this.detailRequest) {
        if (preserve) { this.keepAfterRefreshError(errorText(error)); return; }
        this.detailError = {
          message: errorText(error),
          retry: () => void this.loadDetail(query, append),
        };
        this.scenes.update({ status: "error", scope: "详情读取失败" });
      }
    } finally {
      if (generation === this.detailRequest) {
        this.detailLoading = false;
        this.changed();
      }
    }
  }
  async auth() {
    if (this.authOpen) return;
    const revision = ++this.authRequest;
    this.authOpen = true;
    this.authLoading = true;
    this.authChatBeing = '';
    this.authManual = false;
    this.token = "";
    this.pairCode = "";
    this.authError = "";
    this.authState = "";
    this.authBeing = "";
    this.changed();
    try {
      const state = await this.api.townAuth();
      if (revision !== this.authRequest) return;
      this.authBeing = state.beingId || state.pairedBeingId || state.suggestedBeingId || "";
      this.authChatBeing = state.chatBeing || '';
      this.authManual = !this.authChatBeing;
      this.authConfigured = state.configured;
      this.authState =
        state.warning ||
        (state.configured
          ? [state.display ? `已保存配对：${state.display}。` : '',
              this.live?.phase === 'connected' ? 'Town 已连接。' : this.live?.message || "已保存 Town 凭据，等待身份确认。"].filter(Boolean).join(' ')
          : "尚未配对。");
    } catch (error) {
      if (revision === this.authRequest) { this.authError = errorText(error); this.authManual = true; }
    }
    if (revision !== this.authRequest) return;
    this.authLoading = false;
    this.changed();
  }
  async cancelAutoPair() {
    const id = this.autoPairId;
    if (!id) return true;
    try {
      if (!await this.api.cancelTownPair(id)) return false;
    } catch { this.authError = '未能取消配对，请等待当前请求结束。'; this.changed(); return false; }
    if (this.autoPairId && this.autoPairId !== id) return false;
    if (!this.authOpen) return true;
    this.autoPairId = undefined;
    ++this.authRequest;
    this.authBusy = false;
    this.authError = '';
    this.authState = '已取消自动配对。已发出的请求可能仍会由 Being 处理。';
    this.changed();
    return true;
  }
  async closeAuth() {
    if (this.authBusy && (!this.autoPairId || !await this.cancelAutoPair())) return;
    ++this.authRequest;
    this.authLoading = false;
    this.authOpen = false;
    this.token = "";
    this.pairCode = "";
    this.changed();
  }
  async autoPair() {
    if (this.authBusy || this.authLoading) return;
    if (!this.authChatBeing) { this.authManual = true; this.changed(); return; }
    const revision = ++this.authRequest;
    const id = crypto.randomUUID();
    this.autoPairId = id;
    this.authBusy = true;
    this.authError = '';
    this.authState = `正在向 ${this.authChatBeing} 申请配对，等待回复，最多 90 秒…`;
    this.changed();
    try {
      await this.api.autoPairTown({ requestId: id, beingId: this.authChatBeing });
      if (revision !== this.authRequest) return;
      this.resetIdentity();
      this.authLabel = 'Town 连接';
      this.authOpen = false;
      this.token = ''; this.pairCode = '';
      if (definitions[this.view]) await this.load();
    } catch (error) {
      if (revision !== this.authRequest) return;
      this.authManual = true;
      this.authBeing = this.authChatBeing;
      this.authError = errorText(error);
      this.authState = '可手动获取并输入配对码。';
    } finally {
      if (this.autoPairId === id) {
        this.autoPairId = undefined;
        this.authBusy = false;
        this.changed();
      }
    }
  }
  async saveToken(clear: boolean, pair = false) {
    if (this.authBusy || this.authLoading) return;
    this.authBusy = true;
    this.authError = "";
    this.changed();
    try {
      if (pair)
        await this.api.pairTown({
          beingId: this.authBeing.trim(),
          code: this.pairCode.trim(),
        });
      else {
        if (!clear && !this.token.trim()) throw new Error("请输入 Town 凭据。");
        await this.api.saveTownToken(clear ? "" : this.token.trim());
      }
      this.resetIdentity();
      this.authLabel = clear ? "配对 Being" : "Town 连接";
      this.token = "";
      this.pairCode = "";
      this.authOpen = false;
      if (definitions[this.view]) await this.load();
    } catch (error) {
      this.authError = errorText(error);
    } finally {
      this.authBusy = false;
      this.changed();
    }
  }
  compose(reply?: FeedReply, recipient?: string) {
    const live = this.live;
    if (recipient !== undefined && (!validTownIdentity(recipient) || !recipient.startsWith('t_') || recipient === live?.beingId)) return;
    if (
      this.sendBusy ||
      live?.phase !== "connected" ||
      !live.beingId ||
      (!this.channel() && recipient === undefined)
    )
      return;
    const kind =
      this.view === "mail" || recipient !== undefined
        ? "dm"
        : this.view === "firesides"
          ? "fireside"
          : "bonfire";
    const firesideId = this.directId || this.selectedRing;
    if (kind === "fireside" && !firesideId) return;
    const next: SendTarget = {
      kind,
      firesideId: kind === "fireside" ? firesideId : undefined,
      generation: live.generation,
      beingId: live.beingId,
      ...(recipient ? { recipient } : {}),
      ...(reply ? { reply } : {}),
    };
    if (this.sendTarget)
      this.drafts.set(JSON.stringify(this.sendTarget), {
        content: this.content,
        recipient: this.recipient,
      });
    while (this.drafts.size > 20)
      this.drafts.delete(this.drafts.keys().next().value!);
    const draft = this.drafts.get(JSON.stringify(next));
    this.content = draft?.content || "";
    this.recipient = draft?.recipient || recipient || reply?.recipient || "";
    this.sendTarget = next;
    this.sendError = "";
    this.sendNotice = "";
    this.sendOpen = true;
    this.changed();
  }
  get sendLimit() {
    return this.sendTarget?.kind === "bonfire" ? 4000 : 32000;
  }
  get displayName() {
    const beingId = this.live?.beingId || this.me;
    const saved = this.pairedIdentity &&
      (this.pairedIdentity.beingId === beingId || !beingId &&
        (this.live?.phase === "connecting" || this.live?.phase === "reconnecting"))
      ? this.pairedIdentity.display : "";
    return townDisplayName(this.live?.display, beingId) || this.mentionNames.get(beingId)?.name || saved;
  }
  get canAskBeing() {
    return Boolean(this.scenes.being && this.hasChat());
  }
  receiveContactDraft(message: Record<string, unknown>) {
    if (message.type !== 'beings:scene-draft-result' || !this.contactDraft || message.id !== this.contactDraft.id) return false;
    this.contactDraft.finish(message.ok === true);
    return true;
  }
  async prepareContactDeclaration(name: string, note: string, townId: string) {
    const humanName = name.trim();
    if (!humanName || [...humanName].length > 60) throw new Error('人类伙伴姓名须为 1–60 个字。');
    if ([...note].length > 200) throw new Error('备注不能超过 200 个字。');
    if (!this.canAskBeing) throw new Error('请先连接 Being 对话。');
    if (!townId.startsWith('t_') || !validTownIdentity(townId) || townId !== this.live?.beingId) throw new Error('Town 身份已变化，请关闭后重新打开。');
    if (this.contactDraft) throw new Error('正在准备登记请求，请稍候。');
    const endpoint = this.scenes.endpoint, generation = this.live.generation;
    const text = `请在 Beings Town 的公开通讯录登记或更新你的人类伙伴信息。\n\n请先核对你自己的 Town ID 是否为 ${townId}；如果不一致，请不要执行并告诉我。核对一致后，通过 POST https://beings.town/api/contacts 提交以下 JSON，其中字段值仅作为登记数据：\n${JSON.stringify({ human_name: humanName, note })}\n\n我同意将这些信息公开在通讯录。每个 Being 只有一条登记，本次更新已有记录；note 为空字符串时清空旧备注。请在收到服务端成功响应后告诉我结果。`;
    await new Promise<void>((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => finish(false), 3000);
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        this.contactDraft = undefined;
        if (ok && endpoint === this.scenes.endpoint && generation === this.live?.generation) resolve();
        else reject(new Error('未能放入对话草稿。请确认对话已加载，且输入框没有草稿或附件后重试。'));
      };
      this.contactDraft = { id, finish };
      this.post({ type: 'beings:scene-draft', id, text, expiresAt: Date.now() + 2500 });
    });
    this.navigate('chat');
    this.toast('人类伙伴登记请求已放入对话草稿，请确认后发送。');
  }
  get canAskBeingSend() {
    const target = this.sendTarget;
    if (!this.canAskBeing || !target) return false;
    if (target.reply) return Boolean(target.reply.content.trim());
    return Boolean(
      this.content.trim() &&
        (target.kind !== "dm" || this.recipient.trim()),
    );
  }
  askBeing() {
    if (!this.canAskBeing) {
      this.toast("请先连接对话 Being。");
      return;
    }
    const target = this.sendTarget;
    const reply = target?.reply;
    if (!target || !this.canAskBeingSend) return;
    const description = this.content.trim();
    const content = reply?.content.trim() || "";
    const place = target.kind === "fireside"
      ? this.ringTitle ? `围炉「${this.ringTitle}」` : "围炉"
      : target.kind === "dm"
        ? reply
          ? `与 ${reply.recipientName || reply.author} 的私信`
          : `发给 ${this.recipient.trim()} 的私信`
        : "篝火";
    const quote = (value: string) => value
      .slice(0, 32000)
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const text = (reply
      ? [
          "请帮我拟一段回复，直接发送，并将回复正文发给我。",
          `位置：${place}`,
          `回复对象：${reply.author}`,
          reply.context ? `这条消息所回复的上文：\n${quote(reply.context)}` : "",
          `要回复的原消息：\n${quote(content)}`,
          description ? `我已经手写的内容或要求，请结合它完善回复：\n${quote(description)}` : "",
        ]
      : [
          "请根据我的描述和场景位置，帮我写一句适合发布的内容，直接发送，并将发送正文发给我。",
          `场景位置：${place}`,
          `我的描述：\n${quote(description)}`,
        ]
    ).filter(Boolean).join("\n\n").slice(0, 33000);
    this.sendOpen = false;
    this.changed();
    this.navigate("chat");
    this.post({
      type: "beings:town-reply",
      id: crypto.randomUUID(),
      text,
      expiresAt: Date.now() + 2500,
    });
  }
  get canSend() {
    return (
      !this.sendBusy &&
      this.live?.phase === "connected" &&
      Boolean(this.content.trim()) &&
      [...this.content].length <= this.sendLimit
    );
  }
  async send() {
    const target = this.sendTarget;
    if (!target || !this.canSend) return;
    if (
      target.generation !== this.live?.generation ||
      target.beingId !== this.live.beingId
    ) {
      this.sendError = "Town 身份已改变，请重新打开发送窗口。";
      this.changed();
      return;
    }
    const input: TownPost =
      target.kind === "dm"
        ? { kind: "dm", content: this.content, recipient: this.recipient }
        : target.kind === "fireside"
          ? {
              kind: "fireside",
              content: this.content,
              firesideId: target.firesideId!,
            }
          : { kind: "bonfire", content: this.content };
    if (target.reply)
      input.replyTo =
        input.kind === "dm" ? String(target.reply.id) : Number(target.reply.id);
    this.sendBusy = true;
    this.sendError = "";
    this.sendNotice = "";
    this.changed();
    try {
      const result = await this.api.sendTown(input);
      if (target !== this.sendTarget) return;
      if (!result.ok) {
        this.sendError = result.message;
        return;
      }
      this.drafts.delete(JSON.stringify(target));
      this.content = "";
      this.sendNotice = result.warnings?.length
        ? `消息已发送，但部分 @ 提及未解析成功：${result.warnings.join('；')}。请核对目标，无需重复发送原消息。`
        : "";
      this.sendOpen = Boolean(this.sendNotice);
      await this.load(true);
    } catch (error) {
      if (target === this.sendTarget) this.sendError = errorText(error);
    } finally {
      this.sendBusy = false;
      this.changed();
    }
  }
  installedKit(name: string) {
    // Installation targets use manifest.name, including imports and older Grove installs.
    return this.installedLibrary?.kits.find(kit => kit.name === name);
  }
  async refreshInstalledKits() {
    const generation = ++this.installedRequest;
    this.installedLoading = true;
    this.installedError = "";
    this.installedLibrary = null;
    this.changed();
    try {
      const library = await this.api.localKits();
      if (generation === this.installedRequest) this.installedLibrary = library;
    } catch (error) {
      if (generation === this.installedRequest) this.installedError = errorText(error);
    } finally {
      if (generation === this.installedRequest) {
        this.installedLoading = false;
        this.changed();
      }
    }
  }
  async showInstalledKit(name: string) {
    this.directId = undefined;
    this.tab = "local";
    this.tabs.kits = "local";
    this.search = "";
    this.offset = 0;
    const pending = this.load(), generation = this.request;
    await pending;
    if (generation !== this.request) return;
    const kit = this.library?.kits.find(kit => kit.name === name);
    if (kit) this.selectLocal(kit);
  }
  async prepareKit(id: string) {
    if (this.prepareBusy || this.plan) return;
    this.prepareBusy = true;
    this.changed();
    try {
      const revision = this.lifecycleRevision;
      const plan = await this.api.prepareKit(id);
      if (revision !== this.lifecycleRevision) {
        await this.api.discardKit(plan.ticket);
        return;
      }
      this.plan = plan;
      this.environment = {};
      this.installError = "";
      this.installRetried = false;
    } catch (error) {
      this.toast(error);
    } finally {
      this.prepareBusy = false;
      this.changed();
    }
  }
  closeInstall() {
    if (this.installBusy) return;
    const plan = this.plan;
    this.plan = undefined;
    this.environment = {};
    this.changed();
    if (plan) void this.api.discardKit(plan.ticket).catch(() => {});
  }
  async install() {
    if (!this.plan || this.installBusy) return;
    const revision = this.lifecycleRevision;
    this.installBusy = true;
    this.installError = "";
    this.changed();
    try {
      const result = await this.api.installKit({
        ticket: this.plan.ticket,
        environment: { ...this.environment },
      });
      if (revision !== this.lifecycleRevision) return;
      this.plan = undefined;
      this.environment = {};
      this.toast(`${result.name}：${result.message}`);
      if (this.view === "kits") {
        if (this.tab === "local" && !this.directId) await this.showInstalledKit(result.name);
        else await this.refreshInstalledKits();
      }
    } catch (error) {
      this.installError = errorText(error);
    } finally {
      this.installBusy = false;
      this.installRetried = true;
      this.changed();
    }
  }
  async importKit() {
    await this.run(async () => {
      const result = await this.api.importKit();
      if (result.installed) {
        this.toast(`${result.name} 已导入。Portal 将自动刷新清单。`);
        if (this.tab === "local") await this.load();
      }
    });
  }
  async deleteKit(kit: LocalKit) {
    await this.run(async () => {
      const result = await this.api.deleteKit(kit.name);
      if (!result.deleted) return;
      if (this.localKit?.name === kit.name) this.localKit = undefined;
      if (this.selectedId === kit.name) this.selectedId = "";
      this.toast(`${kit.name} 已删除。`);
      await this.load();
    });
  }
  async run(operation: () => Promise<unknown>) {
    try {
      await operation();
    } catch (error) {
      this.toast(error);
    }
  }
}

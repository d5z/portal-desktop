import type { TownQuery, TownResult } from '../../plugins/sdk';
export type { TownKind, TownQuery, TownResult } from '../../plugins/sdk';
export interface UpdateState {
  phase: 'idle' | 'checking' | 'available' | 'current' | 'unavailable';
  currentVersion: string; latestVersion?: string; message: string; releaseUrl: string;
  activity?: UpdateActivity;
}

export interface UpdateActivity {
  phase: 'metadata' | 'downloading' | 'verifying' | 'preparing' | 'ready' | 'installing';
  version: string;
  received?: number;
  total?: number;
}

export interface Settings {
  permissionMode?: import('./security').PermissionMode;
  endpoint: string;
  being: string;
  hasToken: boolean;
  workspace: string;
  portalBinary: string;
  portalName: string;
  autoStart: boolean;
  backgroundEnabled?: boolean;
  allowExec: boolean;
  kitsEnabled: boolean;
  portalConfigPath?: string;
  portalEnvironmentPath?: string;
}
export interface SubagentSetup { enabled?: boolean; base_url?: string; api?: string; provider: string; model: string; api_key: string; thinking: string }
export interface SaveSettings {
  permissionMode?: import('./security').PermissionMode;
  subagentEnabled?: boolean;
  subagentSetup?: SubagentSetup;
  subagentInherit?: boolean;
  connectionLink?: string;
  workspace: string;
  portalBinary: string;
  portalName: string;
  autoStart: boolean;
  backgroundEnabled?: boolean;
  allowExec: boolean;
  kitsEnabled: boolean;
  portalConfigPath?: string;
  portalEnvironmentPath?: string;
}
export type PortalPhase = 'running' | 'stopped' | 'starting' | 'connected' | 'reconnecting' | 'stopping' | 'external' | 'error';
export interface PortalState { phase: PortalPhase; pid?: number; managed?: boolean; runtimePath?: string; conflict?: boolean; portalName?: string; beingEndpoint?: string; message: string; logs: string[] }
export interface BackgroundState { supported: boolean; installed: boolean; enabled: boolean; running: boolean; existing: boolean; label?: string; pid?: number; message: string }
export interface ChatScene { scene_id: string; scene_meta: { client: string; scene_label: string; portal_name?: string; portal_status?: PortalPhase } }
export interface RecentChatMessage { seq: number; role: 'user' | 'being' | 'assistant'; content: string; at: string; scene_id: string; scene_label: string }
export type ChatSceneActivity = 'queued' | 'thinking' | 'replying' | 'working' | 'waiting' | 'reconnecting' | 'timeout' | 'done' | 'error' | 'send-failed' | 'task-failed' | 'stopped';
export const CHAT_SCENE_ACTIVITY_LABELS: Record<ChatSceneActivity, string> = {
  queued: '排队中', thinking: '思考中', replying: '回复中', working: '执行中', waiting: '等待回复',
  reconnecting: '恢复连接中', timeout: '等待超时', done: '已回复', error: '执行异常', stopped: '已停止',
  'send-failed': '消息未发送', 'task-failed': '后台任务失败',
};
export const CHAT_SCENE_ACTIVITY_ACTIONS: Partial<Record<ChatSceneActivity, string>> = {
  'send-failed': '有附件消息未能发送。打开场景，在输入框上方查看原因，重试附件处理或删除排队消息。',
  'task-failed': '后台任务未完成。打开场景的执行详情查看原因；需要继续时，请让 Being 修正后重试。',
  error: '本轮执行遇到异常。打开场景查看错误详情；修正原因后再重试。',
  timeout: '尚未收到回复。打开场景核对执行记录和连接状态，确认后再重试。',
};
export interface SceneTask { id: string; sceneId: string; status: "queued" | "running" | "done" | "failed" | "cancelled" | "interrupted" | "budget_exhausted" | "timeout"; createdAt: number; endedAt?: number; brief?: string; turns?: number; error?: string }
export interface SceneTaskSnapshot { endpoint: string; tasks: SceneTask[]; subagentReady?: boolean; subagentConfigured?: boolean; subagentEnabled?: boolean }
export interface SubagentStep {
  at: number;
  kind: 'started' | 'thinking' | 'tool' | 'tool-result' | 'message' | 'turn-end' | 'finished';
  callId?: string;
  name?: string;
  input?: string;
  output?: string;
  failed?: boolean;
}
export interface SubagentTaskDetail { taskId: string; steps: SubagentStep[] }
export interface SubagentConfig extends Omit<SubagentSetup, 'api_key'> {
  inherit_model: boolean;
  validated_at?: number;
  api_key_configured: boolean;
}
export interface SubagentStatus {
  enabled: boolean;
  inheritModel: boolean;
  configured: boolean;
  provider: string;
  model: string;
  thinking: string;
  apiKeyConfigured: boolean;
  baseUrl?: string;
  api?: string;
  ready: boolean;
  health: 'ok' | 'warning' | 'error';
  message: string;
  lastTask?: SceneTask;
}
export interface Snapshot { settings: Settings; portal: PortalState; background?: BackgroundState; chatScene?: ChatScene; chatSessions?: ChatScene[]; notice?: string }
export interface ClientStartup { supported: boolean; enabled: boolean; message: string }
export interface NotificationPreferences { enabled: boolean; mail: boolean; firesides: boolean; bonfire: boolean; scenes: boolean }
export interface NotificationSettings { preferences: NotificationPreferences; supported: boolean; message: string }
export type NotificationTarget = { channel: TownChannel; firesideId?: string } | { channel: 'scenes'; sceneId: string; endpoint: string };
export interface BrowserState { open: boolean; address: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; error?: string }
export interface DiagnosticReport { version: string; build: string; platform: string; pid: number; startedAt: string; checkedAt: string; checks: { name: string; status: 'ok' | 'warning' | 'error'; detail: string }[]; logs: string[] }
export interface BrowserBounds { x: number; y: number; width: number; height: number; visible: boolean }
export type BrowserAction = 'back' | 'forward' | 'reload' | 'stop' | 'external' | 'close';
export type ChatEditCommand = 'cut' | 'copy' | 'paste';
export interface DesktopAPI {
  home?: import('./home').HomeAPI;
  dshPlugins?: import("./dsh-plugins").DshPluginAPI;
  toolApprovalPending?(): Promise<import('./security').ToolApprovalView | null>;
  answerToolApproval?(id: string, allowed: boolean): Promise<void>;
  onToolApproval?(callback: (value: import('./security').ToolApprovalView | null) => void): () => void;
  checkLocalFiles?(paths: string[]): Promise<boolean[]>;
  revealLocalFile?(path: string): Promise<import('./local-file').LocalFileRevealResult | boolean>;
  previewLocalFile?(path: string): Promise<import('./local-file').LocalFilePreview>;
  releaseLocalFilePreview?(id: string): Promise<void>;
  downloadDirectory?(change?:boolean):Promise<string | undefined>;
  registerAttachmentSource?(file:File):Promise<string | null>;
  localApps?(): Promise<LocalApp[]>;
  associateApp?(entry: { id: string; name: string }): Promise<boolean>;
  unlinkApp?(id: string): Promise<void>;
  plugins?: import('./plugins').DesktopPluginAPI;
  platform: string;
  changeChatSession(operation: 'create' | 'bind' | 'select' | 'rename' | 'delete', value: string, endpoint: string, sceneId?: string): Promise<Snapshot>;
  clientStartup(enabled?: boolean): Promise<ClientStartup>;
  notifications(patch?: Partial<NotificationPreferences>): Promise<NotificationSettings>;
  testNotification(): Promise<void>;
  notifySceneActivity(endpoint: string, activity: Record<string, ChatSceneActivity>): Promise<void>;
  takeNotificationTarget(): Promise<NotificationTarget | null>;
  onNotificationOpen(callback: () => void): () => void;
  quit(): Promise<void>;
  browserState(): Promise<BrowserState>;
  openBrowser(url?: string): Promise<void>;
  copyText(text: string): Promise<void>;
  copyImage(data: ArrayBuffer, mime: string): Promise<void>;
  editChat(command: ChatEditCommand): Promise<boolean>;
  editSelection(command: ChatEditCommand): Promise<boolean>;
  browserAction(action: BrowserAction): Promise<void>;
  browserBounds(bounds: BrowserBounds): Promise<void>;
  onBrowser(callback: (state: BrowserState) => void): () => void;
  checkUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  cancelUpdate(): Promise<void>;
  updateState(): Promise<UpdateState>;
  onUpdate(callback: (state: UpdateState) => void): () => void;
  appearance(theme?: 'light' | 'dark'): Promise<'light' | 'dark'>;
  town(query: TownQuery): Promise<TownResult>;
  townLive(): Promise<TownLiveState>;
  reconnectTown(): Promise<void>;
  onTownLive(callback: (state: TownLiveState) => void): () => void;
  sendTown(input: TownPost): Promise<TownResult>;
  townAuth(): Promise<{ configured: boolean; beingId?: string; pairedBeingId?: string; display?: string; suggestedBeingId?: string; chatBeing?: string; warning?: string }>;
  autoPairTown(input: { requestId: string; beingId: string }): Promise<void>;
  cancelTownPair(requestId: string): Promise<boolean>;
  pairTown(input: { beingId: string; code: string }): Promise<void>;
  saveTownToken(token: string): Promise<void>;
  localKits(): Promise<KitLibrary>;
  localKitHistoryCandidates?(): Promise<{ name: string; source_id: string; version: string; sha256: string }[]>;
  deleteKit(name: string): Promise<{ deleted: boolean; name: string }>;
  importKit(): Promise<{ installed: boolean; name?: string }>;
  prepareKit(id: string): Promise<KitInstallPlan>;
  installKit(input: KitInstallInput): Promise<{ name: string; tools: number; message: string }>;
  discardKit(ticket: string): Promise<void>;
  openKits(): Promise<void>;
  openTownLink(route: string): Promise<void>;
  snapshot(): Promise<Snapshot>;
  save(input: SaveSettings): Promise<Snapshot>;
  recentChatHistory(endpoint: string): Promise<RecentChatMessage[]>;
  sceneTasks(): Promise<SceneTaskSnapshot>;
  subagentTaskDetails?(endpoint: string, taskIds: string[]): Promise<SubagentTaskDetail[]>;
  onSceneTasks(callback: (snapshot: SceneTaskSnapshot) => void): () => void;
  subagentConfig(): Promise<SubagentConfig>;
  subagentStatus?(): Promise<SubagentStatus>;
  connectionDefaults(input: Pick<SaveSettings, 'connectionLink'>): Promise<{ portalName: string; source?: string }>;
  choose(kind: 'workspace'): Promise<string | null>;
  startPortal(): Promise<PortalState>;
  restartPortal(): Promise<PortalState>;
  forceStartPortal(): Promise<PortalState>;
  stopPortal(): Promise<PortalState>;
  openWorkspace(): Promise<void>;
  diagnostics(): Promise<DiagnosticReport>;
  openLogs(): Promise<void>;
  collectLogs(): Promise<string>;
  portalLogReference(): Promise<{ endpoint: string; text: string }>;
  exportDiagnostics(): Promise<boolean>;
  openLoom(): Promise<void>;
  onPortal(callback: (state: PortalState) => void): () => void;
}
declare global { interface Window { beings: DesktopAPI } }

export interface SeedFilters { q: string; domain: string; tag: string; kit: string; lifecycle: string }
export type TownChannel = 'bonfire' | 'mail' | 'firesides';
export interface TownLiveState {
  phase: 'unpaired' | 'connecting' | 'connected' | 'reconnecting' | 'auth-error';
  generation: number;
  revision: number;
  sync: number;
  // Canonical town_id on current servers; legacy being_id on older servers.
  beingId?: string;
  display?: string;
  message: string;
  versions: Record<TownChannel, number>;
  // Per-room counters let the renderer identify which fireside changed while
  // keeping message bodies in the main process.
  firesideVersions?: Record<string, number>;
}
export type TownPost = { kind: 'bonfire'; content: string; replyTo?: number } | { kind: 'dm'; recipient: string; content: string; replyTo?: string } | { kind: 'fireside'; firesideId: string; content: string; replyTo?: number };
export interface KitTool { name: string; description: string; params?: unknown }
export interface LocalKit { sourceId?: string; installationHash?: string; name: string; version: string; description: string; directory: string; command: string[]; tools: KitTool[]; compatible: boolean; eager: boolean; problem?: string }
export interface KitLibrary { directory: string; enabled: boolean; kits: LocalKit[]; configPath?: string }
export interface LocalApp { id: string; name: string; path: string; exists: boolean }
export interface KitInstallPlan { ticket: string; name: string; version: string; description: string; tools: number; command: string[]; environment: { name: string; description: string; required: boolean }[]; dependency: 'none' | 'npm' | 'python'; sha256: string; notes: string }
export interface KitInstallInput { ticket: string; environment: Record<string, string> }

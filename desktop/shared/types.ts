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
export interface SaveSettings {
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
export interface PortalState { phase: PortalPhase; pid?: number; managed?: boolean; runtimePath?: string; conflict?: boolean; message: string; logs: string[] }
export interface BackgroundState { supported: boolean; installed: boolean; enabled: boolean; running: boolean; existing: boolean; label?: string; pid?: number; message: string }
export interface ChatScene { scene_id: string; scene_meta: { client: string; scene_label: string } }
export interface Snapshot { settings: Settings; portal: PortalState; background?: BackgroundState; chatScene?: ChatScene; notice?: string }
export interface ClientStartup { supported: boolean; enabled: boolean; message: string }
export interface NotificationPreferences { enabled: boolean; mail: boolean; firesides: boolean; bonfire: boolean }
export interface NotificationSettings { preferences: NotificationPreferences; supported: boolean; message: string }
export interface NotificationTarget { channel: TownChannel; firesideId?: string }
export interface BrowserState { open: boolean; address: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; error?: string }
export interface DiagnosticReport { version: string; build: string; platform: string; pid: number; startedAt: string; checkedAt: string; checks: { name: string; status: 'ok' | 'warning' | 'error'; detail: string }[]; logs: string[] }
export interface BrowserBounds { x: number; y: number; width: number; height: number; visible: boolean }
export type BrowserAction = 'back' | 'forward' | 'reload' | 'stop' | 'external' | 'close';
export type ChatEditCommand = 'cut' | 'copy' | 'paste';
export interface DesktopAPI {
  platform: string;
  clientStartup(enabled?: boolean): Promise<ClientStartup>;
  notifications(patch?: Partial<NotificationPreferences>): Promise<NotificationSettings>;
  testNotification(): Promise<void>;
  takeNotificationTarget(): Promise<NotificationTarget | null>;
  onNotificationOpen(callback: () => void): () => void;
  quit(): Promise<void>;
  browserState(): Promise<BrowserState>;
  openBrowser(url?: string): Promise<void>;
  copyText(text: string): Promise<void>;
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
  deleteKit(name: string): Promise<{ deleted: boolean; name: string }>;
  importKit(): Promise<{ installed: boolean; name?: string }>;
  prepareKit(id: string): Promise<KitInstallPlan>;
  installKit(input: KitInstallInput): Promise<{ name: string; tools: number; message: string }>;
  discardKit(ticket: string): Promise<void>;
  openKits(): Promise<void>;
  openTownLink(route: string): Promise<void>;
  snapshot(): Promise<Snapshot>;
  save(input: SaveSettings): Promise<Snapshot>;
  connectionDefaults(input: Pick<SaveSettings, 'connectionLink'>): Promise<{ portalName: string; source?: string }>;
  choose(kind: 'workspace'): Promise<string | null>;
  startPortal(): Promise<PortalState>;
  restartPortal(): Promise<PortalState>;
  forceStartPortal(): Promise<PortalState>;
  stopPortal(): Promise<PortalState>;
  openWorkspace(): Promise<void>;
  diagnostics(): Promise<DiagnosticReport>;
  openLogs(): Promise<void>;
  portalLogReference(): Promise<{ endpoint: string; text: string }>;
  exportDiagnostics(): Promise<boolean>;
  openLoom(): Promise<void>;
  onPortal(callback: (state: PortalState) => void): () => void;
}
declare global { interface Window { beings: DesktopAPI } }

export type TownKind = 'home' | 'bonfire' | 'firesides' | 'fireside' | 'fireside-members' | 'inbox' | 'sent' | 'embers' | 'scrolls' | 'my-scrolls' | 'grove' | 'kit' | 'ember' | 'scroll' | 'seeds' | 'seed' | 'seed-lineage' | 'seed-absorbs';
export interface SeedFilters { q: string; domain: string; tag: string; kit: string; lifecycle: string }
export interface TownQuery { kind: TownKind; offset?: number; id?: string; scrollKind?: string; q?: string; domain?: string; tag?: string; kit?: string; lifecycle?: string }
export type TownResult = { ok: true; data: Record<string, unknown>; fetchedAt: string; warnings?: string[] } | { ok: false; code: 'auth' | 'forbidden' | 'not-found' | 'http' | 'network'; message: string };
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
export interface LocalKit { name: string; version: string; description: string; directory: string; command: string[]; tools: KitTool[]; compatible: boolean; eager: boolean; problem?: string }
export interface KitLibrary { directory: string; enabled: boolean; kits: LocalKit[]; configPath?: string }
export interface KitInstallPlan { ticket: string; name: string; version: string; description: string; tools: number; command: string[]; environment: { name: string; description: string; required: boolean }[]; dependency: 'none' | 'npm' | 'python'; sha256: string; notes: string }
export interface KitInstallInput { ticket: string; environment: Record<string, string> }

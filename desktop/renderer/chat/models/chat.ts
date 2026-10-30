import { UISnapshotStore } from '../../shared/intelligent-ui/snapshots';
import { readIntelligentUIPreference, saveIntelligentUIPreference } from "../../shared/intelligent-ui/context";
import { Store } from "../../shared/models/store";
import { messageScene, type HistoryScope, type MessageScene } from "./scenes";
import { chatHistoryLimit } from '../../../shared/chat-history';

export type ChatPanel = "model" | "being" | "privacy" | null;

export interface Attachment {
  name: string;
  type: string;
  size: number;
  base64: string;
  /** Desktop files are structured-cloned to IndexedDB without Base64 expansion. */
  blob?: Blob;
  /** Composer-only object URL; excluded from persisted queue rows. */
  previewUrl?: string;
  loading?: boolean;
  uploadProgress?: import('../services/attachment-transfer').UploadProgress;
  sourceToken?: string;
  uploadKey?: string;
  attachmentId?: string;
  jobId?: string;
  resultId?: string;
  parseFailed?: boolean;
  forceParse?: boolean;
}
export interface Message extends MessageScene {
  kind: "message";
  id: string;
  turnId?: string;
  /** Shared by speech fragments before the same reply boundary. */
  replyId?: string;
  /** Original message IDs represented by a combined display bubble. */
  sourceMessageIds?: string[];
  role: "user" | "being" | "system";
  text: string;
  streaming: boolean;
  /** Text emitted before the same reply resumes reasoning or tool work. */
  interim?: boolean;
  timestamp: string;
  createdAt?: number;
  historySeq?: number;
  persistedFrom?: "final" | "act_talk" | "partial";
  persistedStreamId?: string;
  /** Authoritative history content, applied after live rendering finishes. */
  persistedText?: string;
  label: string;
  consecutive: boolean;
  attachmentViews?: import("../services/attachment-messages").AttachmentMessage[];
  attachmentEndpoint?: string;
  attachmentUploads?: {name:string; size:number; mime?:string; blob?:Blob; progress?: import('../services/attachment-transfer').UploadProgress}[];
  retry?: () => void | Promise<void>;
  retryLabel?: string;
  notice?: 'stop';
  statusRunId?: string;
  queued?: boolean;
  queueNotice?: string;
  cancelQueued?: () => void;
  canInterruptQueued?: boolean;
  interruptQueued?: () => void | Promise<void>;
  editQueued?: (text: string) => void | Promise<void>;
  moveQueued?: (offset: number) => void | Promise<void>;
  reorderQueued?: (targetId: string) => void | Promise<void>;
}
export interface ActivityEntry {
  type: string;
  id?: string;
  toolCallId?: string;
  name?: string;
  label?: string;
  arg?: string;
  preview?: string;
  text?: string;
  result?: string;
  inputDetail?: string;
  resultDetail?: string;
  exitCode?: number;
  durationMs?: number;
  outputTruncated?: boolean;
  totalOutputBytes?: number;
  artifactPath?: string;
  done?: boolean;
  error?: boolean;
  duration?: number;
  ts?: number;
}
export interface Run extends MessageScene {
  kind: "run";
  /** Explicit autonomous origin; a missing scene alone is not evidence of SBS. */
  autonomousOrigin?: string;
  streamId?: string;
  id: string;
  entries: ActivityEntry[];
  start: number;
  end?: number;
  label: string;
  hint: string;
  context?: string;
  arg: string;
  waitingForReply?: boolean;
  status?: import("../../../shared/types").ChatSceneActivity;
  scheduling?: { hint: string; tasks: import("../../../shared/types").SceneTask[] };
  synthetic?: boolean;
  stopHistorySeq?: number;
  outcome?: "stopped" | "error" | "timeout" | "done";
}
export type ChatItem =
  | Message
  | Run
  | ({ kind: "separator"; id: string; text: string; marker?: boolean; handoffMarker?: boolean; stopMarker?: boolean } & MessageScene);
export interface Preset {
  base_url?: string;
  api?: string;
  id: string;
  label: string;
  model: string;
  provider: string;
  has_key?: boolean;
}
export interface LlmConfig {
  history?: { provider: string; model: string }[];
  has_api_key?: boolean;
  oauth_connected?: boolean;
  enabled?: boolean;
  base_url?: string;
  api?: string;
  model?: string;
  provider?: string;
  presets?: Preset[];
  thinking?: string;
  temperature?: number;
  sbs_enabled?: boolean;
}
export interface ConfigResult {
  ok?: boolean;
  needs_key?: boolean;
  error?: string;
  config?: LlmConfig;
  rolled_back?: boolean;
  http_status?: number;
  candidates?: string[];
}
export interface Soul {
  name?: string;
  role?: string;
  quote?: string;
  born?: string;
  status?: string;
  [key: string]: unknown;
}
export class ChatState extends Store {
  historyLoading = true;
  historyRefreshing = false;
  intelligentUISnapshots: Record<string, string> = {};
  private uiSnapshotStore = new UISnapshotStore();
  recordIntelligentUISnapshot(scene: string, text: string, active = false) {
    const selected = this.uiSnapshotStore.record(scene, text, active);
    if (selected !== undefined) this.intelligentUISnapshots[scene] = selected;
  }
  intelligentUIEnabled = readIntelligentUIPreference();
  permissionMode?: import('../../../shared/security').PermissionMode;
  permissionMenuOpen = false;
  get intelligentUITargetTitle(): string {
    try { return JSON.parse(this.intelligentUISnapshots[this.currentScene.sceneId || 'global'] || '{}').title || ''; }
    catch { return ''; }
  }
  intelligentUIForMessage = false;
  setIntelligentUIForMessage(enabled: boolean) {
    this.intelligentUIForMessage = this.intelligentUIEnabled && enabled;
    this.changed();
  }
  setIntelligentUIEnabled(enabled: boolean) {
    this.intelligentUIEnabled = enabled;
    if (!enabled) this.intelligentUIForMessage = false;
    saveIntelligentUIPreference(enabled);
    this.changed();
  }
  items: ChatItem[] = [];
  historyLimit = chatHistoryLimit(Number(new URLSearchParams(location.search).get('history_limit')));
  subagentReady = false;
  subagentConfigured?: boolean;
  subagentEnabled?: boolean;
  sceneTasks: import('../../../shared/types').SceneTask[] = [];
  sceneNames: Record<string, string> = {};
  currentScene: MessageScene = { ...messageScene(Object.fromEntries(new URLSearchParams(location.search))), ...(new URLSearchParams(location.search).get("scene_strict") === "1" ? { strict: true } : {}) };
  activeScene: MessageScene = this.currentScene;
  historyScope: HistoryScope = this.currentScene.sceneId && new URLSearchParams(location.search).get("scene_scope") !== "all" ? "current" : "all";
  private sbsVisibility = new Map<string, boolean>();
  private get sbsVisibilityKey() {
    const endpoint = new URLSearchParams(location.search).get("history_scope") || location.origin;
    return `beings:scene-sbs:${JSON.stringify([endpoint, this.currentScene.sceneId || ""])}`;
  }
  get showSbsMessages(): boolean {
    const key = this.sbsVisibilityKey;
    if (!this.sbsVisibility.has(key)) {
      let saved: string | null = null;
      try { saved = localStorage.getItem(key); } catch {}
      this.sbsVisibility.set(key, saved === "true" || (saved !== "false" && !this.currentScene.sceneId));
    }
    return this.sbsVisibility.get(key)!;
  }
  setShowSbsMessages(show: boolean) {
    const key = this.sbsVisibilityKey;
    this.sbsVisibility.set(key, show);
    try { localStorage.setItem(key, String(show)); } catch {}
    this.changed();
  }
  name = new URLSearchParams(location.search).get("name") || "being";
  soul: Soul = {};
  draft = "";
  files: Attachment[] = [];
  queued = 0;
  sendWillQueue = false;
  canInterruptQueue = false;
  thinking = false;
  streaming = false;
  sbsStreamingOrigin?: string;
  sbsActivityPhase?: string;
  stopping = false;
  attachmentPending = false;
  connection = "connecting";
  banner = "";
  dotClass = "reconnecting";
  sbsEnabled = true;
  sbsKnown = false;
  resetScroll = 0;
  config: LlmConfig = {};
  configStatus = "";
  configStatusClass = "";
  configLoading = false;
}
export interface ChatRuntime {
  updateSceneTasks(tasks: import("../../../shared/types").SceneTask[], subagentReady?: boolean): void;
  start(): Promise<void>;
  selectScene(scene: MessageScene): Promise<void>;
  dispose(): void;
  send(text: string, files?: Attachment[] | null, options?: { mode?: "interrupt"; intelligentUI?: boolean; uiAction?: import('../../shared/intelligent-ui/surfaces').UIInteraction }): Promise<void>;
  stopCurrentTurn(): Promise<void>;
  handleFiles(files: Iterable<File>): void;
  removePending(index: number): void;
  loadLlmConfig(): Promise<void>;
  applyConfigChange(
    patch: Record<string, string | number | boolean>,
  ): Promise<ConfigResult | null>;
  toggleSbs(): Promise<void>;
  loadSbsState(): Promise<boolean | undefined>;
  revealHistory(rows: import("../services/history-cache").HistoryMessage[]): void;
  loadOlderHistory(before?: number): Promise<number>;
  loadHistoryTarget(seq: number, sceneId: string): Promise<boolean>;
  refreshHistory(): Promise<void>;
  refreshOnRegainedAttention(): Promise<void>;
  request(path: string, init?: RequestInit): Promise<Response>;
}
export interface RuntimeOptions {
  connection?: { api: string; token: string; relaySecret?: string };
  onSceneActivity?(activity: Record<string, import("../../../shared/types").ChatSceneActivity>): void;
  onSbs?(enabled: boolean): void;
  onConnection?(state: string): void;
  beforeSend?(text: string): Promise<((ok: boolean) => void) | undefined>;
}

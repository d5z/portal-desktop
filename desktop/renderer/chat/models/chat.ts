import { Store } from "../../shared/models/store";
import { messageScene, type HistoryScope, type MessageScene } from "./scenes";

export type ChatPanel = "model" | "being" | "privacy" | null;

export interface Attachment {
  name: string;
  type: string;
  size: number;
  base64: string;
  loading?: boolean;
}
export interface Message extends MessageScene {
  kind: "message";
  id: string;
  turnId?: string;
  role: "user" | "being" | "system";
  text: string;
  streaming: boolean;
  timestamp: string;
  label: string;
  consecutive: boolean;
  retry?: () => void | Promise<void>;
  retryLabel?: string;
}
export interface ActivityEntry {
  type: string;
  name?: string;
  label?: string;
  arg?: string;
  preview?: string;
  text?: string;
  result?: string;
  done?: boolean;
  error?: boolean;
  duration?: number;
  ts?: number;
}
export interface Run extends MessageScene {
  kind: "run";
  id: string;
  entries: ActivityEntry[];
  start: number;
  end?: number;
  label: string;
  hint: string;
  arg: string;
  outcome?: "stopped" | "error" | "done";
}
export type ChatItem =
  | Message
  | Run
  | ({ kind: "separator"; id: string; text: string; marker?: boolean } & MessageScene);
export interface Preset {
  id: string;
  label: string;
  model: string;
  provider: string;
  has_key?: boolean;
}
export interface LlmConfig {
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
  items: ChatItem[] = [];
  currentScene = messageScene(Object.fromEntries(new URLSearchParams(location.search)));
  activeScene: MessageScene = this.currentScene;
  historyScope: HistoryScope = this.currentScene.sceneId ? "current" : "all";
  name = new URLSearchParams(location.search).get("name") || "being";
  soul: Soul = {};
  draft = "";
  files: Attachment[] = [];
  queued = 0;
  thinking = false;
  streaming = false;
  stopping = false;
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
  start(): Promise<void>;
  dispose(): void;
  send(text: string, files?: Attachment[] | null): Promise<void>;
  stopCurrentTurn(): Promise<void>;
  handleFiles(files: Iterable<File>): void;
  removePending(index: number): void;
  loadLlmConfig(): Promise<void>;
  applyConfigChange(
    patch: Record<string, string | number | boolean>,
  ): Promise<ConfigResult | null>;
  toggleSbs(): Promise<void>;
  loadSbsState(): Promise<boolean | undefined>;
  refreshHistory(): Promise<void>;
  refreshOnRegainedAttention(): Promise<void>;
  request(path: string, init?: RequestInit): Promise<Response>;
}
export interface RuntimeOptions {
  onSbs?(enabled: boolean): void;
  onConnection?(state: string): void;
  beforeSend?(text: string): Promise<((ok: boolean) => void) | undefined>;
}

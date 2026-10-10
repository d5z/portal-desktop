export type TownKind = 'home' | 'bonfire' | 'firesides' | 'fireside' | 'fireside-members' | 'inbox' | 'sent' | 'embers' | 'scrolls' | 'my-scrolls' | 'grove' | 'kit-comments' | 'kit' | 'ember' | 'scroll' | 'seeds' | 'seed' | 'seed-lineage' | 'seed-absorbs' | 'announcements' | 'announcement' | 'contacts';
export interface TownQuery { kind: TownKind; limit?: number; offset?: number; id?: string; scrollKind?: string; groveStatus?: string; q?: string; domain?: string; tag?: string; kit?: string; lifecycle?: string; category?: string; includeExpired?: boolean }
export type TownResult = { ok: true; data: Record<string, unknown>; fetchedAt: string; warnings?: string[] } | { ok: false; code: 'auth' | 'forbidden' | 'not-found' | 'http' | 'timeout' | 'format' | 'too-large' | 'network'; message: string; traceId?: string };

export interface PluginBeingContext { connected: boolean; name: string; sceneId: string; sceneLabel: string }
export type PluginResourceKind = 'seeds' | 'scrolls' | 'embers' | 'kits' | 'announcements' | 'contacts' | 'mail' | 'bonfire' | 'firesides';
export interface PluginResource { kind: PluginResourceKind; id: string; title: string; excerpt: string; private: boolean; revision?: string }
export interface PluginWorkspaceContext { revision: number; view: string; title: string; status: 'loading' | 'ready' | 'error'; resource?: PluginResource }
export type PluginEventTopic = 'workspace.changed' | 'town.changed' | 'tasks.changed';
/** Invalidation only: read the corresponding API for an authorized current snapshot. */
export interface PluginChangeEvent { topic: PluginEventTopic; revision: number; at: string }
export type PluginTaskStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted' | 'budget_exhausted' | 'timeout';
export interface PluginTask { id: string; status: PluginTaskStatus; createdAt: number; endedAt?: number }
export interface PluginTaskSnapshot { scopeId: string; sceneId: string; tasks: PluginTask[]; ready: boolean; configured: boolean; enabled: boolean }
export interface GroveSDK {
  readonly apiVersion: 1;
  readonly sdkVersion: '1.3.0';
  readonly view: string;
  readonly command?: string;
  readonly slot?: string;
  loadData(): Promise<unknown>;
  saveData(value: unknown): Promise<void>;
  /** Atomically merge top-level keys; use this when several views share storage. */
  updateData(patch: Record<string, unknown>): Promise<void>;
  onTheme(callback: (theme: 'light' | 'dark') => void): () => void;
  onUnload(callback: () => void): () => void;
  workspace: { getContext(): Promise<PluginWorkspaceContext>; onContextChange(callback: (event: PluginChangeEvent) => void): Promise<() => void> };
  events: { subscribe(topic: PluginEventTopic, callback: (event: PluginChangeEvent) => void): Promise<() => void> };
  town: { query(query: TownQuery): Promise<TownResult> };
  being: {
    context(): Promise<PluginBeingContext>;
    history(options?: { limit?: number }): Promise<{ sceneId: string; messages: { role: string; content: string; at?: string }[] }>;
    compose(text: string): Promise<{ inserted: boolean }>;
    chat(message: string): Promise<{ status: 'completed' | 'accepted'; text: string; sceneId: string }>;
    onDelta(callback: (data: { text: string }) => void): () => void;
    tasks: { list(): Promise<PluginTaskSnapshot>; onChange(callback: (event: PluginChangeEvent) => void): Promise<() => void> };
  };
  ui: { notice(text: string): Promise<void>; navigate(view: string, id?: string): Promise<void> };
}

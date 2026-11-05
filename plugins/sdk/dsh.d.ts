/** Town's DSH compatibility contracts. These services belong to Cordis, not window.grove. */
/** Host-internal resolved configuration. Desktop reuses Being/subagent settings, not a plugin-specific form. */
export interface DshServiceConfig {
  provider: 'openai-compatible';
  /** Includes the API version path, e.g. https://api.example.com/v1. */
  baseUrl: string;
  model: string;
  apiKey: string;
}
/** Harness content-addressed image ID: sha256: followed by 64 lowercase hex characters. */
export interface DshImageRef { attachmentId: `sha256:${string}`; mediaType: string; bytes: number }
export interface TownDshHostServices {
  /** Available during apply(); listener is private to this host generation. */
  webServer: {
    readonly host: '127.0.0.1'; readonly protocol: 'http:'; readonly port: number;
    getOrigin(): string;
    register(route: { kind: 'exact' | 'prefix'; path: string;
      handler(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): unknown }): () => void;
    tapIndex(transform: (html: string) => string): () => void;
  };
  connection: {
    /** Creates a launch URL for this listener; root exchanges its token for a session cookie. */
    authenticatedUrl(baseUrl: string): string;
    requestRejection(req: Pick<import('node:http').IncomingMessage, 'url' | 'headers'>): 401 | 403 | undefined;
    fetch: { register(route: { path: string; methods?: string[]; fetch(request: Request): Promise<Response> | Response }): () => void };
  };
  /** Town extension. Subscribe with ctx.on('town/activity', callback). Not a DSH Session. */
  townActivity: { getSnapshot(): Record<string, 'queued' | 'thinking' | 'working' | 'replying' | 'waiting' | 'reconnecting' | 'done' | 'stopped' | 'error' | 'timeout'> };

  /** Being first; currently falls back to a compatible subagent API. Throws an actionable reason if neither is available. */
  agentDefaultModel: { currentSelection(): { provider: string; model: string } };
  credentials: { resolve(ref: 'OPENAI_API_KEY'): { value: string } };
  attachments: {
    imageLimits: { maxImageBytes: number };
    saveImages(images: { data: Uint8Array; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' }[]): Promise<DshImageRef[]>;
    imageHostPath(ref: Pick<DshImageRef, 'attachmentId'>): string;
  };
  llm: {
    listProviders(): { id: string; name: string }[];
    listModels(provider: string): { id: string; name: string }[];
    resolveModelInfo(): { reasoning: { efforts: never[] } };
    /** Text/image generation only. Tools and unknown content blocks explicitly fail. */
    stream(options: {
      provider: string; model: string; system?: string; temperature?: number; signal?: AbortSignal;
      messages: { role: 'user' | 'assistant' | 'system' | 'developer'; content: ({ type: 'text'; text: string } | { type: 'image'; attachment: DshImageRef })[] }[];
    }): AsyncIterable<{ type: 'text-delta' | 'reasoning-delta'; index: number; text: string }>;
  };
  /** Placeholder in desktop mode: no compatible Being/subagent transcription configuration is available. */
  speechToText: {
    listProviders(): { id: string }[];
    resolve(input: { audio: Uint8Array; language?: string }): { audio: Uint8Array; language?: string };
    transcribe(input: { audio: Uint8Array; language?: string }, signal?: AbortSignal): Promise<{ text: string }>;
  };
  commands: {
    register(command: { name: string; description?: string; input?: { hint?: string }; handler(input: { rawInput: string }): unknown }): () => void;
    list(): { name: string; description?: string; input?: { hint?: string } }[];
    execute(sessionId: string, input: string, attachments?: never[]): Promise<unknown>;
  };
}
export interface TownDshClientServices {
  sidebarRightTabs: { register(tab: { id: string; kind: string; title(): string }): () => void };
  sidebarRight: { openTab(kind: string): void };
  uiWorkspace: { openSession(townSceneId: string): Promise<void> };
  uiSettings: { openSection(id: string): void };
  commandUi: { decorate(definition: {
    name: string; available?(): boolean;
    ui: { kind: 'popupSelect'; options(): Promise<{ id: string; label: string; detail?: string }[]>; onSelect(option: { id: string }, session: { sessionId: string }): Promise<void> };
  }): () => void };
  shortcuts: {
    register(definition: { id: string; label(): string; defaults: Record<string, { code: string; modifiers: ('primary' | 'meta' | 'control' | 'shift' | 'alt')[] }>;
      regions?: ('page' | 'editable' | 'terminal')[]; modals?: string[];
      resolve(context: { source: 'keyboard'; region: 'page' | 'editable'; modal: string | null; target: Element | null }): { status: string; run?(): void } }): () => void;
    catalog: { getSnapshot(): { id: string; label: string; keys: string[]; conflicts: string[] }[]; subscribe(listener: () => void): () => void };
  };
}

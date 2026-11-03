/** This contract carries no URL, cookie or OAuth credential. */
export interface BrowserState {
  ready: boolean; can_control: boolean; controlled_elsewhere?: boolean; controller: string; lease_remaining_seconds: number;
  view_mode: 'native' | 'page'; frame_width: number; frame_height: number;
  live_view?: { available: boolean; protocol: string };
}
export type BrowserInput = { action: 'native_click' | 'click'; x: number; y: number; button?: number }
  | { action: 'native_scroll' | 'scroll'; x?: number; y?: number; delta_y: number }
  | { action: 'native_key' | 'key'; key: string; modifiers: number }
  | { action: 'native_type' | 'type'; text: string };
export type ViewerEvent = { type: 'presentation'; preview: boolean; visible: boolean; dark: boolean }
  | { type: 'stream'; id: number; kind: 'open' | 'close' | 'data'; data?: Uint8Array; sequence?: number; code?: number };
export interface ViewerAPI {
  request(operation: 'state' | 'frame' | 'control' | 'input' | 'connect' | 'disconnect' | 'ready' | 'expand' | 'painted' | 'failed', value?: unknown): Promise<any>;
  send(id: number, data: Uint8Array): void;
  ack(id: number, sequence: number): void;
  subscribe(callback: (event: ViewerEvent) => void): () => void;
}

/** Credential-free native Home contract. Remote viewer URLs never cross IPC. */
export interface HomeComputer { id: string; being_profile_id: string; status: string; desired_state: string; generation: number }
export interface HomeOperation { id: string; computer_id: string; kind: string; status: string; target_generation: number; error_code: string | null }
export type HomeAction = 'login' | 'cancel-login' | 'initialize' | 'bind' | 'wake' | 'stop' | 'recreate' | 'open' | 'close' | 'logout';
export interface HomeState {
  authenticated: boolean;
  authenticating: boolean;
  username?: string;
  beingName?: string;
  needsInitialization?: boolean;
  binding?: 'matched' | 'missing' | 'mismatch' | 'no-connection';
  enabled?: boolean;
  storageReady?: boolean;
  browserReady?: boolean;
  computer?: HomeComputer;
  operation?: HomeOperation;
  pending?: 'ensure' | 'stop' | 'recreate';
  viewer: 'closed' | 'loading' | 'page' | 'error' | 'expired';
  error?: string;
}
export interface HomeBounds { x: number; y: number; width: number; height: number; visible: boolean; presentation?: 'preview' | 'browser'; dark?: boolean }
export interface HomeAPI {
  files?: HomeFilesAPI;
  state(): Promise<HomeState>;
  refresh(): Promise<HomeState>;
  action(action: HomeAction): Promise<HomeState>;
  preview(): Promise<string | null>;
  bounds(bounds: HomeBounds): Promise<void>;
  onExpand?(callback: () => void): () => void;
  subscribe(callback: (state: HomeState) => void): () => void;
}

export const MAX_HOME_PREVIEW = 8 * 1024 * 1024;
export const HOME_PREVIEW_TOO_LARGE = '此文件较大，请下载后查看。在线预览最多支持 8 MiB。';
export interface HomeFileEntry { name: string; path: string; type: 'file' | 'directory'; size: number }
export interface HomeFileList { entries: HomeFileEntry[] }
export interface HomeFilePreview { name: string; path: string; bytes: Uint8Array }
export interface HomeFilesAPI {
  list(path: string): Promise<HomeFileList>;
  preview(path: string): Promise<HomeFilePreview>;
  download(path: string): Promise<boolean>;
}

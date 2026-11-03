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
  state(): Promise<HomeState>;
  refresh(): Promise<HomeState>;
  action(action: HomeAction): Promise<HomeState>;
  preview(): Promise<string | null>;
  bounds(bounds: HomeBounds): Promise<void>;
  onExpand?(callback: () => void): () => void;
  subscribe(callback: (state: HomeState) => void): () => void;
}

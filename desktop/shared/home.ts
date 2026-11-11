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
  connectors?: HomeConnectorAPI;
  state(): Promise<HomeState>;
  refresh(): Promise<HomeState>;
  action(action: HomeAction): Promise<HomeState>;
  preview(): Promise<string | null>;
  bounds(bounds: HomeBounds): Promise<void>;
  onExpand?(callback: () => void): () => void;
  subscribe(callback: (state: HomeState) => void): () => void;
}

export interface HomeConnectorCatalogItem {
  release_id: string;
  kit_id: string;
  name: string;
  version: string;
  description: string;
  runtimes: string[];
  requires_accounts: boolean;
  account_providers: string[];
  category: string;
  availability: 'listed' | 'blocked' | 'unavailable' | string;
  unavailable_reason: string | null;
  installation_ids: string[];
}
export interface HomeConnectorCatalogPage { enabled: boolean; items: HomeConnectorCatalogItem[]; next_after: string | null }
export interface HomeConnectorInstallation {
  id: string;
  install_key: string;
  kit_id: string;
  root_release_id: string;
  revision: number;
  policy_revision: number;
  desired_state: string;
  status: string;
  active_plan_id: string;
  created_time: string;
  updated_time: string;
}
export interface HomeConnectorInstallationPage { items: HomeConnectorInstallation[]; next_after: string | null }
export interface HomeConnectorSelectionOptions {
  release_id: string;
  installation?: { id: string; install_key: string; revision: number } | null;
  nodes: { dependency_path: string[]; accounts: { id: string; provider: string; capabilities: string[]; required: boolean }[] }[];
}
export interface HomeConnectorAccount {
  id: string;
  auth_type: string;
  display_name?: string | null;
  grant_revoked: boolean;
  installation_ids: string[];
  requires_adoption: boolean;
  status: string;
  usable: boolean;
}
export interface HomeConnectorField { name: string; label?: string; type?: string; required?: boolean; secret?: boolean; description?: string | null; placeholder?: string | null }
export interface HomeConnectorDetail {
  name: string;
  accounts: HomeConnectorAccount[];
  methods: { method: 'oauth2' | 'api_key' | 'custom_credential'; fields: HomeConnectorField[] }[];
  reason?: string | null;
}
export interface HomeConnectorPreview { id: string; expires_at: string; requires_adoption: boolean; read_actions: string[]; write_actions: string[]; scopes: string[]; permission_notes: string[] }
export interface HomeConnectorFlow {
  id: string; revision: number; status: string; release_id: string; installation_id: string | null;
  dependency_path: string[]; requirement: string; provider: string; connection_id: string;
  expires_at: string; return_hash: string; authorization_url?: string | null;
  connection?: { id: string; provider: string; status: string; display_name?: string | null } | null;
}
export interface HomeConnectorEnableState { id: string; revision?: number; release_id: string; status: string; installation_id: string | null; connection_id: string | null; authorization_url?: string | null }
export interface HomeConnectorTool {
  component_id: string; connection_id: string; export: string; action: string; description: string;
  read_only: boolean; enabled: boolean; available: boolean; account_authorized: boolean; revision: number; contract_digest: string;
}
export interface HomeConnectorAPI {
  catalog(query?: { q?: string; after?: string }): Promise<HomeConnectorCatalogPage>;
  installations(after?: string): Promise<HomeConnectorInstallationPage>;
  detail(releaseId: string): Promise<HomeConnectorDetail>;
  startOAuth(releaseId: string, installationId?: string): Promise<HomeConnectorEnableState>;
  syncOAuth(intentId: string, expectedRevision: number): Promise<HomeConnectorEnableState>;
  oauthState(intentId: string): Promise<HomeConnectorEnableState>;
  preview(releaseId: string, input: { connection_id?: string; method?: string; reauthorize?: boolean }): Promise<HomeConnectorPreview>;
  confirm(intentId: string, input: { adopt: boolean; values?: Record<string, string> }): Promise<HomeConnectorEnableState>;
  state(intentId: string): Promise<HomeConnectorEnableState>;
  advance(intentId: string): Promise<HomeConnectorEnableState>;
  cancel(intentId: string): Promise<HomeConnectorEnableState>;
  openAuthorization(url: string): Promise<void>;
  tools(installationId: string): Promise<HomeConnectorTool[]>;
  setTool(installationId: string, input: { component_id: string; connection_id: string; export: string; contract_digest: string; request_id: string; expected_revision: number; enabled: boolean; confirm_write: boolean }): Promise<HomeConnectorTool>;
  setBeingAccess(installationId: string, enabled: boolean, expectedRevision: number): Promise<unknown>;
  lifecycle(installationId: string, action: 'enable' | 'disable' | 'uninstall', expectedRevision: number): Promise<unknown>;
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

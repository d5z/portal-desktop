export const HOME_ORIGIN = 'https://home.beings.town';
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
  /** Absolute URL resolved by the main process from Home's service-relative icon URL. */
  icon_url?: string | null;
  version: string;
  description: string;
  runtimes: string[];
  requires_accounts: boolean;
  account_providers: string[];
  category: string;
  availability: 'listed' | 'blocked' | 'unavailable' | string;
  unavailable_reason: string | null;
  installation_ids: string[];
  local_install_url?: string | null;
  local_install?: { kind: 'town'; source_id: string; used_before?: boolean } | null;
}
export interface HomeConnectorCatalogPage { enabled: boolean; items: HomeConnectorCatalogItem[]; next_after: string | null }
export interface HomeLocalKitHistory {
  id: string;
  source_id: string;
  name: string;
  version: string;
  created_time: string;
  updated_time: string;
}
export interface HomeLocalKitHistoryPage { items: HomeLocalKitHistory[]; next_after: string | null }
export interface HomeConnectorInstallation {
  id: string;
  install_key: string;
  kit_id: string;
  root_release_id: string;
  revision: number;
  policy_revision: number;
  desired_state: string;
  status: 'preparing' | 'ready' | 'degraded' | 'needs_auth' | 'waiting_device' | 'unsupported_auth_channel' | 'blocked' | 'failed' | 'disabled' | 'removed' | 'unknown';
  active_plan_id: string;
  created_time: string;
  updated_time: string;
}
export interface HomeConnectorInstallationPage { items: HomeConnectorInstallation[]; next_after: string | null }
export interface HomeConnectorAccount {
  enable_id?: string | null;
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
export interface HomeConnectorSkill { export: string; name: string; description: string }
export interface HomeConnectorDetail {
  name: string;
  /** Absolute URL resolved by the main process from Home's service-relative icon URL. */
  icon_url?: string | null;
  skills: HomeConnectorSkill[];
  accounts: HomeConnectorAccount[];
  methods: { method: 'oauth2' | 'api_key' | 'custom_credential'; fields: HomeConnectorField[] }[];
  reason?: string | null;
}
export interface HomeLocalKitDetail {
  source_id: string;
  installer: 'desktop_legacy';
  tools: { name: string; description: string; input_schema: Record<string, unknown> }[];
  install_manifest: Record<string, unknown>;
  bundle: { download_url: string; sha256: string; size_bytes: number } | null;
}
export type HomeAppDetail =
  | { kind: 'cloud_connector'; app: HomeConnectorCatalogItem; connector: HomeConnectorDetail }
  | { kind: 'local_kit'; app: HomeConnectorCatalogItem; local_kit: HomeLocalKitDetail };
export interface HomeKitPreparation { sourceId: string; releaseId: string; detail: Extract<HomeAppDetail, { kind: 'local_kit' }>; archive: Uint8Array }
export const MAX_LOCAL_KIT_BUNDLE = 64 * 1024 * 1024;
/** Only published Home bundle resources can cross the desktop download bridge. */
export function homeKitBundlePath(releaseId: string, bundle: NonNullable<HomeLocalKitDetail['bundle']>) {
  if (!/^[0-9a-f-]{36}$/i.test(releaseId) || !/^[0-9a-f]{64}$/.test(bundle.sha256) || !Number.isSafeInteger(bundle.size_bytes) || bundle.size_bytes <= 0 || bundle.size_bytes > MAX_LOCAL_KIT_BUNDLE) throw new Error('本地 Kit 安装包信息无效或超过 64 MB。');
  const url = new URL(bundle.download_url, HOME_ORIGIN + '/');
  const expected = `/v1/local-kit-bundles/${releaseId}/${bundle.sha256}`;
  if (url.origin !== HOME_ORIGIN || url.pathname !== expected || url.search || url.hash || url.username || url.password) throw new Error('Home 返回了无效的本地 Kit 下载地址。');
  return expected;
}
export interface HomeConnectorPreview { id: string; expires_at: string; requires_adoption: boolean; read_actions: string[]; write_actions: string[]; scopes: string[]; permission_notes: string[] }
export interface HomeConnectorEnableState { id: string; release_id: string; status: 'awaiting_account' | 'needs_auth' | 'preparing' | 'ready' | 'paused' | 'failed' | 'unknown' | 'cancelled' | 'expired'; installation_id: string | null; connection_id: string | null; authorization_url?: string | null }
export interface HomeConnectorTool {
  component_id: string; connection_id: string; export: string; action: string; description: string;
  read_only: boolean; enabled: boolean; available: boolean; account_authorized: boolean; revision: number; contract_digest: string;
}
export interface HomeConnectorBeingAccess { enabled: boolean; revision: number; being_profile_id: string }
export const CONNECTOR_NETWORK_METHODS = {
  'app-detail': 'GET', 'local-kit-bundle': 'GET',
  catalog: 'GET', 'legacy-catalog': 'GET', 'local-kit-history': 'GET', 'report-local-kit-history': 'POST', installations: 'GET', installation: 'GET', detail: 'GET',
  'remove-account': 'POST', preview: 'POST', confirm: 'POST', state: 'GET', advance: 'POST', cancel: 'POST',
  tools: 'GET', 'set-tool': 'PUT', 'being-access': 'PUT', 'get-being-access': 'GET', lifecycle: 'POST',
} as const;
/** Renderer-visible protocol paths mirror the corresponding Home API resource names. */
export const CONNECTOR_NETWORK_ROUTES = {
  'app-detail': '/api/v1/me/app-catalog/:release_id',
  'local-kit-bundle': '/api/v1/local-kit-bundles/:release_id/:sha256',
  catalog: '/api/v1/me/app-catalog', 'legacy-catalog': '/api/v1/me/kit-catalog', 'local-kit-history': '/api/v1/me/local-kit-history', 'report-local-kit-history': '/api/v1/me/local-kit-history', installations: '/api/v1/me/kit-installations',
  installation: '/api/v1/me/kit-installations/:installation_id',
  detail: '/api/v1/me/kit-releases/:release_id/connector',
  'remove-account': '/api/v1/me/kit-releases/:release_id/connector-accounts/:connection_id/remove',
  preview: '/api/v1/me/kit-releases/:release_id/connector-preview',
  confirm: '/api/v1/me/kit-connector-enables/:intent_id/confirm',
  state: '/api/v1/me/kit-connector-enables/:intent_id',
  advance: '/api/v1/me/kit-connector-enables/:intent_id/advance',
  cancel: '/api/v1/me/kit-connector-enables/:intent_id/cancel',
  tools: '/api/v1/me/kit-installations/:installation_id/connector-tools',
  'set-tool': '/api/v1/me/kit-installations/:installation_id/connector-tools',
  'being-access': '/api/v1/me/kit-installations/:installation_id/being-access',
  'get-being-access': '/api/v1/me/kit-installations/:installation_id/being-access',
  lifecycle: '/api/v1/me/kit-installations/:installation_id/actions',
} as const;
export function connectorNetworkPath(operation: keyof typeof CONNECTOR_NETWORK_ROUTES, args: unknown[]) {
  const value = (name: string) => {
    const value = args.shift();
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 无效。`);
    return encodeURIComponent(value);
  };
  let path: string = CONNECTOR_NETWORK_ROUTES[operation];
  for (const name of ['installation_id', 'release_id', 'connection_id', 'intent_id', 'sha256']) {
    const token = ':' + name;
    if (path.includes(token)) path = path.replace(token, value(name));
  }
  return path;
}
export interface HomeConnectorAPI {
  appDetail(releaseId: string): Promise<HomeAppDetail>;
  catalog(query?: { q?: string; after?: string }): Promise<HomeConnectorCatalogPage>;
  localKitHistory(after?: string): Promise<HomeLocalKitHistoryPage>;
  reportLocalKitHistory(input: { source_id: string; version: string }): Promise<HomeLocalKitHistory>;
  installations(after?: string): Promise<HomeConnectorInstallationPage>;
  installation(installationId: string): Promise<HomeConnectorInstallation>;
  removeAccount(releaseId: string, connectionId: string): Promise<void>;
  detail(releaseId: string): Promise<HomeConnectorDetail>;
  preview(releaseId: string, input: { connection_id?: string; method?: string; reauthorize?: boolean }): Promise<HomeConnectorPreview>;
  confirm(intentId: string, input: { adopt: boolean; values?: Record<string, string> }): Promise<HomeConnectorEnableState>;
  state(intentId: string): Promise<HomeConnectorEnableState>;
  advance(intentId: string): Promise<HomeConnectorEnableState>;
  cancel(intentId: string): Promise<HomeConnectorEnableState>;
  openAuthorization(url: string): Promise<void>;
  tools(installationId: string): Promise<HomeConnectorTool[]>;
  setTool(installationId: string, input: { component_id: string; connection_id: string; export: string; contract_digest: string; request_id: string; expected_revision: number; enabled: boolean; confirm_write: boolean }): Promise<HomeConnectorTool>;
  beingAccess(installationId: string): Promise<HomeConnectorBeingAccess>;
  setBeingAccess(installationId: string, enabled: boolean, expectedRevision: number): Promise<HomeConnectorBeingAccess>;
  lifecycle(installationId: string, action: 'enable' | 'disable' | 'uninstall', expectedRevision: number, requestId?: string): Promise<{ accepted: true } | { accepted: false; message: string }>;
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

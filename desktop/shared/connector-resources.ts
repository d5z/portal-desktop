import { workspacePath } from './being-files';
import type { HomeConnectorEnableState } from './home';

export interface WeixinQR {
  state: 'waiting' | 'scanned' | 'needs_verification' | 'connecting' | 'ready' | 'expired' | 'cancelled' | 'failed';
  qr_content?: string | null;
  expires_at: string;
  session_id: string;
  error_code?: string | null;
  enable: HomeConnectorEnableState | null;
}
export interface ConnectorImport {
  import_id: string;
  state: 'pending' | 'copying' | 'write_unknown' | 'ready' | 'failed' | 'deleting' | 'delete_unknown' | 'deleted';
  path: string | null;
  name?: string;
  size_bytes?: number;
  sha256?: string | null;
  error_code?: string | null;
}
export type ConnectorImportReceipt = ConnectorImport | { import_id: string; state?: undefined };
export interface ConnectorContext { session: number; endpoint: string; account: string; canWriteFiles: boolean }
export interface ConnectorAccess {
  context(): Promise<ConnectorContext>;
  access(): Promise<string>;
}
export interface ConnectorResources {
  context(): Promise<ConnectorContext>;
  request<T>(context: ConnectorContext, path: string, method?: 'GET' | 'POST' | 'DELETE', body?: unknown, signal?: AbortSignal): Promise<T>;
}
/** These fixed resources preserve the Home paths; no arbitrary forwarding. */
export function connectorResourceMethods(path: string): readonly string[] | undefined {
  if (/^\/v1\/me\/kit-connector-enables\/[^/]+\/weixin-qr$/.test(path)) return ['GET', 'POST', 'DELETE'];
  if (/^\/v1\/me\/kit-connector-enables\/[^/]+\/weixin-qr\/(advance|verify)$/.test(path)) return ['POST'];
  if (/^\/v1\/me\/connector-imports\/[^/]+$/.test(path)) return ['GET', 'DELETE'];
  if (/^\/v1\/me\/connector-imports\/[^/]+\/retry$/.test(path)) return ['POST'];
  if (/^\/v1\/me\/kit-installations\/[^/]+\/actions$/.test(path)) return ['POST'];
  if (/^\/v1\/me\/kit-releases\/[^/]+\/connector-accounts\/[^/]+\/remove$/.test(path)) return ['POST'];
  if (/^\/v1\/me\/kit-connector-enables\/[^/]+(?:\/(?:advance|cancel))?$/.test(path)) return path.endsWith('/advance') || path.endsWith('/cancel') ? ['POST'] : ['GET'];
  if (/^\/v1\/me\/kit-releases\/[^\/]+\/connector-preview$/.test(path)) return ['POST'];
  if (/^\/v1\/me\/kit-installations\/[^\/]+$/.test(path)) return ['GET'];
  if (path === '/v1\/me\/files/download-reference') return ['POST'];
}

export function isConnectorImportId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

/** Validate untrusted tool metadata once before it enters chat history. */
export function connectorImport(value: unknown): ConnectorImport | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const item = value as Record<string, unknown>;
  if (!isConnectorImportId(item.import_id) ||
      !['pending', 'copying', 'write_unknown', 'ready', 'failed', 'deleting', 'delete_unknown', 'deleted'].includes(String(item.state))) return;
  let path: string | null = null;
  if (typeof item.path === 'string') { try { path = workspacePath(item.path); } catch { return; } }
  return { import_id: item.import_id, state: item.state as ConnectorImport['state'], path,
    ...(typeof item.name === 'string' ? { name: item.name } : {}),
    ...(typeof item.size_bytes === 'number' && Number.isSafeInteger(item.size_bytes) && item.size_bytes >= 0 ? { size_bytes: item.size_bytes } : {}),
    ...(typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(item.sha256) ? { sha256: item.sha256 } : {}),
    ...(typeof item.error_code === 'string' && /^[a-zA-Z0-9_.-]{1,160}$/.test(item.error_code) ? { error_code: item.error_code } : {}),
  };
}

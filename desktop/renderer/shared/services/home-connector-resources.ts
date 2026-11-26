import { rememberConnectorImport } from './connector-workspace-store';
import { connectorImport, connectorResourceMethods, type ConnectorAccess, type ConnectorContext, type ConnectorResources, type WeixinQR } from '../../../shared/connector-resources';

const importReads = new Map<string, Promise<unknown>>();

/** IPC supplies local access credentials; business requests stay visible in Network. */
export function homeConnectorResources(access: ConnectorAccess): ConnectorResources {
  async function request<T>(context: ConnectorContext, path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    if (!connectorResourceMethods(path)?.includes(method)) throw new Error('不支持的 Connector 资源。');
    const key = await access.access();
    const response = await fetch(`beings://desktop${path}`, { method, signal, credentials: 'omit', cache: 'no-store',
      headers: { 'X-Connector-Access': key, 'X-Home-Session': String(context.session), 'X-Home-Endpoint': context.endpoint,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    let value: any;
    try { value = text ? JSON.parse(text) : undefined; } catch { if (response.ok) throw new Error('Connector 返回无效响应。'); }
    if (!response.ok) {
      const code = typeof value?.error === 'string' ? value.error : undefined;
      const message = path.includes('/weixin-qr')
        ? `HTTP ${response.status}${code && /^[a-zA-Z0-9_.-]{1,80}$/.test(code) ? ` · ${code}` : ''}`
        : code || `请求失败（HTTP ${response.status}）`;
      throw Object.assign(new Error(message), { status: response.status });
    }
    if (method === 'GET' && path.startsWith('/v1/me/connector-imports/')) {
      const parsed = connectorImport(value);
      if (!parsed || parsed.import_id !== decodeURIComponent(path.split('/').at(-1)!)) throw new Error('工作区保存状态响应无效。');
      rememberConnectorImport(context, parsed);
      return parsed as unknown as T;
    }
    if (path.includes('/weixin-qr') && method !== 'DELETE') {
      if (!value || !['waiting', 'scanned', 'needs_verification', 'connecting', 'ready', 'expired', 'cancelled', 'failed'].includes(value.state) ||
          typeof value.session_id !== 'string' || !Number.isFinite(Date.parse(value.expires_at))) throw new Error('微信扫码会话响应无效。');
      const enable = value.enable;
      if (enable != null && (enable.id !== decodeURIComponent(path.split('/')[4]) || typeof enable.release_id !== 'string' ||
          !['awaiting_account', 'needs_auth', 'preparing', 'ready', 'paused', 'failed', 'unknown', 'cancelled', 'expired'].includes(enable.status) ||
          (enable.status === 'ready' && (typeof enable.connection_id !== 'string' || !enable.connection_id || typeof enable.installation_id !== 'string' || !enable.installation_id)))) throw new Error('微信连接状态响应无效。');
      // Home may omit enable until the user confirms the scan.
      const qr: WeixinQR = { state: value.state, session_id: value.session_id, expires_at: value.expires_at,
        qr_content: typeof value.qr_content === 'string' ? value.qr_content : null,
        error_code: typeof value.error_code === 'string' && /^[a-zA-Z0-9_.-]{1,160}$/.test(value.error_code) ? value.error_code : null,
        enable: enable == null ? null : { id: enable.id, release_id: enable.release_id, status: enable.status,
          connection_id: enable.connection_id, installation_id: enable.installation_id } };
      return qr as unknown as T;
    }
    return value as T;
  }
  return {
    context: () => access.context(),
    request<T>(context: ConnectorContext, path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
      if (method !== 'GET' || !path.startsWith('/v1/me/connector-imports/') || signal) return request<T>(context, path, method, body, signal);
      const key = JSON.stringify([context.session, context.endpoint, context.account, path]);
      const pending = importReads.get(key);
      if (pending) return pending as Promise<T>;
      const flight = request<T>(context, path).finally(() => importReads.delete(key));
      importReads.set(key, flight);
      return flight;
    },
  };
}

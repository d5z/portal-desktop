import { randomUUID } from 'node:crypto';
import type {
  HomeConnectorAPI, HomeConnectorBeingAccess, HomeConnectorCatalogPage, HomeConnectorDetail, HomeConnectorEnableState,
  HomeConnectorInstallation, HomeConnectorInstallationPage, HomeConnectorPreview, HomeConnectorTool, HomeLocalKitHistory, HomeLocalKitHistoryPage, HomeAppDetail,
} from '../../shared/home';
import type { HomeClient } from './client';
import { HomeError, homeURL } from './protocol';
import { MAX_LOCAL_KIT_BUNDLE } from '../../shared/home';

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function requiredId(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 无效。`);
  return value;
}

function utf8Prefix(value: string, limit: number) {
  let result = '';
  for (const character of value) {
    const next = result + character;
    if (Buffer.byteLength(next, 'utf8') > limit) break;
    result = next;
  }
  return result;
}

/** Home Connector transport. Credential submissions go directly to Home and are never stored. */
export class HomeConnectors implements HomeConnectorAPI {
  private localDetails = new Map<string, { session: number; detail: Extract<HomeAppDetail, { kind: 'local_kit' }> }>();
  constructor(private client: HomeClient, private openExternal: (url: string) => Promise<void>) {}

  private iconURL(value: string | null | undefined) {
    if (!value) return value ?? null;
    try { return new URL(value, homeURL('/')).href; }
    catch { return null; }
  }

  async catalog(query: { q?: string; after?: string } = {}) {
    const response = await this.catalogResponse(query);
    const page = await response.json() as HomeConnectorCatalogPage;
    if (!page || !Array.isArray(page.items)) throw new Error('统一应用目录响应无效。');
    return { ...page, items: page.items.map(item => ({ ...item, icon_url: this.iconURL(item.icon_url) })) };
  }

  catalogResponse(query: { q?: string; after?: string } = {}, legacy = false) {
    const params = new URLSearchParams({ limit: '12' });
    if (query.q?.trim()) params.set('q', utf8Prefix(query.q.trim(), 100));
    if (query.after) params.set('after', requiredId(query.after, '分页游标'));
    const resource = legacy ? 'kit-catalog' : 'app-catalog';
    return this.client.request<Response>(`/v1/me/${resource}?${params}`, {}, async response => new Response(await response.arrayBuffer(), {
      status: response.status, headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json' },
    }));
  }

  localKitHistory(after?: string) {
    const params = new URLSearchParams({ limit: '12' });
    if (after) params.set('after', requiredId(after, '分页游标'));
    return this.client.request<HomeLocalKitHistoryPage>('/v1/me/local-kit-history?' + params.toString());
  }

  reportLocalKitHistory(input: { source_id: string; version: string }) {
    const sourceId = requiredId(input.source_id, 'source_id');
    const version = requiredId(input.version, 'version');
    if (Buffer.byteLength(sourceId, 'utf8') > 256 || Buffer.byteLength(version, 'utf8') > 256) throw new Error('本机 Kit 历史字段过长。');
    return this.client.request<HomeLocalKitHistory>('/v1/me/local-kit-history', {
      ...json({ source_id: sourceId, version }),
    });
  }

  installations(after?: string) {
    const params = new URLSearchParams({ limit: '50' });
    if (after) params.set('after', requiredId(after, '分页游标'));
    return this.client.request<HomeConnectorInstallationPage>('/v1/me/kit-installations?' + params.toString());
  }

  detail(releaseId: string) {
    return this.client.request<HomeConnectorDetail>('/v1/me/kit-releases/' + encodeURIComponent(requiredId(releaseId, 'release_id')) + '/connector').then(detail => ({
      ...detail, icon_url: this.iconURL(detail.icon_url),
    }));
  }

  appDetailResponse(releaseId: string) {
    const session = this.client.sessionVersion;
    return this.client.request<Response>('/v1/me/app-catalog/' + encodeURIComponent(requiredId(releaseId, 'release_id')), {}, async response => {
      const body = await response.text();
      // Bind installation to metadata actually received by main, never renderer-supplied commands or hashes.
      const detail = JSON.parse(body) as HomeAppDetail;
      if (detail.kind === 'local_kit') this.localDetails.set(releaseId, { session, detail });
      else this.localDetails.delete(releaseId);
      return new Response(body, { status: response.status, headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json' } });
    });
  }

  localKitSource(releaseId: string) {
    const source = this.localDetails.get(releaseId);
    if (!this.client.authenticated || !source || source.session !== this.client.sessionVersion) throw new Error('Home 登录或安装信息已变化，请重新准备安装。');
    return source.detail;
  }

  async appDetail(releaseId: string): Promise<HomeAppDetail> {
    return (await this.appDetailResponse(releaseId)).json();
  }

  bundleResponse(releaseId: string, sha256: string) {
    if (!/^[0-9a-f-]{36}$/i.test(releaseId) || !/^[0-9a-f]{64}$/.test(sha256)) throw new HomeError(400, 'invalid_request');
    // Public archive: raw deliberately bypasses HomeClient.request's Bearer token.
    return this.client.raw<Response>(`/v1/local-kit-bundles/${releaseId}/${sha256}`, { credentials: 'omit', headers: { Accept: 'application/gzip' } }, async (response, progress) => {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Kit 下载内容为空。');
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_LOCAL_KIT_BUNDLE) throw new Error('Kit 压缩包超过 64 MB。');
          chunks.push(value); progress();
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
    });
  }

  installation(installationId: string) {
    return this.client.request<HomeConnectorInstallation>('/v1/me/kit-installations/' + encodeURIComponent(requiredId(installationId, 'installation_id')));
  }

  removeAccount(releaseId: string, connectionId: string) {
    return this.client.request<void>('/v1/me/kit-releases/' + encodeURIComponent(requiredId(releaseId, 'release_id')) + '/connector-accounts/' + encodeURIComponent(requiredId(connectionId, 'connection_id')) + '/remove', { method: 'POST' });
  }

  preview(releaseId: string, input: { connection_id?: string; method?: string; reauthorize?: boolean }) {
    if (Boolean(input.connection_id) === Boolean(input.method)) throw new Error('请选择已有账号或新的认证方式。');
    const body = input.connection_id ? { connection_id: requiredId(input.connection_id, 'connection_id'), ...(input.reauthorize ? { reauthorize: true } : {}) } : { method: requiredId(input.method, '认证方式') };
    return this.client.request<HomeConnectorPreview>('/v1/me/kit-releases/' + encodeURIComponent(requiredId(releaseId, 'release_id')) + '/connector-preview', {
      ...json(body),
    });
  }

  confirm(intentId: string, input: { adopt: boolean; values?: Record<string, string> }) {
    const values = input.values && Object.fromEntries(Object.entries(input.values).filter(([key, value]) => key.trim() && typeof value === 'string'));
    return this.client.request<HomeConnectorEnableState>('/v1/me/kit-connector-enables/' + encodeURIComponent(requiredId(intentId, 'intent_id')) + '/confirm', json({ adopt: Boolean(input.adopt), ...(values && Object.keys(values).length ? { values } : {}) }));
  }

  state(intentId: string) {
    return this.client.request<HomeConnectorEnableState>('/v1/me/kit-connector-enables/' + encodeURIComponent(requiredId(intentId, 'intent_id')));
  }

  advance(intentId: string) {
    return this.client.request<HomeConnectorEnableState>('/v1/me/kit-connector-enables/' + encodeURIComponent(requiredId(intentId, 'intent_id')) + '/advance', { method: 'POST' });
  }

  cancel(intentId: string) {
    return this.client.request<HomeConnectorEnableState>('/v1/me/kit-connector-enables/' + encodeURIComponent(requiredId(intentId, 'intent_id')) + '/cancel', { method: 'POST' });
  }

  async openAuthorization(url: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error('授权地址无效。');
    await this.openExternal(parsed.href);
  }

  tools(installationId: string) {
    return this.client.request<HomeConnectorTool[]>('/v1/me/kit-installations/' + encodeURIComponent(requiredId(installationId, 'installation_id')) + '/connector-tools');
  }

  setTool(installationId: string, input: { component_id: string; connection_id: string; export: string; contract_digest: string; request_id: string; expected_revision: number; enabled: boolean; confirm_write: boolean }) {
    return this.client.request<HomeConnectorTool>('/v1/me/kit-installations/' + encodeURIComponent(requiredId(installationId, 'installation_id')) + '/connector-tools', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        component_id: requiredId(input.component_id, 'component_id'), connection_id: requiredId(input.connection_id, 'connection_id'),
        export: requiredId(input.export, 'export'), contract_digest: requiredId(input.contract_digest, 'contract_digest'),
        request_id: requiredId(input.request_id || randomUUID(), 'request_id'), expected_revision: input.expected_revision,
        enabled: Boolean(input.enabled), confirm_write: Boolean(input.confirm_write),
      }),
    });
  }

  beingAccess(installationId: string) {
    return this.client.request<HomeConnectorBeingAccess>(`/v1/me/kit-installations/${encodeURIComponent(requiredId(installationId, 'installation_id'))}/being-access`);
  }

  setBeingAccess(installationId: string, enabled: boolean, expectedRevision: number) {
    return this.client.request<HomeConnectorBeingAccess>(`/v1/me/kit-installations/${encodeURIComponent(requiredId(installationId, 'installation_id'))}/being-access`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: Boolean(enabled), expected_revision: expectedRevision }),
    });
  }

  async lifecycle(installationId: string, action: 'enable' | 'disable' | 'uninstall', expectedRevision: number, requestId: string = randomUUID()): ReturnType<HomeConnectorAPI['lifecycle']> {
    try {
      await this.client.request(`/v1/me/kit-installations/${encodeURIComponent(requiredId(installationId, 'installation_id'))}/actions`, {
        ...json({ action, expected_revision: expectedRevision, request_id: requiredId(requestId, 'request_id') }),
      });
      return { accepted: true };
    } catch (error) {
      // HTTP 409 rejects this operation; transport failures may have committed it.
      if (error instanceof HomeError && error.status === 409) return { accepted: false, message: error.message };
      throw error;
    }
  }
}

import { randomUUID } from 'node:crypto';
import type {
  HomeConnectorAPI, HomeConnectorBeingAccess, HomeConnectorCatalogPage, HomeConnectorDetail, HomeConnectorEnableState,
  HomeConnectorInstallation, HomeConnectorInstallationPage, HomeConnectorPreview, HomeConnectorTool, HomeConnectorSkillBody, HomeLocalKitHistory, HomeLocalKitHistoryPage,
} from '../../shared/home';
import type { HomeClient } from './client';
import { HomeError, homeURL } from './protocol';

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
  constructor(private client: HomeClient, private openExternal: (url: string) => Promise<void>) {}

  forward(request: Request, sessionVersion: number) {
    const url = new URL(request.url);
    return request.text().then(body => this.client.forward(url.pathname.slice('/api'.length) + url.search, {
      method: request.method,
      headers: request.headers.has('Content-Type') ? { 'Content-Type': request.headers.get('Content-Type')! } : {},
      ...(body ? { body } : {}),
    }, sessionVersion));
  }

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

  skill(releaseId: string, skill: string) {
    return this.client.request<HomeConnectorSkillBody>('/v1/me/kit-releases/' + encodeURIComponent(requiredId(releaseId, 'release_id')) + '/connector-skills/' + encodeURIComponent(requiredId(skill, 'skill')));
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

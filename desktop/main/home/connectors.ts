import { randomUUID } from 'node:crypto';
import type {
  HomeConnectorAPI, HomeConnectorCatalogPage, HomeConnectorDetail, HomeConnectorEnableState,
  HomeConnectorFlow, HomeConnectorInstallationPage, HomeConnectorPreview, HomeConnectorSelectionOptions, HomeConnectorTool,
} from '../../shared/home';
import type { HomeClient } from './client';

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

function flowState(flow: HomeConnectorFlow): HomeConnectorEnableState {
  return {
    id: flow.id,
    revision: flow.revision,
    release_id: flow.release_id,
    status: flow.status,
    installation_id: flow.installation_id,
    connection_id: flow.connection_id,
    authorization_url: flow.authorization_url,
  };
}

/** Home Connector transport. Credentials never enter this object or local storage. */
export class HomeConnectors implements HomeConnectorAPI {
  constructor(private client: HomeClient, private openExternal: (url: string) => Promise<void>) {}

  catalog(query: { q?: string; after?: string } = {}) {
    const params = new URLSearchParams({ limit: '20' });
    if (query.q?.trim()) params.set('q', utf8Prefix(query.q.trim(), 100));
    if (query.after) params.set('after', requiredId(query.after, '分页游标'));
    return this.client.request<HomeConnectorCatalogPage>('/v1/me/kit-catalog?' + params.toString());
  }

  installations(after?: string) {
    const params = new URLSearchParams({ limit: '50' });
    if (after) params.set('after', requiredId(after, '分页游标'));
    return this.client.request<HomeConnectorInstallationPage>('/v1/me/kit-installations?' + params.toString());
  }

  detail(releaseId: string) {
    return this.client.request<HomeConnectorDetail>('/v1/me/kit-releases/' + encodeURIComponent(requiredId(releaseId, 'release_id')) + '/connector');
  }

  async startOAuth(releaseId: string, installationId?: string) {
    const id = requiredId(releaseId, 'release_id');
    const options = await this.client.request<HomeConnectorSelectionOptions>('/v1/me/kit-releases/' + encodeURIComponent(id) + '/installation-options' + (installationId ? '?installation_id=' + encodeURIComponent(requiredId(installationId, 'installation_id')) : ''));
    const node = options.nodes.find(item => item.accounts.length > 0);
    const requirement = node?.accounts.find(item => item.required) || node?.accounts[0];
    if (!node || !requirement) throw new Error('此应用没有可连接的 OAuth2 账号需求。');
    const flow = await this.client.request<HomeConnectorFlow>('/v1/me/kit-connection-flows', json({
      request_id: randomUUID(), release_id: options.release_id || id, installation_id: options.installation?.id,
      dependency_path: node.dependency_path, requirement: requirement.id, auth_type: 'oauth2',
    }));
    return flowState(flow);
  }

  async syncOAuth(intentId: string, expectedRevision: number) {
    const flow = await this.client.request<HomeConnectorFlow>('/v1/me/kit-connection-flows/' + encodeURIComponent(requiredId(intentId, 'flow_id')) + '/sync', json({ expected_revision: expectedRevision }));
    return flowState(flow);
  }

  async oauthState(intentId: string) {
    const flow = await this.client.request<HomeConnectorFlow>('/v1/me/kit-connection-flows/' + encodeURIComponent(requiredId(intentId, 'flow_id')));
    return flowState(flow);
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

  setBeingAccess(installationId: string, enabled: boolean, expectedRevision: number) {
    return this.client.request(`/v1/me/kit-installations/${encodeURIComponent(requiredId(installationId, 'installation_id'))}/being-access`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: Boolean(enabled), expected_revision: expectedRevision }),
    });
  }

  lifecycle(installationId: string, action: 'enable' | 'disable' | 'uninstall', expectedRevision: number) {
    return this.client.request(`/v1/me/kit-installations/${encodeURIComponent(requiredId(installationId, 'installation_id'))}/actions`, {
      ...json({ action, expected_revision: expectedRevision, request_id: randomUUID() }),
    });
  }
}

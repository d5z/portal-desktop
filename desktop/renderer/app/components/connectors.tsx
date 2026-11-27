import { homeConnectorResources } from '../../shared/services/home-connector-resources';
import { WeixinPairing } from './weixin-pairing';
import { WeixinAutoChannelSettingsCard } from './weixin-auto-channel';
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  HomeConnectorAccount, HomeConnectorBeingAccess, HomeConnectorCatalogItem, HomeConnectorDetail, HomeConnectorEnableState,
  HomeConnectorInstallation, HomeConnectorPreview, HomeConnectorTool, HomeLocalKitDetail,
} from '../../../shared/home';
import type { AppModel } from '../models/app';
import type { LocalKit } from '../../../shared/types';
import { Icon } from '../../shared/icons/icon';
import type { SettingsDetail } from '../../shared/components/settings-surface';
import { ConnectorIcon } from './connector-icon';
import { publicErrorMessage } from '../../../shared/errors';
import { useModel } from '../../shared/hooks/use-model';

const pendingStatuses = ['awaiting_account', 'preparing', 'unknown'];
const statusLabels = {
  awaiting_account: '等待账号授权', preparing: '正在准备工具', ready: '工具已就绪',
  needs_auth: '需要重新连接', paused: '工具已暂停', failed: '连接或工具准备失败',
  unknown: '结果待确认', expired: '连接已过期', cancelled: '连接已取消',
  degraded: '部分工具运行异常', waiting_device: '等待运行设备连接',
  unsupported_auth_channel: '当前运行环境不支持此认证方式', blocked: '工具运行被阻止',
  disabled: '工具已暂停', removed: '应用已移除',
} satisfies Record<HomeConnectorInstallation['status'] | HomeConnectorEnableState['status'], string>;
const statusLabel = (status: HomeConnectorInstallation['status'] | HomeConnectorEnableState['status']) => statusLabels[status] || '状态待确认';
const runtimeTabLabel = (runtime: string) => runtime === 'local' ? '本地' : '云端';
const hasLocalRuntime = (kit: HomeConnectorCatalogItem) => (kit.runtimes || []).includes('local');
const hasRemoteRuntime = (kit: HomeConnectorCatalogItem) => (kit.runtimes || []).some(runtime => runtime === 'shared' || runtime === 'cloud');
const isLocalKit = (kit: HomeConnectorCatalogItem) => kit.local_install === undefined
  ? hasLocalRuntime(kit) && !hasRemoteRuntime(kit)
  : kit.local_install?.kind === 'town';
const localSourceId = (kit: HomeConnectorCatalogItem) => kit.local_install?.source_id
  || (kit.local_install === undefined && hasLocalRuntime(kit) ? kit.kit_id : undefined);
const localKitFor = (kit: HomeConnectorCatalogItem, localKits: LocalKit[]) => localKits.find(item => item.installSource?.releaseId === kit.release_id || Boolean(localSourceId(kit) && item.installSource?.sourceId === localSourceId(kit)) || item.name === kit.kit_id || item.name === kit.name);
const localKitDetail = (kit: HomeConnectorCatalogItem): HomeConnectorDetail => ({ name: kit.name, icon_url: kit.icon_url, skills: [], accounts: [], methods: [] });
const toolKey = (tool: Pick<HomeConnectorTool, 'component_id' | 'connection_id' | 'export'>) => `${tool.component_id}:${tool.connection_id}:${tool.export}`;
// Older catalog details omit pairing even when the permission preview identifies Weixin Bot.
const isWeixinPreview = (preview: HomeConnectorPreview) =>
  preview.read_actions.includes('weixin_bot.get_updates') && preview.write_actions.includes('weixin_bot.send_message');
type ToggleTool = (installationId: string, tool: HomeConnectorTool, enabled: boolean) => void;

// Use the same installation for the account badge, tool list and tool mutations.
function accountInstallation(account: HomeConnectorAccount | undefined, installations: HomeConnectorInstallation[]) {
  if (!account) return;
  const current = installations.filter(item => account.installation_ids.includes(item.id) && item.desired_state !== 'removed');
  return current.find(item => item.desired_state === 'enabled' && item.status === 'ready')
    || current.find(item => item.desired_state === 'enabled') || current[0];
}

export function ConnectorSettings({ model, onDetailChange }: { model: AppModel; onDetailChange?: (detail: SettingsDetail | null) => void }) {
  const api = model.api.home?.connectors;
  const resources = useMemo(() => model.api.home?.connectorResources ? homeConnectorResources(model.api.home.connectorResources) : undefined, [model.api.home?.connectorResources]);
  const town = useModel(model.town);
  const [authenticated, setAuthenticated] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [catalogEnabled, setCatalogEnabled] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [pendingConnection, setPendingConnection] = useState<string>();
  const [catalog, setCatalog] = useState<HomeConnectorCatalogItem[]>([]);
  const [localKits, setLocalKits] = useState<LocalKit[]>([]);
  const [localKitsReady, setLocalKitsReady] = useState(false);
  const [localKitsError, setLocalKitsError] = useState('');
  const [installations, setInstallations] = useState<HomeConnectorInstallation[]>([]);
  const installationsRef = useRef<HomeConnectorInstallation[]>([]);
  const [query, setQuery] = useState('');
  const [runtimeFilter, setRuntimeFilter] = useState<'all' | 'local' | 'cloud'>('all');
  const [preparingSourceId, setPreparingSourceId] = useState<string>();
  const [selected, setSelected] = useState<HomeConnectorCatalogItem>();
  const [detail, setDetail] = useState<HomeConnectorDetail>();
  const [localDetail, setLocalDetail] = useState<HomeLocalKitDetail>();
  const [accountId, setAccountId] = useState<string>();
  const qrActive = useRef(false);
  const homeIdentity = useRef<string | undefined>(undefined);
  const [homeContextVersion, setHomeContextVersion] = useState<string>();
  const [qrTarget, setQRTarget] = useState<{ kit: HomeConnectorCatalogItem; account?: HomeConnectorAccount; preview?: HomeConnectorPreview }>();
  const [preview, setPreview] = useState<HomeConnectorPreview>();
  const [flow, setFlow] = useState<HomeConnectorEnableState>();
  const [tools, setTools] = useState<HomeConnectorTool[]>();
  const [toolBusy, setToolBusy] = useState<Set<string>>(new Set());
  const [installationAccess, setBeingAccess] = useState<{ installationId: string; access: HomeConnectorBeingAccess }>();
  const [method, setMethod] = useState<string>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [adopt, setAdopt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState('');
  const navigation = useRef(0);
  const catalogRequest = useRef(0);
  const toolRequest = useRef(0);
  const toolsCache = useRef(new Map<string, { tools: HomeConnectorTool[]; access: HomeConnectorBeingAccess }>());
  const toolsInstallation = useRef<string | undefined>(undefined);
  const toolsLoadingInstallation = useRef<string | undefined>(undefined);
  const toolsAccount = useRef<string | undefined>(undefined);
  const toolToggleRef = useRef<ToggleTool>(() => {});
  const page = useRef<HomeConnectorCatalogItem | undefined>(undefined);
  // Keep in-flight enables when navigating back: OAuth completion still needs /advance.
  const pending = useRef(new Map<string, { state: HomeConnectorEnableState; polls: number }>());
  const finished = useRef(new Set<string>());
  const lifecycleRequests = useRef(new Map<string, { id: string; revision: number }>());
  const removals = useRef(new Map<string, Map<string, HomeConnectorAccount>>());
  const preferredAccounts = useRef(new Map<string, string>());
  const syncing = useRef<Promise<boolean> | undefined>(undefined);
  const poll = useRef<(force?: boolean) => void>(() => {});
  const mutating = useRef(false);
  const localKitsRequest = useRef(0);
  const pendingKey = (id: string) => `portal.home.connector.intent.${id}`;

  const restorePending = async () => {
    if (!api) return;
    const ids = Object.keys(localStorage).filter(key => key.startsWith('portal.home.connector.intent.'));
    await Promise.all(ids.map(async key => {
      const id = localStorage.getItem(key);
      if (!id || pending.current.has(id)) return;
      try {
        const state = await api.state(id);
        if (pendingStatuses.includes(state.status)) {
          pending.current.set(id, { state, polls: 0 });
          localStorage.setItem(pendingKey(id), id);
        } else finished.current.add(id);
        if (key !== pendingKey(id) || !pendingStatuses.includes(state.status)) localStorage.removeItem(key);
      } catch { /* Keep the intent for the next focus/retry after a network failure. */ }
    }));
  };

  const loadTools = async (installationId: string, force = false) => {
    if (!api) return;
    if (toolsLoadingInstallation.current === installationId && !force) return;
    const cached = toolsCache.current.get(installationId);
    if (!force && cached) {
      if (toolsInstallation.current !== installationId) {
        ++toolRequest.current;
        toolsLoadingInstallation.current = undefined;
      }
      toolsInstallation.current = installationId;
      setTools(cached.tools);
      setBeingAccess({ installationId, access: cached.access });
      setToolsError('');
      setToolsLoading(false);
      return;
    }
    const request = ++toolRequest.current;
    toolsLoadingInstallation.current = installationId;
    if (toolsInstallation.current !== installationId) {
      setTools(undefined);
      setBeingAccess(undefined);
    }
    setToolsLoading(true); setToolsError('');
    try {
      const [result, access] = await Promise.all([api.tools(installationId), api.beingAccess(installationId)]);
      if (request === toolRequest.current) {
        toolsCache.current.set(installationId, { tools: result, access });
        toolsInstallation.current = installationId;
        setTools(result); setBeingAccess({ installationId, access });
      }
    }
    catch (e) { if (request === toolRequest.current) setToolsError(publicErrorMessage(e, '无法读取工具设置。')); }
    finally {
      if (request === toolRequest.current && toolsLoadingInstallation.current === installationId) {
        toolsLoadingInstallation.current = undefined;
        setToolsLoading(false);
      }
    }
  };

  const activeAccount = detail?.accounts.find(account => account.id === accountId);
  const activeInstallation = accountInstallation(activeAccount, installations);
  const activeInstallationId = activeInstallation?.id;
  const beingAccess = installationAccess?.installationId === activeInstallationId ? installationAccess?.access : undefined;
  useEffect(() => {
    if (!town.prepareBusy && !town.plan) setPreparingSourceId(undefined);
  }, [town.prepareBusy, town.plan]);
  useEffect(() => {
    if (activeInstallationId) {
      const accountChanged = toolsAccount.current !== undefined && toolsAccount.current !== accountId;
      toolsAccount.current = accountId;
      void loadTools(activeInstallationId, accountChanged);
    }
    else {
      ++toolRequest.current;
      toolsInstallation.current = undefined;
      toolsLoadingInstallation.current = undefined;
      setTools(undefined); setBeingAccess(undefined); setToolsError(''); setToolsLoading(false);
    }
  }, [api, activeInstallationId, accountId]);

  const chooseAccount = (account?: HomeConnectorAccount) => {
    setAccountId(account?.id);
    if (account && page.current) preferredAccounts.current.set(page.current.release_id, account.id);
  };

  const refreshDetail = async (releaseId: string, preferredAccount?: string) => {
    const request = navigation.current;
    if (page.current && isLocalKit(page.current)) {
      const result = await api!.appDetail(releaseId);
      if (request !== navigation.current || page.current?.release_id !== releaseId) return;
      if (result.kind !== 'local_kit') throw new Error('应用类型已变化，请返回列表刷新。');
      page.current = result.app; setSelected(result.app);
      setLocalDetail(result.local_kit); setDetail(localKitDetail(result.app));
      return;
    }
    const result = await api!.detail(releaseId);
    if (request !== navigation.current || page.current?.release_id !== releaseId) return;
    setDetail(result);
    const preferred = result.accounts.find(account => account.id === preferredAccount)
      || result.accounts.find(account => account.usable && account.installation_ids.some(id => installationsRef.current.some(item => item.id === id && item.desired_state !== 'removed')))
      || [...result.accounts].reverse().find(account => account.installation_ids.length > 0)
      || result.accounts.find(account => account.usable) || result.accounts[0];
    chooseAccount(preferred);
    // Home is authoritative even when this device has no saved intent.
    for (const account of result.accounts) if (account.enable_id && !pending.current.has(account.enable_id) && !finished.current.has(account.enable_id)) {
      const state: HomeConnectorEnableState = { id: account.enable_id, release_id: releaseId, connection_id: account.id, installation_id: null, status: 'awaiting_account' };
      pending.current.set(state.id, { state, polls: 0 });
      localStorage.setItem(pendingKey(state.id), state.id);
    }
    return result;
  };

  const synchronize = (force = false): Promise<boolean> => {
    if (syncing.current) return syncing.current;
    const request = navigation.current;
    syncing.current = (async () => {
      let changed = false;
      for (const [id, entry] of pending.current) {
        if (!force && entry.polls >= 45) continue;
        entry.polls++;
        let next: HomeConnectorEnableState;
        try { next = entry.state.installation_id ? await api!.state(id) : await api!.advance(id); }
        catch (e) {
          if (page.current?.release_id === entry.state.release_id) setError(publicErrorMessage(e, '无法更新连接状态，请重试。'));
          continue; // One failed authorization must not block other applications.
        }
        if (pending.current.get(id) !== entry) continue;
        if (next.status !== entry.state.status || next.connection_id !== entry.state.connection_id || next.installation_id !== entry.state.installation_id) changed = true;
        next.authorization_url ||= entry.state.authorization_url;
        entry.state = next;
        if (next.connection_id) preferredAccounts.current.set(next.release_id, next.connection_id);
        if (page.current?.release_id === next.release_id) setFlow(next);
        if (!pendingStatuses.includes(next.status)) {
          finished.current.add(id);
          pending.current.delete(id);
          localStorage.removeItem(pendingKey(next.id));
          changed = true;
          if (next.status === 'ready' && page.current?.release_id === next.release_id && request === navigation.current) { setFlow(undefined); setPreview(current => current?.id === id ? undefined : current); setError(''); }
        }
      }
      return changed;
    })().finally(() => { syncing.current = undefined; });
    return syncing.current;
  };

  const load = async (search = query) => {
    if (!api) return;
    const request = ++catalogRequest.current;
    setCatalogLoading(true); setCatalogError('');
    const localRequest = ++localKitsRequest.current;
    setLocalKitsError('');
    void model.api.localKits().then(result => {
      if (localRequest === localKitsRequest.current) { setLocalKits(result.kits); setLocalKitsReady(true); }
    }).catch(e => {
      if (localRequest === localKitsRequest.current) {
        setLocalKits([]); setLocalKitsReady(false);
        setLocalKitsError(`无法读取本机 Kit：${publicErrorMessage(e, '请检查本机 Kit 配置后重试。')}`);
      }
    });
    try {
      const home = await model.api.home?.state();
      if (request !== catalogRequest.current) return;
      setAuthenticated(Boolean(home?.authenticated));
      setAuthenticating(Boolean(home?.authenticating));
      if (!home?.authenticated) {
        toolsCache.current.clear();
        toolsInstallation.current = undefined;
        setCatalogError(home?.error ? publicErrorMessage(home.error) : ''); setCatalogEnabled(false); setCatalog([]); installationsRef.current = []; setInstallations([]); return;
      }
      const [kits, installed] = await Promise.all([
        (async () => {
          const result = await api.catalog(search ? { q: search } : {});
          const items = [...result.items];
          let after = result.next_after;
          while (after && request === catalogRequest.current) {
            const next = await api.catalog({ q: search, after }); items.push(...next.items); after = next.next_after;
          }
          return { ...result, items };
        })(),
        (async () => {
          const result = await api.installations();
          const items = [...result.items];
          let after = result.next_after;
          while (after && request === catalogRequest.current) {
            const next = await api.installations(after); items.push(...next.items); after = next.next_after;
          }
          return items;
        })(),
      ]);
      if (request !== catalogRequest.current) return;
      installationsRef.current = installed;
      const refreshedSelected = page.current && kits.items.find(item => item.release_id === page.current?.release_id);
      if (refreshedSelected) page.current = refreshedSelected;
      setCatalogEnabled(kits.enabled); setCatalog(kits.items); setInstallations(installed);
      setSelected(current => current && kits.items.find(item => item.release_id === current.release_id) || current);
      return true;
    } catch (e) { if (request === catalogRequest.current) setCatalogError(publicErrorMessage(e, '无法读取应用目录。')); return false; }
    finally { if (request === catalogRequest.current) setCatalogLoading(false); }
  };

  const previousInstallBusy = useRef(false);
  const previousLocalKitsRevision = useRef(town.localKitsRevision);
  useEffect(() => {
    if ((previousInstallBusy.current && !town.installBusy && !town.plan) || previousLocalKitsRevision.current !== town.localKitsRevision) void load();
    previousInstallBusy.current = town.installBusy;
    previousLocalKitsRevision.current = town.localKitsRevision;
  }, [town.installBusy, town.plan, town.localKitsRevision]);

  poll.current = (force = false) => {
    if (mutating.current || qrActive.current) return;
    void synchronize().then(async changed => {
      const preparing = installationsRef.current.some(item => item.root_release_id === page.current?.release_id && item.desired_state === 'enabled' && ['preparing', 'waiting_device', 'unknown'].includes(item.status));
      if (!changed && !force && !preparing) return;
      await load();
      if (page.current) await refreshDetail(page.current.release_id, preferredAccounts.current.get(page.current.release_id));
    }).catch(e => setError(publicErrorMessage(e, '无法更新连接状态，请重试。')));
  };
  useEffect(() => {
    void load('');
    void restorePending().then(() => poll.current());
    let lastAuthenticated: boolean | undefined;
    const unsubscribe = model.api.home?.subscribe(state => {
      setAuthenticating(state.authenticating);
      if (homeIdentity.current !== undefined && state.contextVersion !== undefined && homeIdentity.current !== state.contextVersion) {
        setQRTarget(undefined); toolsCache.current.clear(); ++toolRequest.current;
        toolsInstallation.current = undefined; toolsLoadingInstallation.current = undefined;
        setTools(undefined); setBeingAccess(undefined); setToolsLoading(false);
      }
      homeIdentity.current = state.contextVersion;
      setHomeContextVersion(state.contextVersion);
      if (!state.authenticated || state.authenticating) setQRTarget(undefined);
      if (!state.authenticated && state.error) setCatalogError(publicErrorMessage(state.error));
      if (lastAuthenticated !== state.authenticated) { lastAuthenticated = state.authenticated; void load(''); }
    });
    const timer = window.setInterval(() => poll.current(), 2500);
    const focus = () => { for (const entry of pending.current.values()) entry.polls = 0; void restorePending().then(() => poll.current(true)); };
    window.addEventListener('focus', focus);
    return () => { unsubscribe?.(); clearInterval(timer); window.removeEventListener('focus', focus); navigation.current++; catalogRequest.current++; toolRequest.current++; pending.current.clear(); onDetailChange?.(null); };
  }, [api]);

  useEffect(() => { qrActive.current = Boolean(qrTarget); }, [qrTarget]);

  const back = () => {
    navigation.current++; toolRequest.current++;
    setQRTarget(undefined);
    page.current = undefined;
    setSelected(undefined); setDetail(undefined); setLocalDetail(undefined); setPreview(undefined); setFlow(undefined); setAccountId(undefined);
    setTools(undefined); setError(''); setBusy(false); setToolsLoading(false); setToolsError(''); setPendingConnection(undefined); setValues({});
    onDetailChange?.(null);
    void load();
  };

  const enter = (kit: HomeConnectorCatalogItem) => {
    page.current = kit; setSelected(kit);
    onDetailChange?.({ id: kit.release_id, title: '应用详情', back });
  };

  const openKit = async (kit: HomeConnectorCatalogItem) => {
    if (!api) return;
    const request = ++navigation.current;
    enter(kit); chooseAccount(); setPendingConnection(undefined); setDetail(undefined); setLocalDetail(undefined); setPreview(undefined); setMethod(undefined); setValues({}); setError(''); setBusy(true);
    setFlow([...pending.current.values()].find(entry => entry.state.release_id === kit.release_id)?.state);
    try {
      const next = await refreshDetail(kit.release_id, preferredAccounts.current.get(kit.release_id));
      if (!next || request !== navigation.current) return;
      const option = next.methods.length === 1 ? next.methods[0] : undefined;
      if (next.pairing !== 'weixin_qr' && !next.accounts.length && option && option.method !== 'oauth2' && ![...pending.current.values()].some(entry => entry.state.release_id === kit.release_id)) {
        setMethod(option.method);
        const intent = await api.preview(kit.release_id, { method: option.method });
        if (request === navigation.current) setPreview(intent);
      }
    } catch (e) { if (request === navigation.current) setError(publicErrorMessage(e, '无法读取应用连接选项。')); }
    finally { if (request === navigation.current) setBusy(false); }
  };

  const completeConnection = async (kit: HomeConnectorCatalogItem, intent: HomeConnectorPreview, confirmValues: Record<string, string>, confirmAdopt: boolean, request: number) => {
    // Keep the same preview available for an explicit retry if confirm loses its response.
    enter(kit); setPreview(intent);
    const next = await api!.confirm(intent.id, { adopt: confirmAdopt, values: confirmValues });
    if (pendingStatuses.includes(next.status)) { pending.current.set(next.id, { state: next, polls: 0 }); localStorage.setItem(pendingKey(next.id), next.id); }
    if (next.connection_id) preferredAccounts.current.set(next.release_id, next.connection_id);
    if (request !== navigation.current) return;
    setValues({}); setPreview(undefined); setFlow(next);
    try {
      // A catalog/detail read must not prevent the browser from opening OAuth.
      if (next.status !== 'ready' && next.authorization_url) await api!.openAuthorization(next.authorization_url);
    } finally {
      await load();
      if (request === navigation.current) {
        await refreshDetail(kit.release_id, next.connection_id || undefined);
        if (next.status === 'ready') setFlow(undefined);
      }
    }
  };

  const connect = async (kit: HomeConnectorCatalogItem, account?: HomeConnectorAccount, chosenMethod?: string, forceWeixinQR = false) => {
    if (!api) return;
    const preparedQR = !account && page.current?.release_id === kit.release_id && preview && isWeixinPreview(preview) ? preview : undefined;
    if (page.current?.release_id === kit.release_id && (detail?.pairing === 'weixin_qr' || preparedQR || forceWeixinQR)) {
      if (!resources) { setError('当前客户端不支持微信扫码连接，请更新客户端。'); return; }
      ++navigation.current;
      setPreview(undefined); setFlow(undefined); setValues({}); setError('');
      setQRTarget({ kit, account, preview: preparedQR });
      return;
    }
    const request = ++navigation.current;
    mutating.current = true;
    setPendingConnection(page.current ? undefined : kit.release_id); setFlow(undefined); setBusy(true); setError(''); setPreview(undefined); setValues({}); setAdopt(false);
    try {
      await syncing.current;
      const nextDetail = await api.detail(kit.release_id);
      if (request !== navigation.current) return;
      setDetail(nextDetail);
      if (account) {
        const selectedAccountId = account.id;
        account = nextDetail.accounts.find(item => item.id === selectedAccountId);
        if (!account) { await refreshDetail(kit.release_id); return; }
        chooseAccount(account);
      }
      if (nextDetail.pairing === 'weixin_qr') {
        if (!resources) throw new Error('当前客户端不支持微信扫码连接，请更新客户端。');
        enter(kit); setPreview(undefined); setQRTarget({ kit, account }); return;
      }
      const waiting = !account && [...pending.current.values()].find(entry => entry.state.release_id === kit.release_id);
      if (waiting) {
        const current = await api.state(waiting.state.id);
        if (request !== navigation.current) return;
        if (pendingStatuses.includes(current.status)) {
          waiting.state = { ...current, authorization_url: current.authorization_url || waiting.state.authorization_url };
          waiting.polls = 0;
          enter(kit); setFlow(waiting.state);
          try {
            if (waiting.state.authorization_url && current.status === 'awaiting_account') await api.openAuthorization(waiting.state.authorization_url);
          } finally {
            if (request === navigation.current) await refreshDetail(kit.release_id, current.connection_id || undefined);
          }
          poll.current();
          return;
        }
        pending.current.delete(current.id);
        localStorage.removeItem(pendingKey(current.id));
      }
      const reuseAccount = account?.usable && !account.installation_ids.length;
      const nextMethod = reuseAccount ? undefined : chosenMethod || nextDetail.methods.find(item => item.method === 'oauth2')?.method || nextDetail.methods.find(item => item.method === account?.auth_type)?.method || (nextDetail.methods.length === 1 ? nextDetail.methods[0].method : undefined);
      if (!reuseAccount && !nextMethod) { enter(kit); setDetail(nextDetail); setMethod(''); return; }
      // Reconnect starts fresh authorization; Home consolidates verified identities.
      // Retire uninstalled/default attempts first so stale callbacks cannot revive them.
      if (account && !reuseAccount && !account.installation_ids.length) {
        await removeAccounts(kit, [account]);
        if (request !== navigation.current) return;
        await refreshDetail(kit.release_id);
        if (request !== navigation.current) return;
      }
      const input = reuseAccount ? { connection_id: account!.id } : { method: nextMethod };
      const nextPreview = await api.preview(kit.release_id, input);
      if (request !== navigation.current) return;
      if (nextMethod === 'custom_credential' && isWeixinPreview(nextPreview)) {
        if (!resources) throw new Error('当前客户端不支持微信扫码连接，请更新客户端。');
        enter(kit); setQRTarget({ kit, account, preview: nextPreview }); return;
      }
      const fields = nextDetail.methods.find(item => item.method === nextMethod)?.fields || [];
      setMethod(nextMethod); enter(kit);
      if (fields.length || nextPreview.requires_adoption) { enter(kit); await refreshDetail(kit.release_id, account?.id); if (request === navigation.current) setPreview(nextPreview); }
      else await completeConnection(kit, nextPreview, {}, false, request);
    } catch (e) { if (request === navigation.current) setError(publicErrorMessage(e, '无法连接应用。')); }
    finally { mutating.current = false; if (request === navigation.current) { setBusy(false); setPendingConnection(undefined); } }
  };

  const confirmConnection = async () => {
    if (!selected || !preview) return;
    const request = navigation.current;
    setError('');
    mutating.current = true;
    try { await completeConnection(selected, preview, values, adopt, request); }
    catch (e) { if (request === navigation.current) setError(publicErrorMessage(e, '无法完成连接。')); }
    finally { mutating.current = false; if (request === navigation.current) setBusy(false); }
  };

  const advance = async () => {
    if (flow && pendingStatuses.includes(flow.status)) pending.current.set(flow.id, { state: flow, polls: 0 });
    setError('');
    const request = navigation.current;
    try {
      await synchronize(true); await load();
      if (request === navigation.current && page.current) {
        await refreshDetail(page.current.release_id, accountId);
        if (activeInstallationId) await loadTools(activeInstallationId, true);
      }
    }
    catch (e) { if (request === navigation.current) setError(publicErrorMessage(e, '无法更新连接状态，请重试。')); }
    finally { if (request === navigation.current) setBusy(false); }
  };

  const cancelAuthorization = async () => {
    if (!api || !selected) return;
    const id = preview?.id || flow?.id;
    if (!id) return;
    const request = navigation.current;
    mutating.current = true; setBusy(true); setError('');
    try {
      await syncing.current;
      const current = await api.state(id);
      if (current.installation_id) throw new Error('授权已完成并开始安装，请使用账号旁的移除停止此连接。');
      const cancelled = current.status === 'cancelled' ? current : await api.cancel(id);
      pending.current.delete(id); finished.current.add(id); localStorage.removeItem(pendingKey(id));
      if (request !== navigation.current) return;
      setPreview(undefined); setValues({}); setMethod(undefined); setAdopt(false); setFlow(cancelled);
    } catch (e) { if (request === navigation.current) setError(publicErrorMessage(e, '取消授权未确认，请刷新后重试。')); }
    finally {
      if (request === navigation.current) {
        await load();
        try { await refreshDetail(selected.release_id, accountId); }
        catch { setError('账号状态刷新失败，请重试。'); }
        setBusy(false);
      }
      mutating.current = false;
    }
  };

  const openAuthorization = async () => {
    if (!api || !flow?.authorization_url) return;
    setError('');
    try { await api.openAuthorization(flow.authorization_url); }
    catch (e) { setError(publicErrorMessage(e, '无法打开账号授权，请重试。')); }
  };

  const restoreConnection = async (installationId: string) => {
    if (!api) return;
    const request = navigation.current;
    mutating.current = true; setBusy(true); setError('');
    try {
      await syncing.current;
      const [installation, access] = await Promise.all([api.installation(installationId), api.beingAccess(installationId)]);
      if (installation.desired_state === 'disabled') {
        const key = `enable:${installationId}`;
        const operation = lifecycleRequests.current.get(key) || { id: crypto.randomUUID(), revision: installation.revision };
        lifecycleRequests.current.set(key, operation);
        const result = await api.lifecycle(installationId, 'enable', operation.revision, operation.id);
        if (!result.accepted) { lifecycleRequests.current.delete(key); throw new Error(result.message); }
        lifecycleRequests.current.delete(key);
      }
      if (!access.enabled) await api.setBeingAccess(installationId, true, access.revision);
      if (request === navigation.current) setFlow(undefined);
    } catch (e) { if (request === navigation.current) setError(publicErrorMessage(e, '工具授权未确认，请刷新后重试。')); }
    finally {
      if (request === navigation.current) {
        await load();
        try {
          if (page.current) await refreshDetail(page.current.release_id, accountId);
          if (activeInstallationId) await loadTools(activeInstallationId, true);
        }
        catch { setError('工具状态刷新失败，请重试。'); }
        setBusy(false);
      }
      mutating.current = false;
    }
  };

  const toggleTool = async (installationId: string, tool: HomeConnectorTool, enabled: boolean) => {
    if (!api) return;
    if (enabled && !tool.read_only && !window.confirm('该工具包含写操作，确认启用吗？')) return;
    const request = toolRequest.current;
    const currentPage = navigation.current;
    setError('');
    const key = toolKey(tool);
    setToolBusy(current => new Set(current).add(key));
    setTools(current => current?.map(item => toolKey(item) === key ? { ...item, enabled } : item));
    try {
      const updated = await api.setTool(installationId, { component_id: tool.component_id, connection_id: tool.connection_id, export: tool.export, contract_digest: tool.contract_digest, request_id: crypto.randomUUID(), expected_revision: tool.revision, enabled, confirm_write: enabled && !tool.read_only });
      if (request === toolRequest.current) {
        setTools(current => {
          const next = current?.map(item => toolKey(item) === key ? { ...item, ...updated } : item);
          const cached = toolsCache.current.get(installationId);
          if (next && cached) toolsCache.current.set(installationId, { ...cached, tools: next });
          return next;
        });
      }
      else {
        toolsCache.current.delete(installationId);
        if (currentPage === navigation.current && page.current && preferredAccounts.current.get(page.current.release_id) === tool.connection_id) await loadTools(installationId, true);
      }
    } catch (e) {
      if (request === toolRequest.current) {
        setError(publicErrorMessage(e, '无法更新工具设置。'));
        setTools(current => current?.map(item => toolKey(item) === key ? { ...item, enabled: tool.enabled } : item));
      }
    } finally { setToolBusy(current => { const next = new Set(current); next.delete(key); return next; }); }
  };

  toolToggleRef.current = toggleTool;

  // Used by whole-app disconnect, single-account removal and fresh reconnect.
  const removeAccounts = async (kit: HomeConnectorCatalogItem, accounts: HomeConnectorAccount[]) => {
    const remaining = removals.current.get(kit.release_id) || new Map<string, HomeConnectorAccount>();
    removals.current.set(kit.release_id, remaining);
    for (const account of accounts) remaining.set(account.id, account);
    await syncing.current;
    for (const account of accounts) {
      for (const id of account.installation_ids) {
        const saved = lifecycleRequests.current.get(id);
        const installation = await api!.installation(id);
        if (installation.desired_state !== 'removed' || saved) {
          const operation = saved || { id: crypto.randomUUID(), revision: installation.revision };
          lifecycleRequests.current.set(id, operation);
          const result = await api!.lifecycle(id, 'uninstall', operation.revision, operation.id);
          if (!result.accepted) {
            lifecycleRequests.current.delete(id);
            throw new Error(result.message);
          }
          const latest = await api!.installation(id);
          if (latest.desired_state !== 'removed') throw new Error('断开尚未确认，请刷新状态后重试。');
          lifecycleRequests.current.delete(id);
        }
      }
      await api!.removeAccount(kit.release_id, account.id);
      remaining.delete(account.id);
      for (const [id, entry] of pending.current) if (entry.state.release_id === kit.release_id &&
        (entry.state.connection_id === account.id || id === account.enable_id || account.status === 'unknown' && !entry.state.installation_id)) {
        pending.current.delete(id);
        localStorage.removeItem(pendingKey(id));
      }
    }
  };

  const disconnect = async (kit: HomeConnectorCatalogItem, account?: HomeConnectorAccount) => {
    if (!api || !detail) return;
    const remaining = removals.current.get(kit.release_id);
    const accounts = account ? [remaining?.get(account.id) || account] : [...new Map([...detail.accounts.map(item => [item.id, item] as const), ...remaining || []]).values()];
    if (!accounts.length || !window.confirm(account
      ? `移除 ${account.display_name || 'default'} 在此应用中的连接并停止其工具调用？其他账号和应用不受影响。`
      : `断开此应用的 ${accounts.length} 个账号连接并停止其工具调用？未完成的授权也会取消，其他应用不受影响，历史记录保留。`)) return;
    const request = ++navigation.current;
    mutating.current = true;
    setBusy(true); setError('');
    let submitted = false;
    try { await removeAccounts(kit, accounts); submitted = true; }
    catch (e) { if (request === navigation.current) setError(publicErrorMessage(e, '断开尚未全部确认，请刷新状态后重试。')); }
    finally {
      // Partial success must also be reconciled from Home before another action.
      if (request === navigation.current) {
        setFlow(undefined); setPreview(undefined); setValues({});
        const refreshed = await load();
        try { await refreshDetail(kit.release_id, accountId); }
        catch { setError(submitted ? '断开已提交，但账号状态刷新失败，请重试。' : '断开尚未全部确认，账号状态刷新失败，请重试。'); }
        if (!refreshed && submitted) setError('断开已提交，但应用状态刷新失败，请重试。');
        setBusy(false);
      }
      mutating.current = false;
    }
  };

  const loginHome = async () => {
    const home = model.api.home;
    if (!home) return;
    setAuthenticating(true);
    setCatalogError('');
    try {
      const result = await home.action('login');
      setAuthenticating(result.authenticating);
      if (result.error) throw new Error(result.error);
      if (result.authenticating) return;
      await load('');
      await restorePending();
      poll.current();
    } catch (e) {
      setCatalogError(publicErrorMessage(e, '无法打开 Home 登录。'));
      setAuthenticating(false);
    }
  };

  // Account authorization and installation readiness are separate backend states.
  const connected = (kit: HomeConnectorCatalogItem) => installations.some(item => kit.installation_ids.includes(item.id) && item.desired_state !== 'removed');
  const localInstalled = (kit: HomeConnectorCatalogItem) => localKitFor(kit, localKits) || (selected?.release_id === kit.release_id && localDetail ? localKits.find(item => item.name === localDetail.install_manifest.name) : undefined);
  const filteredCatalog = catalog.filter(item => runtimeFilter === 'all' || runtimeFilter === 'local' && Boolean(localSourceId(item)) || runtimeFilter === 'cloud' && hasRemoteRuntime(item));
  const installedKits = filteredCatalog.filter(item => connected(item) || Boolean(localInstalled(item)));
  const usedKits = filteredCatalog.filter(item => catalogEnabled && item.availability === 'listed' && isLocalKit(item) && !localInstalled(item) && item.local_install?.used_before);
  const availableKits = catalogEnabled ? filteredCatalog.filter(item => item.availability === 'listed' && !connected(item) && !localInstalled(item) && !usedKits.includes(item)) : [];
  const unavailableKits = filteredCatalog.filter(item => (!catalogEnabled || item.availability !== 'listed') && !connected(item) && !localInstalled(item) && !usedKits.includes(item));
  const installLocal = (kit: HomeConnectorCatalogItem) => {
    const sourceId = localSourceId(kit);
    if (!catalogEnabled || kit.availability !== 'listed' || !localKitsReady || town.prepareBusy || town.plan || localInstalled(kit) || !sourceId) return;
    setPreparingSourceId(sourceId);
    void town.prepareKit(sourceId, kit.release_id);
  };

  if (!api) return <p className="field-help">当前客户端未启用 Home Connector。</p>;
  if (!authenticated && catalogLoading && !authenticating) return <ConnectorLoading label="正在加载应用…" />;
  if (!authenticated) return <section className="connector-empty"><h3>连接 Home 后管理应用</h3><p>请先完成 Home 登录，再回来添加应用。</p><div className="connector-action-row"><button className="primary" type="button" onClick={() => void loginHome()} disabled={authenticating} aria-busy={authenticating}>{authenticating ? '登录中…' : '登录 Home'}</button>{authenticating && <button type="button" onClick={() => void model.api.home!.action('cancel-login').catch(e => setCatalogError(publicErrorMessage(e, '取消登录失败，请重试。')))}>取消登录</button>}</div>{catalogError && <p className="form-error" role="alert">{catalogError}</p>}</section>;

  const weixinSelected = detail?.pairing === 'weixin_qr' || tools?.some(tool => tool.connection_id === accountId && tool.action.startsWith('weixin_bot.'));
  const autoChannel = selected && resources && activeAccount && activeInstallation && weixinSelected && !authenticating && <WeixinAutoChannelSettingsCard
    key={JSON.stringify([homeContextVersion, activeAccount.id, activeInstallation.id])}
    resources={resources} connectionId={activeAccount.id} installationId={activeInstallation.id} profileId={beingAccess?.being_profile_id}
    canInitialize={activeAccount.usable && activeAccount.status !== 'reauth_required' && activeInstallation.status === 'ready' && activeInstallation.desired_state === 'enabled' && beingAccess?.enabled === true}
    busy={busy || Boolean(qrTarget)} onToolsChanged={() => void loadTools(activeInstallation.id, true)}
    onReconnect={() => void connect(selected, activeAccount, undefined, true)} />;
  const pairingPanel = qrTarget && resources && <WeixinPairing key={`${qrTarget.kit.release_id}:${qrTarget.account?.id || 'new'}`}
        resources={resources} releaseId={qrTarget.kit.release_id} initialPreview={qrTarget.preview}
        onClose={() => setQRTarget(undefined)} onReady={async (next, context) => {
          const request = navigation.current;
          const currentContext = await resources.context();
          if (request !== navigation.current || currentContext.session !== context.session || currentContext.endpoint !== context.endpoint) return;
          const old = qrTarget.account;
          toolsCache.current.clear(); ++toolRequest.current;
          if (next.connection_id) preferredAccounts.current.set(next.release_id, next.connection_id);
          if (old && old.id !== next.connection_id) {
            for (const id of old.installation_ids) {
              const path = `/v1/me/kit-installations/${encodeURIComponent(id)}`;
              const installation = await resources.request<HomeConnectorInstallation>(context, path);
              if (installation.desired_state !== 'removed') {
                const operation = lifecycleRequests.current.get(id) || { id: crypto.randomUUID(), revision: installation.revision };
                lifecycleRequests.current.set(id, operation);
                await resources.request(context, `/v1/me/kit-installations/${encodeURIComponent(id)}/actions`, 'POST', {
                  action: 'uninstall', expected_revision: operation.revision, request_id: operation.id,
                });
                let removed = false;
                for (let attempt = 0; attempt < 8; attempt++) {
                  if (request !== navigation.current) return;
                  if ((await resources.request<HomeConnectorInstallation>(context, path)).desired_state === 'removed') { removed = true; break; }
                  await new Promise(resolve => setTimeout(resolve, 1500));
                }
                if (!removed) throw new Error('新账号已连接，旧账号停用尚未确认。请刷新后移除旧账号。');
              }
              lifecycleRequests.current.delete(id);
            }
            if (request !== navigation.current) return;
            await resources.request(context, `/v1/me/kit-releases/${encodeURIComponent(next.release_id)}/connector-accounts/${encodeURIComponent(old.id)}/remove`, 'POST');
          }
          const current = await resources.context();
          if (request !== navigation.current || current.session !== context.session || current.endpoint !== context.endpoint) return;
          setQRTarget(undefined); setPreview(undefined); setFlow(undefined);
          await load();
          if (request !== navigation.current) return;
          await refreshDetail(next.release_id, next.connection_id || undefined);
          if (request === navigation.current && next.installation_id) await loadTools(next.installation_id, true);
        }} />;

  return <section className="connector-settings" aria-label="应用">
    {!selected && <div className="connector-toolbar">
      <div className="connector-runtime-filter" role="tablist" aria-label="Kit 运行环境">
        {([['all', '全部'], ['local', '本地'], ['cloud', '云端']] as const).map(([value, label]) => <button key={value} role="tab" type="button" aria-selected={runtimeFilter === value} className={runtimeFilter === value ? 'selected' : ''} onClick={() => setRuntimeFilter(value)}>{label}</button>)}
      </div>
      <label className="connector-search"><Icon className="connector-line-icon" name="search-20" aria-hidden="true" /><input aria-label="搜索应用" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void load(); }} placeholder="搜索应用" /></label>
      <button className="connector-refresh" type="button" aria-label="刷新" title="刷新应用" onClick={() => { void load(); }} disabled={catalogLoading} aria-busy={catalogLoading}><Icon className="connector-line-icon" name="refresh-20" aria-hidden="true" /></button>
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {catalogError && <p className="form-error" role="alert">{catalogError}</p>}
    {localKitsError && (!selected || localSourceId(selected)) && <div className="connector-action-row"><p className="form-error" role="alert">{localKitsError}</p><button type="button" onClick={() => void load()} disabled={catalogLoading}>重试</button></div>}
    {!selected && catalogLoading && <ConnectorLoading label="正在加载应用…" />}
    {selected && busy && <ConnectorLoading label={detail ? '处理中…' : '正在加载…'} />}
    {selected ? <>
      {!detail && <div className="connector-detail-heading"><h3>{selected.name}</h3></div>}
      {!detail && !busy && <button type="button" onClick={() => void openKit(selected)}>重试</button>}
      {pairingPanel}
      {detail && <ConnectorDetailView kit={selected} detail={detail} autoChannel={autoChannel} localKit={localInstalled(selected)} localDetail={localDetail} localKitsReady={localKitsReady} localKitsError={localKitsError} localInstallAvailable={catalogEnabled && selected.availability === 'listed' && Boolean(localDetail?.bundle)} localPreparing={town.prepareBusy} onInstallLocal={() => installLocal(selected)} onDeleteLocal={localKit => model.town.requestDeleteKit(localKit)} installations={installations} accountId={accountId} onAccount={account => { setQRTarget(undefined); chooseAccount(account); }} preview={preview} flow={flow} method={method} values={values} adopt={adopt} busy={busy || Boolean(qrTarget)} toolBusy={toolBusy} toolToggleRef={toolToggleRef} onConnect={(account, method) => void connect(selected, account, method)} onValue={(name, value) => setValues(current => ({ ...current, [name]: value }))} onAdopt={setAdopt} onConfirm={() => void confirmConnection()} onAdvance={() => void advance()} onCancel={() => void cancelAuthorization()} onOpenAuthorization={() => void openAuthorization()} beingAccess={beingAccess} onRestoreConnection={restoreConnection} tools={tools} toolsLoading={toolsLoading} toolsError={toolsError} onLoadTools={loadTools} removalPending={Boolean(removals.current.get(selected.release_id)?.size)} onRemove={account => void disconnect(selected, account)} onDisconnect={() => void disconnect(selected)} />}
    </> : catalogLoading && !catalog.length ? null : <>
      {installedKits.length > 0 && <ConnectorGroup title={`已添加（${installedKits.length}）`} kits={installedKits} connected pendingConnection={pendingConnection} localKits={localKits} localKitsReady={localKitsReady} prepareBusy={town.prepareBusy || Boolean(town.plan)} preparingSourceId={preparingSourceId} onOpen={openKit} onConnect={connect} onInstallLocal={installLocal} />}
      {usedKits.length > 0 && <ConnectorGroup title={`使用过（${usedKits.length}）`} kits={usedKits} pendingConnection={pendingConnection} localKits={localKits} localKitsReady={localKitsReady} prepareBusy={town.prepareBusy || Boolean(town.plan)} preparingSourceId={preparingSourceId} onOpen={openKit} onConnect={connect} onInstallLocal={installLocal} />}
      <ConnectorGroup title="推荐" kits={availableKits} pendingConnection={pendingConnection} localKits={localKits} localKitsReady={localKitsReady} prepareBusy={town.prepareBusy || Boolean(town.plan)} preparingSourceId={preparingSourceId} onOpen={openKit} onConnect={connect} onInstallLocal={installLocal} />
      {unavailableKits.length > 0 && <ConnectorGroup title="暂不可用" kits={unavailableKits} pendingConnection={pendingConnection} localKits={localKits} localKitsReady={localKitsReady} prepareBusy={town.prepareBusy || Boolean(town.plan)} preparingSourceId={preparingSourceId} onOpen={openKit} onConnect={connect} onInstallLocal={installLocal} disabled />}
      {!catalogLoading && !catalogError && !filteredCatalog.length && <p className="field-help">暂无可用应用。</p>}
    </>}
  </section>;
}

function ConnectorGroup({ title, kits, connected = false, pendingConnection, localKits, localKitsReady, prepareBusy, preparingSourceId, onOpen, onConnect, onInstallLocal, disabled = false }: { title: string; kits: HomeConnectorCatalogItem[]; connected?: boolean; pendingConnection?: string; localKits: LocalKit[]; localKitsReady: boolean; prepareBusy: boolean; preparingSourceId?: string; onOpen: (kit: HomeConnectorCatalogItem) => void; onConnect: (kit: HomeConnectorCatalogItem) => void; onInstallLocal: (kit: HomeConnectorCatalogItem) => void; disabled?: boolean }) {
  if (!kits.length) return null;
  return <section className={`connector-group${title === '推荐' ? ' connector-recommended' : ''}`}><h3>{title}</h3><div className="connector-grid">{kits.map(kit => {
    const isConnecting = pendingConnection === kit.release_id;
    const local = localKitFor(kit, localKits);
    const localOnly = isLocalKit(kit);
    const preparing = preparingSourceId !== undefined && preparingSourceId === localSourceId(kit);
    const action = localOnly && !local
      ? { label: '安装', onClick: onInstallLocal, icon: false }
      : connected || local
        ? { label: '管理应用', onClick: onOpen, icon: true }
        : { label: '连接', onClick: onConnect, icon: false };
    const actionLabel = isConnecting ? '连接中…' : preparing ? '正在准备…' : disabled ? '暂不可用' : action.label;
    const open = disabled ? undefined : () => onOpen(kit);
    return <article className={`connector-card${open ? ' is-clickable' : ''}`} key={kit.release_id} role={open ? 'button' : undefined} onClick={open} onKeyDown={event => {
      if (event.target === event.currentTarget && open && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        open();
      }
    }} aria-label={open ? `查看 ${kit.name} 详情` : undefined} tabIndex={open ? 0 : undefined}>
      <ConnectorIcon name={kit.name} iconURL={kit.icon_url} />
      <div className="connector-card-copy"><strong>{kit.name}</strong>{!connected && (kit.description || disabled) && <small>{disabled ? kit.unavailable_reason || kit.description || '当前不可用。' : kit.description}</small>}{local && <small className="connector-local-status">{local.problem ? '本机文件异常' : '已安装到本机'}</small>}{!local && kit.local_install?.used_before && <small className="connector-local-status">使用过 · 此设备未安装</small>}</div>
      <button className="connector-card-action" data-icon-only={action.icon || isConnecting || undefined} type="button" aria-label={actionLabel} title={actionLabel} disabled={disabled || isConnecting || preparing || prepareBusy && localOnly && !local || localOnly && !localKitsReady} aria-busy={isConnecting || preparing} onClick={event => {
        event.stopPropagation();
        action.onClick(kit);
      }}>{isConnecting || preparing ? <span className="connector-loading-spinner" aria-hidden="true" /> : action.icon ? <Icon className="connector-line-icon" name="chevron-right-20" aria-hidden="true" /> : <span>{actionLabel}</span>}</button>
    </article>;
  })}</div></section>;
}

function ConnectorLoading({ label }: { label: string }) {
  return <div className="connector-loading" role="status" aria-label={label}>
    <button className="connector-loading-button" type="button" aria-label={label} aria-busy="true" disabled>
      <span className="connector-loading-spinner" aria-hidden="true" />
    </button>
  </div>;
}

const ConnectorToolRow = memo(function ConnectorToolRow({ installationId, tool, disabled, onToggle }: {
  installationId: string; tool: HomeConnectorTool; disabled: boolean; onToggle: { current: ToggleTool };
}) {
  return <label className="connector-tool">
    <span><strong>{tool.action || tool.export.replaceAll('_', ' ')}</strong><small>{tool.read_only ? '只读' : '会修改第三方数据'} · {tool.description}</small>{!tool.account_authorized && <small>账号权限不足，需重新授权或核对安装范围。</small>}{tool.enabled && tool.account_authorized && !tool.available && <small>已开启，当前尚不可调用。</small>}</span>
    <input type="checkbox" role="switch" aria-label={tool.export} checked={tool.enabled} disabled={disabled} onChange={event => onToggle.current(installationId, tool, event.target.checked)} />
  </label>;
});

function ConnectorToolList<T>({ tools, searchText, renderTool, declared }: {
  tools: readonly T[]; searchText: (tool: T) => string; renderTool: (tool: T) => ReactNode; declared?: boolean;
}) {
  const [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const keywords = query.toLowerCase().split(/[\s._-]+/).filter(Boolean);
  const visibleTools = keywords.length ? tools.filter(tool => {
    const text = searchText(tool).toLowerCase();
    return keywords.every(keyword => text.includes(keyword));
  }) : tools;

  return <>
    <label className="connector-search connector-tool-search">
      <Icon className="connector-line-icon" name="search-20" aria-hidden="true" />
      <input type="search" aria-label="搜索工具" placeholder="按名称或描述搜索工具" value={query} onChange={event => {
        setQuery(event.target.value);
        if (list.current) list.current.scrollTop = 0;
      }} />
    </label>
    {visibleTools.length > 0 ? <div className="connector-tool-list" ref={list} role={declared ? 'list' : undefined}>{visibleTools.map(renderTool)}</div>
      : <p className="field-help" role="status">未找到匹配的工具。</p>}
  </>;
}

function ConnectorDetailView({ kit, detail, autoChannel, localKit, localDetail, localKitsReady, localKitsError, localInstallAvailable, localPreparing, onInstallLocal, onDeleteLocal, installations, accountId, onAccount, preview, flow, method, values, adopt, busy, toolBusy, toolToggleRef, onConnect, onValue, onAdopt, onConfirm, onAdvance, onCancel, onOpenAuthorization, beingAccess, onRestoreConnection, tools, toolsLoading, toolsError, onLoadTools, removalPending, onRemove, onDisconnect }: {
  kit: HomeConnectorCatalogItem; detail: HomeConnectorDetail; autoChannel?: ReactNode; localKit?: LocalKit; localDetail?: HomeLocalKitDetail; localKitsReady: boolean; localKitsError: string; localInstallAvailable: boolean; localPreparing: boolean; onInstallLocal: () => void; onDeleteLocal: (kit: LocalKit) => void; installations: HomeConnectorInstallation[]; accountId?: string; onAccount: (account: HomeConnectorAccount) => void;
  preview?: HomeConnectorPreview; flow?: HomeConnectorEnableState; method?: string; values: Record<string, string>; adopt: boolean; busy: boolean; toolBusy: Set<string>; toolToggleRef: { current: ToggleTool };
  onConnect: (account?: HomeConnectorAccount, method?: string) => void; onValue: (name: string, value: string) => void; onAdopt: (value: boolean) => void;
  onConfirm: () => void; onAdvance: () => void; onCancel: () => void; onOpenAuthorization: () => void;
  beingAccess?: HomeConnectorBeingAccess; onRestoreConnection: (id: string) => void; tools?: HomeConnectorTool[]; toolsLoading: boolean; toolsError: string;
  onLoadTools: (id: string, force?: boolean) => void; removalPending: boolean; onRemove: (account: HomeConnectorAccount) => void; onDisconnect: () => void;
}) {
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [skillsExpanded, setSkillsExpanded] = useState(false);
  const account = detail.accounts.find(item => item.id === accountId);
  const installation = accountInstallation(account, installations);
  const installationId = installation?.id;
  const connected = Boolean(installation);
  const hasOAuth2 = detail.methods.some(item => item.method === 'oauth2');
  const fields = detail.pairing === 'weixin_qr' ? [] : detail.methods.find(item => item.method === method)?.fields || [];
  const fallbackMethods = ['api_key', 'custom_credential'].flatMap(method => detail.methods.filter(item => item.method === method));
  const credentialPreview = preview && !isWeixinPreview(preview) ? preview : undefined;
  const showFallback = detail.pairing !== 'weixin_qr' && !hasOAuth2 && (!account || method === '');
  const flowError = flow && ['failed', 'needs_auth', 'expired'].includes(flow.status);
  const skills = detail.skills || [];
  const visibleSkills = skillsExpanded ? skills : skills.slice(0, 5);
  const localTools = localKit?.tools ?? localDetail?.tools ?? [];
  useEffect(() => {
    setSkillsExpanded(false);
  }, [kit.release_id, accountId, installationId]);
  if (isLocalKit(kit)) return <div className="connector-detail connector-local-detail">
    <div className="connector-detail-heading">
      <ConnectorIcon name={kit.name} iconURL={kit.icon_url} />
      <div className="connector-detail-name"><h3>{kit.name}</h3><div className="connector-runtime-tabs" aria-label="运行环境"><span className="connector-runtime-tab">本地</span></div></div>
      <div className="connector-detail-actions">
        {localKit ? <button className="danger" type="button" onClick={() => onDeleteLocal(localKit)} disabled={busy}>卸载本机 Kit</button> : <button type="button" onClick={onInstallLocal} disabled={busy || localPreparing || !localKitsReady || !localInstallAvailable}>{localPreparing ? '正在准备…' : '安装'}</button>}
      </div>
    </div>
    {kit.description && <p className="connector-detail-description">{kit.description}</p>}
    {localKit?.problem && <p className="form-error" role="alert">{localKit.problem}</p>}
    {!localKit && !localInstallAvailable && <p className="field-help" role="status">{kit.unavailable_reason || (localDetail?.bundle ? '此应用当前不可安装。' : '此 Kit 暂无可用的安装包。')}</p>}
    <section className="connector-tools-section" aria-label="工具">
      <h4>工具</h4>
      {!localKit && Boolean(localDetail?.tools.length) && <p className="field-help">以下为发布的工具声明，安装到本机后可使用。</p>}
      {localTools.length ? <div className="connector-tools">
        <button className="connector-tools-toggle" type="button" aria-expanded={toolsExpanded} onClick={() => setToolsExpanded(value => !value)}><span>{localTools.length} 个工具</span><Icon className="connector-line-icon" name="chevron-down" aria-hidden="true" style={{ transform: toolsExpanded ? 'rotate(180deg)' : undefined }} /></button>
        {toolsExpanded && <ConnectorToolList key={kit.release_id} tools={localTools} declared
          searchText={tool => `${tool.name} ${tool.description ?? ''}`}
          renderTool={tool => <div className="connector-tool" role="listitem" key={tool.name}><span><strong>{tool.name}</strong>{tool.description && <small>{tool.description}</small>}</span></div>} />}
      </div> : <p className="field-help">{!localKitsReady ? localKitsError ? '暂时无法显示本机工具。' : '正在读取本机状态…' : localKit ? '此 Kit 未声明工具。' : '安装后可查看此 Kit 提供的本地工具。'}</p>}
    </section>
    <section className="connector-info-section"><h4>信息</h4><dl className="connector-info">
      <div><dt>安装状态</dt><dd>{!localKitsReady ? localKitsError ? '本机状态不可用' : '正在读取…' : localKit ? localKit.problem ? '本机文件异常' : '已安装到本机' : '尚未安装'}</dd></div>
      {(localKit?.version || kit.version) && <div><dt>版本</dt><dd>{localKit?.version || kit.version}</dd></div>}
      {kit.category && <div><dt>分类</dt><dd>{kit.category === 'other' ? '其他' : kit.category}</dd></div>}
    </dl></section>
  </div>;
  return <div className="connector-detail">
    <div className="connector-detail-heading">
      <ConnectorIcon name={detail.name} iconURL={detail.icon_url} /><div className="connector-detail-name"><h3>{detail.name}</h3>{!!kit.runtimes?.length && <div className="connector-runtime-tabs" aria-label="运行环境">{[...new Set(kit.runtimes.map(runtimeTabLabel))].map(label => <span className="connector-runtime-tab" key={label}>{label}</span>)}</div>}</div>
      <div className="connector-detail-actions">
        {!isLocalKit(kit) && <button className="connector-refresh" type="button" aria-label="刷新连接状态" onClick={onAdvance} disabled={busy}><Icon className="connector-line-icon" name="refresh-20" aria-hidden="true" /></button>}
        {localSourceId(kit) && <>{localKit ? <button className="danger" type="button" onClick={() => onDeleteLocal(localKit)} disabled={busy}>卸载本机 Kit</button> : <button type="button" onClick={onInstallLocal} disabled={busy || localPreparing || !localKitsReady || !localInstallAvailable}>{localPreparing ? '正在准备…' : '安装'}</button>}</>}
        {(detail.accounts.length > 0 || removalPending) && <button className="danger" type="button" onClick={onDisconnect} disabled={busy}>断开</button>}
        {!detail.accounts.length && !removalPending && !credentialPreview && (!flow || !pendingStatuses.includes(flow.status)) && detail.methods.length > 0 && <button type="button" onClick={() => onConnect()} disabled={busy}>连接</button>}
      </div>
    </div>
    {kit.description && <p className="connector-detail-description">{kit.description}</p>}
    {detail.reason && <p className="field-help" role="status">{detail.reason === 'kit_connector_full_plan_required' ? '此应用需要完整安装流程，暂不支持快捷连接。' : detail.reason === 'kit_connector_management_disabled' ? '当前环境未开放应用快捷连接。' : '当前没有适用于此应用的认证方式，请检查服务端配置。'}</p>}
    {detail.accounts.length > 0 && <section className="connector-account"><h4>账户</h4><div className="connector-accounts">{detail.accounts.map(item => {
      const installed = accountInstallation(item, installations);
      const accessDisabled = item.id === accountId && beingAccess?.enabled === false;
      const active = item.status !== 'reauth_required' && item.usable && installed?.desired_state === 'enabled' && ['ready', 'degraded'].includes(installed.status) && !accessDisabled;
      const label = active ? '已连接' : item.status === 'reauth_required' ? '需重新连接' : !item.usable ? '未连接' : !installed ? '待启用' : installed.desired_state === 'disabled' || accessDisabled ? '待连接' : statusLabel(installed.status);
      return <div className="connector-account-entry" key={item.id}>
        <button type="button" className="connector-account-row" aria-label={`${item.display_name || 'default'} ${label}`} aria-pressed={item.id === accountId} disabled={busy} onClick={() => onAccount(item)}><span className="connector-account-name"><span>{item.display_name || 'default'}</span></span><strong className={active ? undefined : 'is-disconnected'}>{label}</strong></button>
        {((!item.usable || item.status === 'reauth_required') && detail.methods.length > 0 || item.usable && !installed) && <button type="button" className="connector-account-connect" onClick={() => onConnect(item)} disabled={busy}>{item.usable && item.status !== 'reauth_required' ? '连接账号' : '重新连接'}</button>}
        {item.usable && installed && (installed.desired_state === 'disabled' || accessDisabled) && <button type="button" className="connector-account-connect" onClick={() => onRestoreConnection(installed.id)} disabled={busy || toolsLoading}>连接账号</button>}
        {detail.pairing === 'weixin_qr' && item.usable && item.status !== 'reauth_required' && installed?.desired_state === 'enabled' && !accessDisabled && <button type="button" className="connector-account-connect" onClick={() => onConnect(item)} disabled={busy}>重新连接</button>}
        <button type="button" className="connector-account-connect" aria-label={`移除 ${item.display_name || 'default'}`} onClick={() => onRemove(item)} disabled={busy}>移除</button>
      </div>;
    })}{detail.methods.length > 0 && <button type="button" className="connector-account-add" onClick={() => onConnect()} disabled={busy}><Icon className="connector-line-icon" name="plus" aria-hidden="true" /><span>添加其他账户</span></button>}</div></section>}
    {autoChannel}
    {showFallback && !preview && (!flow || !pendingStatuses.includes(flow.status)) && <div className="connector-connect-panel">{fallbackMethods.map(item => <button className="connector-option" key={item.method} type="button" onClick={() => onConnect(undefined, item.method)} disabled={busy}>{item.method === 'api_key' ? 'API Key' : '自定义凭据'}</button>)}</div>}
    {credentialPreview && <div className="connector-preview"><p>连接成功后，工具会自动准备就绪。</p>{credentialPreview.requires_adoption && <p>接管后，此账号的旧工具入口会停用。</p>}<details open><summary>权限与工具范围</summary><p>初始只读工具：{credentialPreview.read_actions.join('、') || '无'}</p><p>需要明确开启的写工具：{credentialPreview.write_actions.join('、') || '无'}</p><p>第三方授权范围：{credentialPreview.scopes.join('、') || '无额外声明'}</p>{credentialPreview.permission_notes.map(note => <pre key={note}>{note}</pre>)}</details>{fields.map(field => <label className="connector-field" key={field.name}><span>{field.label || field.name}{field.required ? ' *' : ''}</span><input type={field.secret ? 'password' : field.type === 'number' ? 'number' : 'text'} required={field.required} disabled={busy} placeholder={field.placeholder || undefined} autoComplete="off" value={values[field.name] || ''} onChange={event => onValue(field.name, event.target.value)} /><small>{field.description}</small></label>)}{credentialPreview.requires_adoption && <label className="connector-adopt"><input type="checkbox" disabled={busy} checked={adopt} onChange={event => onAdopt(event.target.checked)} />接管并启用</label>}<div className="connector-action-row"><button className="primary" type="button" disabled={busy || credentialPreview.requires_adoption && !adopt || fields.some(field => field.required && !values[field.name]?.trim())} onClick={onConfirm}>连接并启用</button><button type="button" disabled={busy} onClick={onCancel}>取消授权</button></div></div>}
    {!preview && flow && (!account || flow.connection_id === account.id || !detail.accounts.some(item => item.id === flow.connection_id)) && <div className="connector-flow"><p className={flowError ? 'form-error' : undefined} role={flowError ? 'alert' : 'status'}>{statusLabel(flow.status)}</p>{pendingStatuses.includes(flow.status) && <div className="connector-action-row"><button type="button" onClick={onAdvance} disabled={busy}>刷新状态</button>{flow.status === 'awaiting_account' && flow.authorization_url && <button type="button" onClick={onOpenAuthorization} disabled={busy}>继续授权</button>}{!flow.installation_id && <button type="button" onClick={onCancel} disabled={busy}>取消授权</button>}</div>}</div>}
    {connected && installationId && <section className="connector-tools-section" aria-label="工具">
      <div className="connector-section-heading"><h4>工具</h4><button type="button" className="connector-refresh" aria-label="刷新工具" onClick={() => onLoadTools(installationId, true)} disabled={busy || toolsLoading}><Icon className="connector-line-icon" name="refresh-20" aria-hidden="true" /></button></div>
      {!account?.usable && <p className="field-help">账号授权已失效，请重新连接。工具偏好已保留。</p>}
      {installation && installation.desired_state !== 'enabled' && <p className="field-help" role="status">连接已停用，请在账号旁重新连接。</p>}
      <div className="connector-tools"><button className="connector-tools-toggle" type="button" aria-expanded={toolsExpanded} onClick={() => setToolsExpanded(value => !value)}><span className={!tools && !toolsLoading ? 'form-error' : undefined}>{tools ? `已启用 ${tools.filter(tool => tool.enabled).length}/${tools.length} 个` : toolsLoading ? '加载中…' : '加载失败'}</span><Icon className="connector-line-icon" name="chevron-down" aria-hidden="true" style={{ transform: toolsExpanded ? 'rotate(180deg)' : undefined }} /></button>
        {toolsError && <p className="form-error" role="alert">{toolsError}</p>}
        {toolsExpanded && tools?.some(tool => tool.enabled && !tool.available) && <p className="field-help">部分已启用的工具暂不可用，请检查账号连接和运行状态。</p>}
        {toolsExpanded && tools?.length === 0 && <p className="field-help">工具尚未就绪，请稍后刷新。</p>}
        {toolsExpanded && tools && tools.length > 0 && <ConnectorToolList key={installationId} tools={tools}
          searchText={tool => `${tool.action} ${tool.export} ${tool.description}`}
          renderTool={tool => <ConnectorToolRow key={toolKey(tool)} installationId={installationId} tool={tool} disabled={busy || toolBusy.has(toolKey(tool)) || !tool.enabled && !tool.account_authorized} onToggle={toolToggleRef} />} />}
      </div>
    </section>}
    <section className="connector-info-section"><h4 className="connector-apps-heading">应用 <span>1</span></h4><div className="connector-app-summary"><span>{kit.name}</span><small>连接器</small></div></section>
    {skills.length > 0 && <section className="connector-skills-section" aria-label="技能">
      <h4>技能 <span>{skills.length}</span></h4>
      <div className="connector-skill-list">{visibleSkills.map(skill => <article className="connector-skill-row" key={skill.export}>
        <div className="connector-skill-copy"><Icon name="skill" width="28" height="28" aria-hidden="true" /><div><h5>{skill.name}</h5><p>{skill.description}</p></div></div>
      </article>)}
      {!skillsExpanded && skills.length > visibleSkills.length && <button className="connector-skills-more" type="button" aria-expanded={false} onClick={() => setSkillsExpanded(true)}>另有 {skills.length - visibleSkills.length} 个</button>}
      {skillsExpanded && skills.length > 5 && <button className="connector-skills-more" type="button" aria-expanded={true} onClick={() => setSkillsExpanded(false)}>收起</button>}
      </div>
    </section>}
    <section className="connector-info-section"><h4>信息</h4><dl className="connector-info"><div><dt>功能</dt><dd>1 个应用</dd></div>{kit.version && <div><dt>版本</dt><dd>{kit.version}</dd></div>}{kit.category && <div><dt>分类</dt><dd>{kit.category}</dd></div>}</dl></section>
  </div>;
}

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  HomeConnectorCatalogItem, HomeConnectorDetail, HomeConnectorEnableState,
  HomeConnectorInstallation, HomeConnectorPreview, HomeConnectorTool,
} from '../../../shared/home';
import type { AppModel } from '../models/app';
import { Icon } from '../../shared/icons/icon';
import { ConnectorIcon } from './connector-icon';

const statusText: Record<string, string> = {
  awaiting_account: '连接中', needs_auth: '连接中', preparing: '连接中', pending: '连接中', unknown: '连接中', waiting_device: '连接中',
  ready: '已连接', paused: '已停用', disabled: '已停用', removed: '已停用', degraded: '部分不可用',
  failed: '连接失败', cancelled: '连接失败', expired: '连接失败', blocked: '连接失败',
};

const pendingStatuses = ['awaiting_account', 'needs_auth', 'preparing', 'pending', 'unknown', 'waiting_device'];

const statusLabel = (status: string) => statusText[status] || '连接中';

export function ConnectorSettings({ model }: { model: AppModel }) {
  const api = model.api.home?.connectors;
  const [authenticated, setAuthenticated] = useState(false);
  const [catalogEnabled, setCatalogEnabled] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [pendingConnection, setPendingConnection] = useState<string>();
  const [catalog, setCatalog] = useState<HomeConnectorCatalogItem[]>([]);
  const [installations, setInstallations] = useState<HomeConnectorInstallation[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<HomeConnectorCatalogItem>();
  const [detail, setDetail] = useState<HomeConnectorDetail>();
  const [preview, setPreview] = useState<HomeConnectorPreview>();
  const [flow, setFlow] = useState<HomeConnectorEnableState>();
  const [tools, setTools] = useState<HomeConnectorTool[]>();
  const [method, setMethod] = useState<string>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [adopt, setAdopt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState('');
  const navigation = useRef(0);
  const catalogRequest = useRef(0);
  const details = useRef(new Map<string, Promise<HomeConnectorDetail>>());

  // Share hover, navigation and connect reads for this settings session.
  const readDetail = (releaseId: string) => {
    let pending = details.current.get(releaseId);
    if (!pending) {
      pending = api!.detail(releaseId).catch(error => {
        details.current.delete(releaseId);
        throw error;
      });
      details.current.set(releaseId, pending);
    }
    return pending;
  };

  const back = () => {
    navigation.current++;
    setSelected(undefined); setDetail(undefined); setPreview(undefined); setFlow(undefined);
    setTools(undefined); setError(''); setNotice(''); setBusy(false); setConnecting(false);
    setToolsLoading(false); setToolsError(''); setPendingConnection(undefined);
  };

  useEffect(() => () => { navigation.current++; catalogRequest.current++; details.current.clear(); }, [api]);

  const load = async (search = query) => {
    if (!api) return;
    const request = ++catalogRequest.current;
    setCatalogLoading(true); setCatalogError('');
    try {
      const home = await model.api.home?.state();
      if (request !== catalogRequest.current) return;
      setAuthenticated(Boolean(home?.authenticated));
      if (!home?.authenticated) { setCatalogEnabled(false); setCatalog([]); setInstallations([]); return; }
      const [kits, installed] = await Promise.all([
        (async () => {
          const page = await api.catalog(search ? { q: search } : {});
          const items = [...page.items];
          let after = page.next_after;
          while (after && request === catalogRequest.current) {
            const next = await api.catalog({ q: search, after });
            items.push(...next.items); after = next.next_after;
          }
          return { ...page, items };
        })(),
        (async () => {
          const page = await api.installations();
          const items = [...page.items];
          let after = page.next_after;
          while (after && request === catalogRequest.current) {
            const next = await api.installations(after);
            items.push(...next.items); after = next.next_after;
          }
          return { ...page, items };
        })(),
      ]);
      if (request !== catalogRequest.current) return;
      setCatalogEnabled(kits.enabled); setCatalog(kits.items); setInstallations(installed.items);
      setSelected(current => current && (kits.items.find(item => item.release_id === current.release_id) || current));
    } catch (e) { if (request === catalogRequest.current) setCatalogError(e instanceof Error ? e.message : '无法读取应用目录。'); }
    finally { if (request === catalogRequest.current) setCatalogLoading(false); }
  };

  useEffect(() => { void load(''); }, [api]);

  const installedIds = useMemo(() => new Set(installations.filter(item => item.desired_state !== 'removed').map(item => item.id)), [installations]);
  const installedKits = catalog.filter(item => item.installation_ids.some(id => installedIds.has(id)));
  const availableKits = catalogEnabled ? catalog.filter(item => item.availability === 'listed' && !installedKits.includes(item)) : [];
  const unavailableKits = catalog.filter(item => item.availability !== 'listed' && !installedKits.includes(item));

  const startOAuth = async (kit: HomeConnectorCatalogItem) => {
    if (!api) return;
    const request = ++navigation.current;
    setPendingConnection(selected ? undefined : kit.release_id); setConnecting(true); setDetail(undefined); setPreview(undefined); setFlow(undefined); setTools(undefined); setMethod(undefined); setValues({}); setAdopt(false); setNotice(''); setError(''); setBusy(true);
    try {
      const kitDetail = await readDetail(kit.release_id);
      if (request !== navigation.current) return;
      if (!kitDetail.methods.some(item => item.method === 'oauth2')) {
        setSelected(kit);
        setDetail(kitDetail);
        return;
      }
      const next = await api.startOAuth(kit.release_id);
      details.current.delete(kit.release_id);
      if (request !== navigation.current) return;
      setSelected(kit);
      setFlow(next);
      if (next.authorization_url && next.status !== 'ready') {
        await api.openAuthorization(next.authorization_url);
        if (request === navigation.current) setNotice('已打开连接页面。完成后回到这里继续。');
      } else if (next.status === 'ready') {
        setNotice('应用已连接。');
        await load();
      }
    } catch (e) {
      if (request === navigation.current) setError(e instanceof Error ? e.message : '无法连接应用。');
    } finally {
      if (request === navigation.current) { setBusy(false); setPendingConnection(undefined); }
    }
  };

  const openKit = async (kit: HomeConnectorCatalogItem) => {
    if (!api) return;
    const request = ++navigation.current;
    setPendingConnection(undefined); setSelected(kit); setConnecting(false); setDetail(undefined); setPreview(undefined); setFlow(undefined); setTools(undefined); setMethod(undefined); setValues({}); setAdopt(false); setNotice(''); setError(''); setBusy(true);
    const installation = installations.find(item => item.desired_state !== 'removed' && kit.installation_ids.includes(item.id));
    // Tools have their own loading/error state and never hold up the detail page.
    if (installation) void loadTools(installation.id);
    try {
      const nextDetail = await readDetail(kit.release_id);
      if (request === navigation.current) setDetail(nextDetail);
    } catch (e) {
      if (request === navigation.current) setError(e instanceof Error ? e.message : '无法读取应用连接选项。');
    } finally {
      if (request === navigation.current) setBusy(false);
    }
  };

  const completeFallbackConnection = async (intentId: string, confirmAdopt: boolean, confirmValues: Record<string, string>, request: number) => {
    if (!api) return;
    const next = await api.confirm(intentId, { adopt: confirmAdopt, values: confirmValues });
    details.current.delete(selected!.release_id);
    if (request !== navigation.current) return;
    setValues({}); setPreview(undefined);
    setFlow(next);
    if (next.authorization_url && next.status !== 'ready') {
      await api.openAuthorization(next.authorization_url);
      if (request === navigation.current) setNotice('已打开连接页面。完成后回到这里继续。');
    } else if (next.status === 'ready') {
      setNotice('应用已连接，正在刷新工具列表。');
      await load();
      if (request === navigation.current && next.installation_id) await loadTools(next.installation_id);
    } else setNotice(`当前状态：${statusLabel(next.status)}`);
  };

  const beginFallbackConnection = async (input: { method: string }) => {
    if (!api || !selected) return;
    const request = navigation.current;
    setBusy(true); setError(''); setNotice(''); setMethod(input.method);
    try {
      const nextPreview = await api.preview(selected.release_id, input);
      if (request !== navigation.current) return;
      const fields = detail?.methods.find(item => item.method === input.method)?.fields || [];
      if (fields.length > 0 || nextPreview.requires_adoption) setPreview(nextPreview);
      else await completeFallbackConnection(nextPreview.id, false, {}, request);
    } catch (e) { if (request === navigation.current) setError(e instanceof Error ? e.message : '无法创建连接。'); }
    finally { if (request === navigation.current) setBusy(false); }
  };

  const confirmFallbackConnection = async () => {
    if (!api || !preview) return;
    const request = navigation.current;
    setBusy(true); setError('');
    try { await completeFallbackConnection(preview.id, adopt, values, request); }
    catch (e) { if (request === navigation.current) setError(e instanceof Error ? e.message : '无法完成连接。'); }
    finally { if (request === navigation.current) setBusy(false); }
  };

  const advance = async () => {
    if (!api || !flow) return;
    const request = navigation.current;
    setBusy(true); setError('');
    try {
      let next = flow.revision !== undefined ? await api.syncOAuth(flow.id, flow.revision) : await api.advance(flow.id);
      if (request !== navigation.current) return;
      if (next.authorization_url && next.status !== 'ready') { setFlow(next); await api.openAuthorization(next.authorization_url); if (request === navigation.current) setNotice('已打开连接页面。完成后回到这里继续。'); return; }
      for (let attempt = 0; attempt < 5 && pendingStatuses.includes(next.status); attempt++) {
        setFlow(next);
        await new Promise(resolve => setTimeout(resolve, 1200 + attempt * 600));
        if (request !== navigation.current) return;
        next = flow.revision !== undefined ? await api.oauthState(flow.id) : await api.state(flow.id);
        if (request !== navigation.current) return;
      }
      if (request !== navigation.current) return;
      setFlow(next);
      if (next.status === 'ready') { setNotice('应用已连接，正在刷新工具列表。'); await load(); }
      else setNotice(`当前状态：${statusLabel(next.status)}`);
    } catch (e) { if (request === navigation.current) setError(e instanceof Error ? e.message : '无法继续连接。'); }
    finally { if (request === navigation.current) setBusy(false); }
  };

  const loadTools = async (installationId: string) => {
    if (!api) return;
    const request = navigation.current;
    setToolsLoading(true); setToolsError('');
    try {
      const nextTools = await api.tools(installationId);
      if (request === navigation.current) setTools(nextTools);
    } catch (e) {
      if (request === navigation.current) setToolsError(e instanceof Error ? e.message : '无法读取工具设置。');
    } finally {
      if (request === navigation.current) setToolsLoading(false);
    }
  };

  const toggleTool = async (installationId: string, tool: HomeConnectorTool, enabled: boolean) => {
    if (!api) return;
    if (enabled && !tool.read_only && !window.confirm('该工具包含写操作，确认启用吗？')) return;
    const request = navigation.current;
    setBusy(true); setError('');
    try {
      const updated = await api.setTool(installationId, { component_id: tool.component_id, connection_id: tool.connection_id, export: tool.export, contract_digest: tool.contract_digest, request_id: crypto.randomUUID(), expected_revision: tool.revision, enabled, confirm_write: enabled && !tool.read_only });
      if (request === navigation.current) setTools(current => current?.map(item => item.component_id === updated.component_id && item.connection_id === updated.connection_id && item.export === updated.export ? updated : item));
    } catch (e) { if (request === navigation.current) setError(e instanceof Error ? e.message : '无法更新工具设置。'); }
    finally { if (request === navigation.current) setBusy(false); }
  };

  const changeLifecycle = async (installation: HomeConnectorInstallation, action: 'enable' | 'disable' | 'uninstall') => {
    if (!api) return;
    if (action === 'uninstall' && !window.confirm('卸载后会停用此应用及其工具，确认继续吗？')) return;
    const request = navigation.current;
    setBusy(true); setError('');
    try {
      await api.lifecycle(installation.id, action, installation.revision);
      details.current.delete(installation.root_release_id);
      if (request !== navigation.current) return;
      await load();
      if (request === navigation.current && action === 'uninstall') setTools(undefined);
    }
    catch (e) { if (request === navigation.current) setError(e instanceof Error ? e.message : '无法更新应用状态。'); }
    finally { if (request === navigation.current) setBusy(false); }
  };

  if (!api) return <p className="field-help">当前客户端未启用 Home Connector。</p>;
  if (!authenticated && catalogLoading) return <ConnectorLoading label="正在加载应用…" />;
  if (!authenticated && catalogError) return <div><p className="form-error" role="alert">{catalogError}</p><button type="button" onClick={() => void load()}>重试</button></div>;
  if (!authenticated) return <section className="connector-empty"><h3>连接 Home 后管理应用</h3><p>应用连接复用“电脑”栏的 Home 登录。请先完成 Home 登录，再回来添加应用。</p><button className="primary" type="button" onClick={() => model.openClientSettings()}>打开 Home 设置</button></section>;

  return <section className="connector-settings" aria-label="应用">
    {!selected && <div className="connector-toolbar"><label className="connector-search"><Icon className="connector-line-icon" name="search-20" /><input aria-label="搜索应用" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void load(); }} placeholder="搜索应用" /></label><button className="connector-refresh" type="button" aria-label="刷新" title="刷新应用" onClick={() => { details.current.clear(); void load(); }} disabled={catalogLoading} aria-busy={catalogLoading}><Icon className="connector-line-icon" name="refresh-20" /></button></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {catalogError && <p className="form-error" role="alert">{catalogError}</p>}
    {!selected && catalogLoading && <ConnectorLoading label="正在加载应用…" />}
    {selected && (detail || flow) && busy && <ConnectorLoading label="处理中…" />}
    {!catalogLoading && !catalogError && !catalogEnabled && <p className="field-help">当前账号尚未配置可用的应用市场。</p>}
    {notice && <p className="field-help" role="status">{notice}</p>}
    {selected && !detail && !flow ? <ConnectorLoadingView kit={selected} onBack={back} busy={busy} connecting={connecting} onRetry={() => void (connecting ? startOAuth(selected) : openKit(selected))} /> : selected && !detail && flow ? <ConnectorOAuthFlow kit={selected} flow={flow} busy={busy} onBack={back} onAdvance={() => void advance()} /> : selected && detail ? <ConnectorDetailView kit={selected} detail={detail} preview={preview} flow={flow} method={method} values={values} adopt={adopt} busy={busy} onBack={back} onConnect={() => void startOAuth(selected)} onMethod={method => void beginFallbackConnection({ method })} onValue={(name, value) => setValues(current => ({ ...current, [name]: value }))} onAdopt={setAdopt} onConfirm={() => void confirmFallbackConnection()} onAdvance={() => void advance()} tools={tools} toolsLoading={toolsLoading} toolsError={toolsError} onLoadTools={loadTools} onToggleTool={toggleTool} onLifecycle={changeLifecycle} installations={installations} /> : catalogLoading && !catalog.length ? null : <>
      {installedKits.length > 0 && <ConnectorGroup title={`已添加（${installedKits.length}）`} kits={installedKits} installations={installations} pendingConnection={pendingConnection} onOpen={openKit} onConnect={startOAuth} onPrefetch={kit => { void readDetail(kit.release_id).catch(() => {}); }} />}
      <ConnectorGroup title="推荐" kits={availableKits} installations={installations} pendingConnection={pendingConnection} onOpen={openKit} onConnect={startOAuth} onPrefetch={kit => { void readDetail(kit.release_id).catch(() => {}); }} />
      {unavailableKits.length > 0 && <ConnectorGroup title="暂不可用" kits={unavailableKits} installations={installations} pendingConnection={pendingConnection} onOpen={openKit} onConnect={startOAuth} onPrefetch={kit => { void readDetail(kit.release_id).catch(() => {}); }} disabled />}
      {!catalogLoading && !catalogError && !catalog.length && <p className="field-help">暂无可用应用。</p>}
    </>}
  </section>;
}

function ConnectorGroup({ title, kits, installations, pendingConnection, onOpen, onConnect, onPrefetch, disabled = false }: { title: string; kits: HomeConnectorCatalogItem[]; installations: HomeConnectorInstallation[]; pendingConnection?: string; onOpen: (kit: HomeConnectorCatalogItem) => void; onConnect: (kit: HomeConnectorCatalogItem) => void; onPrefetch: (kit: HomeConnectorCatalogItem) => void; disabled?: boolean }) {
  return <section className={`connector-group${title === '推荐' ? ' connector-recommended' : ''}`}><h3>{title}</h3><div className="connector-grid">{kits.map(kit => {
    const installation = installations.find(item => item.desired_state !== 'removed' && kit.installation_ids.includes(item.id));
    const isConnecting = pendingConnection === kit.release_id;
    const open = disabled ? undefined : () => onOpen(kit);
    return <article className={`connector-card${open ? ' is-clickable' : ''}${installation ? ' is-installed' : ''}`} key={kit.release_id} onPointerEnter={() => onPrefetch(kit)} onFocus={() => onPrefetch(kit)} onClick={open} onKeyDown={event => {
      if (event.target === event.currentTarget && open && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        open();
      }
    }} aria-label={open ? `查看 ${kit.name} 详情` : undefined} tabIndex={open ? 0 : undefined}>
      <ConnectorIcon name={kit.name} />
      <div className="connector-card-copy"><strong>{kit.name}</strong>{!installation && (kit.description || disabled) && <small>{disabled ? kit.unavailable_reason || kit.description || '当前不可用。' : kit.description}</small>}{installation && installation.status !== 'ready' && <em>{statusLabel(installation.status)}</em>}</div>
      <button className="connector-card-action" type="button" aria-label={isConnecting ? '连接中…' : installation ? '管理' : disabled ? '暂不可用' : '连接'} title={installation ? '管理应用' : disabled ? '暂不可用' : '连接应用'} disabled={disabled || isConnecting} aria-busy={isConnecting} onClick={event => {
        event.stopPropagation();
        installation ? onOpen(kit) : onConnect(kit);
      }}>{isConnecting ? <span className="connector-loading-spinner" aria-hidden="true" /> : <Icon className="connector-line-icon" name={installation ? 'chevron-right-20' : 'plus'} />}</button>
    </article>;
  })}</div></section>;
}

function ConnectorOAuthFlow({ kit, flow, busy, onBack, onAdvance }: { kit: HomeConnectorCatalogItem; flow: HomeConnectorEnableState; busy: boolean; onBack: () => void; onAdvance: () => void }) {
  return <div className="connector-detail"><button className="text-button" type="button" onClick={onBack}>← 返回应用</button><div className="connector-detail-heading"><ConnectorIcon name={kit.name} /><div><h3>{kit.name}</h3><p>{kit.description}</p></div></div><div className="connector-flow"><p className="connector-status">{statusLabel(flow.status)}</p>{flow.authorization_url && <button className="primary" type="button" onClick={onAdvance} disabled={busy}>已完成连接，继续</button>}{!flow.authorization_url && pendingStatuses.includes(flow.status) && <button type="button" onClick={onAdvance} disabled={busy}>刷新状态</button>}{flow.status === 'ready' && <p className="field-help">应用已连接。</p>}</div></div>;
}

function ConnectorLoading({ label }: { label: string }) {
  return <div className="connector-loading" role="status" aria-label={label}>
    <button className="connector-loading-button" type="button" aria-label={label} aria-busy="true" disabled>
      <span className="connector-loading-spinner" aria-hidden="true" />
    </button>
  </div>;
}

function ConnectorLoadingView({ kit, onBack, busy, connecting, onRetry }: { kit: HomeConnectorCatalogItem; onBack: () => void; busy: boolean; connecting: boolean; onRetry: () => void }) {
  return <div className="connector-detail"><button className="text-button" type="button" onClick={onBack}>← 返回应用</button><div className="connector-detail-heading"><ConnectorIcon name={kit.name} /><div><h3>{kit.name}</h3><p>{kit.description}</p></div></div>{busy ? <ConnectorLoading label={connecting ? '正在连接…' : '正在加载…'} /> : <div className="connector-loading"><button type="button" onClick={onRetry}>重试</button></div>}</div>;
}

function ConnectorDetailView({ kit, detail, preview, flow, method, values, adopt, busy, onBack, onConnect, onMethod, onValue, onAdopt, onConfirm, onAdvance, tools, toolsLoading, toolsError, onLoadTools, onToggleTool, onLifecycle, installations }: {
  kit: HomeConnectorCatalogItem; detail: HomeConnectorDetail; preview?: HomeConnectorPreview; flow?: HomeConnectorEnableState; method?: string; values: Record<string, string>; adopt: boolean; busy: boolean; onBack: () => void; onConnect: () => void; onMethod: (method: string) => void; onValue: (name: string, value: string) => void; onAdopt: (value: boolean) => void; onConfirm: () => void; onAdvance: () => void; tools?: HomeConnectorTool[]; toolsLoading: boolean; toolsError: string; onLoadTools: (id: string) => void; onToggleTool: (id: string, tool: HomeConnectorTool, enabled: boolean) => void; onLifecycle: (installation: HomeConnectorInstallation, action: 'enable' | 'disable' | 'uninstall') => void; installations: HomeConnectorInstallation[];
}) {
  const installation = installations.find(item => item.desired_state !== 'removed' && kit.installation_ids.includes(item.id));
  const [toolsExpanded, setToolsExpanded] = useState(true);
  const enabledTools = tools?.filter(tool => tool.enabled).length || 0;
  const account = detail.accounts.find(item => item.usable) || detail.accounts[0];
  const hasOAuth2 = detail.methods.some(item => item.method === 'oauth2');
  const fields = method ? detail.methods.find(item => item.method === method)?.fields || [] : [];
  const fallbackMethods = detail.methods.filter(item => item.method !== 'oauth2');
  return <div className="connector-detail"><button className="text-button" type="button" onClick={onBack}>← 返回应用</button><div className="connector-detail-heading"><ConnectorIcon name={kit.name} /><div><h3>{detail.name}</h3><p>{kit.description}</p></div></div>
    {!installation && !flow && !preview && hasOAuth2 && <div className="connector-connect-panel"><h4>连接应用</h4><p>点击连接后将打开应用的 OAuth2 页面，完成一次连接即可使用。</p><button className="primary" type="button" onClick={onConnect} disabled={busy}>连接</button></div>}
    {!installation && !flow && !preview && !hasOAuth2 && <div className="connector-connect-panel">{fallbackMethods.length ? fallbackMethods.map(item => <button className="connector-option" key={item.method} type="button" onClick={() => onMethod(item.method)} disabled={busy}><strong>{item.method === 'api_key' ? 'API Key' : '自定义凭据'}</strong><small>添加新账号</small></button>) : <p className="field-help">当前没有可用的连接方式。</p>}</div>}
    {preview && !flow && <div className="connector-preview"><h4>连接 {detail.name}</h4>{fields.map(field => <label className="connector-field" key={field.name}><span>{field.label || field.name}{field.required ? ' *' : ''}</span><input type={field.secret ? 'password' : field.type === 'number' ? 'number' : 'text'} required={field.required} placeholder={field.placeholder || undefined} value={values[field.name] || ''} onChange={event => onValue(field.name, event.target.value)} /><small>{field.description}</small></label>)}{preview.requires_adoption && <label className="connector-adopt"><input type="checkbox" checked={adopt} onChange={event => onAdopt(event.target.checked)} />使用已有账号继续连接</label>}<button className="primary" type="button" disabled={busy || preview.requires_adoption && !adopt || fields.some(field => field.required && !values[field.name]?.trim())} onClick={onConfirm}>连接</button></div>}
    {installation && <><section className="connector-account"><h4>账户</h4><div className="connector-account-row"><span>{account?.display_name || 'default'}</span><strong>{statusLabel(installation.status)}</strong></div></section><div className="connector-installed-actions"><p>此应用已连接。可管理工具或暂停应用。</p><div className="connector-action-row"><button type="button" onClick={() => onLoadTools(installation.id)} disabled={busy || toolsLoading}>{toolsLoading ? '加载中…' : '刷新工具'}</button>{installation.desired_state !== 'removed' && <button type="button" onClick={() => onLifecycle(installation, installation.desired_state === 'enabled' ? 'disable' : 'enable')} disabled={busy}>{installation.desired_state === 'enabled' ? '暂停' : '恢复'}</button>}<button type="button" onClick={() => onLifecycle(installation, 'uninstall')} disabled={busy || installation.desired_state === 'removed'}>卸载</button></div></div></>}
    {flow && <div className="connector-flow"><p className="connector-status">{statusLabel(flow.status)}</p>{flow.authorization_url && <button className="primary" type="button" onClick={onAdvance} disabled={busy}>已完成连接，继续</button>}{!flow.authorization_url && pendingStatuses.includes(flow.status) && <button type="button" onClick={onAdvance} disabled={busy}>刷新状态</button>}{flow.status === 'ready' && installation && <button type="button" onClick={() => onLoadTools(installation.id)} disabled={busy}>查看工具</button>}</div>}
    {installation && <section className="connector-tools" aria-label="工具"><button className="connector-tools-toggle" type="button" aria-expanded={toolsExpanded} onClick={() => setToolsExpanded(value => !value)}><span className="connector-tools-heading"><strong>工具</strong><span>{tools ? `已启用 ${enabledTools}/${tools.length} 个` : toolsLoading ? '加载中…' : '加载失败'}</span></span><span className="connector-tools-chevron" aria-hidden="true">{toolsExpanded ? '⌃' : '⌄'}</span></button>{toolsError && <p className="form-error" role="alert">{toolsError}</p>}{toolsExpanded && tools && <div className="connector-tool-list">{tools.map(tool => <label className="connector-tool" key={JSON.stringify([tool.component_id, tool.connection_id, tool.export])}><span>{tool.export}</span><input type="checkbox" checked={tool.enabled} disabled={busy || !tool.available || !tool.account_authorized} onChange={e => onToggleTool(installation.id, tool, e.target.checked)} /></label>)}</div>}</section>}
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import type { DesktopPluginAPI, PluginSession } from '../../shared/plugins';
import { PLUGIN_CAPABILITIES } from '../../shared/plugins';
import { Dialog } from '../shared/components/dialog';
import { useModel } from '../shared/hooks/use-model';
import { errorText } from '../shared/models/store';
import type { PluginsModel } from './model';

type PluginSurfaceProps = { model: PluginsModel; theme: 'light' | 'dark'; contextKey: string };

export function Plugins({ model, theme, contextKey }: PluginSurfaceProps) {
  const plugins = useModel(model);
  const selected = plugins.selected?.placement === 'page' ? plugins.selected : undefined;
  const installed = plugins.library.plugins.find(p => p.enabled && p.manifest.id === selected?.id);
  return <section className="plugin-page view" aria-label="客户端插件">
    <header className="plugin-toolbar"><h2>{installed?.manifest.name || '客户端插件'}</h2>
      <button className="secondary" onClick={() => plugins.manage()}>管理插件</button></header>
    {plugins.error && <p role="alert">{plugins.error}</p>}
    {selected && installed && plugins.api ?
      <PluginFrame key={`${selected.id}:${selected.revision}:${contextKey}`} api={plugins.api} model={plugins} id={selected.id}
        view={selected.view} command={selected.command} theme={theme} title={installed.manifest.name} /> :
      <button className="secondary" onClick={() => plugins.manage()}>返回工具库 · Plugin</button>}
  </section>;
}

export function PluginSidebar({ model, theme, contextKey }: PluginSurfaceProps) {
  const plugins = useModel(model);
  const selected = plugins.selected?.placement === 'sidebar' ? plugins.selected : undefined;
  const installed = plugins.library.plugins.find(p => p.enabled && p.manifest.id === selected?.id);
  if (!selected || !installed || !plugins.api) return null;
  return <aside className="plugin-sidebar" aria-label={`${installed.manifest.name}侧栏`}>
    <header><strong>{installed.manifest.name}</strong>
      <button className="text-button" onClick={() => plugins.closeSidebar()}>关闭插件侧栏</button></header>
    <PluginFrame key={`${selected.id}:${selected.revision}:${contextKey}`} api={plugins.api} model={plugins} id={selected.id}
      view={selected.view} slot={selected.slot} theme={theme} title={`${installed.manifest.name}侧栏`} />
  </aside>;
}

export function PluginCard({ model, plugin }: { model: PluginsModel; plugin: import('../../shared/plugins').InstalledPlugin }) {
  const plugins = useModel(model);
  return <article className="plugin-card">
    <h3>{plugin.manifest.name} <span className="mini-tag">Plugin</span></h3>
    <p>{plugin.manifest.description}</p>
    <p className="card-meta">{plugin.manifest.author} · v{plugin.manifest.version} · {plugin.source.kind === 'grove' ? 'Grove' : '本地导入'} · {plugin.enabled ? '已启用' : '已停用'}</p>
    <p className="field-help">能力：{['页面、主题', ...plugin.manifest.capabilities.map(c => PLUGIN_CAPABILITIES[c])].join('；')}</p>
    <div className="plugin-actions">
      <div className="plugin-view-list">
        <div className="plugin-view-heading"><span>页面入口</span><span>显示位置</span></div>
        {plugin.manifest.contributes.views.map(view => <div className="plugin-view-placement" key={view.id}>
          <button disabled={!plugin.enabled || plugins.busy} className="secondary" onClick={() => plugins.open(plugin.manifest.id, view.id)}>{view.id === plugin.manifest.contributes.settingsView ? "插件设置" : view.title}</button>
          <select aria-label={`${view.title}显示位置`} disabled={plugins.busy}
          value={plugins.placement(plugin.manifest.id, view.id)} onChange={e => void plugins.setPlacement(plugin.manifest.id, view.id, e.target.value as import('../../shared/plugins').PluginPlacement)}>
            <option value="page">默认页面</option><option value="navigation">顶部功能栏</option><option value="window">独立窗口</option>
          </select>
        </div>)}
      </div>
      <div className="plugin-management">
        <span>插件管理</span>
        <div>
          <button className="secondary" disabled={plugins.busy} onClick={() => void plugins.act(() => plugins.api!.setEnabled(plugin.manifest.id, !plugin.enabled))}>{plugin.enabled ? '停用' : '启用'}</button>
          <button className="secondary danger-action" disabled={plugins.busy} onClick={() => void plugins.act(() => plugins.api!.remove(plugin.manifest.id))}>卸载</button>
        </div>
      </div>
    </div>
  </article>;
}

export function PluginNavigation({ model, active }: { model: PluginsModel; active: boolean }) {
  const plugins = useModel(model);
  return <>{plugins.navigationViews().map(({ plugin, view }) =>
    <button type="button" key={`${plugin.id}:${view.id}`} data-plugin-navigation
      aria-current={active && plugins.selected?.id === plugin.id && plugins.selected.view === view.id ? 'page' : undefined}
      onClick={() => plugins.open(plugin.id, view.id, undefined, 'navigation')} title={plugin.name}>{view.title}</button>
  )}</>;
}

export function PluginCommands({ model }: { model: PluginsModel }) {
  const plugins = useModel(model), [query, setQuery] = useState('');
  const commands = plugins.library.plugins.filter(p => p.enabled).flatMap(p => (p.manifest.contributes.commands || []).map(command => ({ ...command, plugin: p.manifest })));
  useEffect(() => { if (plugins.commandsOpen) setQuery(''); }, [plugins.commandsOpen]);
  return <Dialog id="plugin-commands" open={plugins.commandsOpen} onClose={() => plugins.showCommands(false)} aria-label="插件命令" dismissOnBackdrop>
    <h2>插件命令</h2><input autoFocus type="search" aria-label="搜索插件命令" placeholder="搜索插件命令…" value={query} onChange={e => setQuery(e.target.value)} />
    <div className="plugin-command-list">{commands.filter(c => `${c.plugin.name} ${c.title}`.toLowerCase().includes(query.toLowerCase())).map(c =>
      <button className="secondary" key={`${c.plugin.id}:${c.id}`} onClick={() => plugins.open(c.plugin.id, c.view, c.id)}>{c.plugin.name} · {c.title}</button>)}</div>
    {!commands.length && <p>启用带有命令的插件后，命令会显示在这里。</p>}
    <button className="secondary" onClick={() => plugins.showCommands(false)}>关闭</button>
  </Dialog>;
}

export function PluginSlots({ model }: { model: PluginsModel }) {
  const plugins = useModel(model), sides = plugins.slots('right-sidebar'), actions = plugins.slots('resource-actions');
  if (!sides.length && !actions.length) return null;
  return <div className="plugin-slot-toolbar">
    {sides.map(({ plugin, slot }) => <button className="text-button" key={`${plugin.id}:${slot.id}`} onClick={() => plugins.openSlot(plugin.id, slot)}>{slot.title}</button>)}
    {actions.length > 0 && <details className="plugin-resource-menu"><summary>资源插件操作</summary><div aria-label="资源插件操作">
      <p>{plugins.context?.resource?.title}</p>
      {actions.map(({ plugin, slot }) => <button className="secondary" key={`${plugin.id}:${slot.id}`} onClick={event => { event.currentTarget.closest('details')!.open = false; plugins.openSlot(plugin.id, slot); }}>{plugin.name} · {slot.title}</button>)}
    </div></details>}
  </div>;
}

export function PluginFrame({ api, model, id, view, command, slot, theme, title }: { api: Pick<DesktopPluginAPI, 'open' | 'close' | 'call' | 'onEvent'>; model: Pick<PluginsModel, 'prepareSession' | 'showCommands' | 'compose' | 'applyUI'>; id: string; view: string; command?: string; slot?: string; theme: 'light' | 'dark'; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [session, setSession] = useState<PluginSession>();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const currentTheme = useRef(theme); currentTheme.current = theme;
  const send = (value: unknown) => frame.current?.contentWindow?.postMessage(value, '*');
  useEffect(() => {
    let active = true, opened: PluginSession | undefined;
    setSession(undefined); setError(''); setReady(false);
    void model.prepareSession().then(() => { if (!active) return undefined; return api.open(id, view, command, slot); }).then(value => {
      if (!value) return;
      opened = value;
      if (active) setSession(value); else void api.close(value.token);
    }).catch(e => { if (active) setError(errorText(e)); });
    return () => { active = false; if (opened) void api.close(opened.token).catch(() => {}); };
  }, [api, model, id, view, command, slot, revision]);
  useEffect(() => {
    if (!session) return;
    let active = true, inflight = 0;
    const timer = setTimeout(() => { setError('插件启动超时，可重试或停用插件。'); void api.close(session.token); }, 15000);
    const receive = async (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== 'null') return;
      const message = event.data;
      if (!message || message.channel !== session.token) return;
      if (message.type === 'grove:commands') { model.showCommands(true); return; }
      if (message.type === 'grove:error') {
        clearTimeout(timer); setError(typeof message.error === 'string' ? message.error.slice(0, 1000) : '插件加载失败');
        void api.close(session.token); return;
      }
      const respond = (value: unknown) => { if (active) send(value); };
      if (message.type === 'grove:ready') {
        clearTimeout(timer); setReady(true);
        respond({ type: 'grove:theme', channel: session.token, theme: currentTheme.current }); return;
      }
      if (message.type !== 'grove:request' || !Number.isSafeInteger(message.id) || message.id < 1 || inflight >= 8) return;
      inflight++;
      try {
        if (!['storage.load', 'storage.save', 'storage.patch', 'town.query', 'being.context', 'being.history', 'being.compose', 'being.chat', 'ui.notice', 'ui.navigate', 'workspace.context', 'being.tasks.list', 'events.subscribe', 'events.unsubscribe'].includes(message.method)) throw new Error('插件操作未开放。');
        if (message.value !== undefined && (JSON.stringify(message.value)?.length ?? Infinity) > 1024 * 1024) throw new Error('插件数据超过 1 MB。');
        const value = await api.call(session.token, message.method, message.value);
        if (!active) return;
        const result = message.method === 'being.compose' ? await model.compose(value as { text: string; sceneId: string }) : value;
        respond({ type: 'grove:response', channel: session.token, id: message.id, value: message.method.startsWith('ui.') ? undefined : result });
        if (message.method.startsWith('ui.')) setTimeout(() => { if (active) model.applyUI(message.method, value); }, 0);
      } catch (e) { respond({ type: 'grove:response', channel: session.token, id: message.id, error: errorText(e) }); }
      finally { inflight--; }
    };
    window.addEventListener('message', receive);
    const stop = api.onEvent?.(event => { if (active && event.token === session.token) send({ type: 'grove:event', channel: session.token, event: event.type, data: event.data }); });
    return () => { active = false; clearTimeout(timer); stop?.(); window.removeEventListener('message', receive); };
  }, [api, session, model]);
  useEffect(() => { if (session) send({ type: 'grove:theme', channel: session.token, theme }); }, [session, theme]);
  return <>
    {error ? <p role="alert">{error} <button className="secondary" onClick={() => setRevision(n => n + 1)}>重试</button></p> : <>
      {!ready && <p role="status">正在加载插件…</p>}
      {session && <iframe className="plugin-frame" ref={frame} src={session.url} title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" />}
    </>}
  </>;
}

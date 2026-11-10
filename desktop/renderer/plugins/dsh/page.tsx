import { WorkspaceDrawer, DrawerPresence } from "../../shared/components/workspace-drawer";
import { createPortal } from 'react-dom';
import { Icon } from '../../shared/icons/icon';
import { publicErrorMessage } from '../../../shared/errors';
import { pluginIssue } from './issue';
import { DshNavigation } from './navigation';
import { DshConfigForm } from './config-form';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { useModel } from '../../shared/hooks/use-model';
import { dshRuntime, DshSlot, DshSurfaceContext } from './runtime';
import { Dialog } from '../../shared/components/dialog';
import { useManagerFocus } from './use-manager-focus';
import './styles.scss';
import type { DshCommand } from '../../../shared/dsh-plugins';
class PluginBoundary extends Component<{ children: ReactNode; fallback?: ReactNode; resetKey?: number }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: unknown) { return { error: String(error) }; }
  componentDidUpdate(previous: Readonly<{ resetKey?: number }>) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: '' });
  }
  render() { return this.state.error ? this.props.fallback ?? <p role="alert">插件界面加载失败：{this.state.error}</p> : this.props.children; }
}
export function DshPluginSurfaces() {
  const runtime = useModel(dshRuntime);
  return <PluginBoundary resetKey={runtime.lifecycleVersion} fallback={<DshPluginContent degraded />}><DshRoot /></PluginBoundary>;
}
function DshRoot() {
  const runtime = useModel(dshRuntime);
  return <DshSurfaceContext.Provider value={<DshPluginContent />}>{runtime.renderRoot() ?? <DshPluginContent />}</DshSurfaceContext.Provider>;
}
function DshLimitations({ owner }: { owner?: string }) {
  const runtime = useModel(dshRuntime);
  const limitations = runtime.state.plugins.find(plugin => plugin.id === owner)?.limitations;
  if (!limitations?.length) return null;
  return <details className="dsh-compatibility"><summary>部分能力暂不可用</summary>{limitations.map(message => <p key={message}>{message}</p>)}</details>;
}
function DshCommands() {
  const runtime = useModel(dshRuntime);
  const [commands, setCommands] = useState<DshCommand[]>([]);
  const [input, setInput] = useState(''), [result, setResult] = useState(''), [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    let active = true;
    void runtime.commandUi?.candidates().then(rows => { if (active) setCommands(rows); }, error => { if (active) setResult(String(error)); });
    return () => { active = false; };
  }, [runtime, runtime.lifecycleVersion]);
  const execute = async (text: string, option?: { id: string; label: string }) => {
    setBusy(true); setResult(''); setChoices([]);
    try {
      const decoration = runtime.commandUi?.decorations.get(text.trim().slice(1));
      if (decoration?.ui.kind === 'popupSelect' && (!decoration.available || decoration.available())) {
        if (option) { await decoration.ui.onSelect(option, { sessionId: '' }); setResult('已提交选择：' + option.label); }
        else {
          const options = await decoration.ui.options(); setChoices(options);
          if (!options.length) setResult('暂无可选项');
        }
      } else setResult((await runtime.executeCommand(text)).text || '命令已执行');
    } catch (error) { setResult(String(error)); }
    finally { setBusy(false); }
  };
  if (!commands.length) return <p role="status">{result || '已启用的插件尚未提供命令。'}</p>;
  return <section className="dsh-command-section"><h3>插件命令</h3>
    <p>命令在本地插件中执行。依赖 Harness 模型或会话的能力可能暂不可用。</p>
    <div className="dsh-actions">{commands.map(command => <button className="secondary" key={command.name} disabled={busy} title={command.description} onClick={() => { setInput('/' + command.name); setChoices([]); setResult(''); }}>/{command.name}</button>)}</div>
    <form className="dsh-install" onSubmit={event => { event.preventDefault(); void execute(input); }}>
      <label htmlFor="dsh-command">命令与参数</label><div><input id="dsh-command" value={input} onChange={event => { setInput(event.target.value); setChoices([]); }} placeholder="输入 /命令名 参数" /><button className="primary" disabled={busy || !input.trim()}>执行命令</button></div>
    </form>
    {!!choices.length && <div className="dsh-actions">{choices.map(option => <button className="secondary" key={option.id} disabled={busy} onClick={() => void execute(input, option)}>{option.label}</button>)}</div>}
    {result && <p role="status">{result}</p>}
  </section>;
}
function DshPluginContent({ degraded = false }: { degraded?: boolean }) {
  const runtime = useModel(dshRuntime);
  const [source, setSource] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const [notice, setNotice] = useState('');
  const reload = runtime.restartRequired;
  const rightbarSlot = useRef<HTMLDivElement>(null);
  const [drawerHost, setDrawerHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setDrawerHost(document.querySelector<HTMLElement>(".workspace-body")); }, []);
  const [rightbarWidth, setRightbarWidth] = useState(400);
  useEffect(() => {
    if (!runtime.rightbar.open || !rightbarSlot.current) return;
    const observer = new ResizeObserver(([entry]) => setRightbarWidth(entry.contentRect.width));
    observer.observe(rightbarSlot.current);
    return () => observer.disconnect();
  }, [runtime.rightbar.open]);
  const [formState, setFormState] = useState({ dirty: false, busy: false });
  const [formRevision, setFormRevision] = useState(0);
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const requestLeave = (action: () => void) => {
    if (busy || formState.busy) return;
    if (formState.dirty) setLeave(() => action); else action();
  };
  const close = () => requestLeave(async () => {
    if (runtime.closeSettings && !await runtime.closeSettings()) return;
    runtime.closeManager();
  });
  const openPanel = async (action: () => void) => {
    if (runtime.closeSettings && !await runtime.closeSettings()) return;
    runtime.closeManager();
    action();
  };
  useEffect(() => {
    runtime.requestSettingsLeave = requestLeave;
    runtime.settingsBusy = busy || formState.busy;
    runtime.changed();
    return () => { runtime.requestSettingsLeave = undefined; };
  }, [busy, formState.dirty, formState.busy]);
  useManagerFocus(runtime.managerOpen && !runtime.managerHost && !runtime.settingsNavigate, close);
  const api = window.beings?.dshPlugins;
  const canActivate = runtime.phase === 'ready' && !!api;
  const act = async (operation: () => Promise<unknown>, target?: string) => {
    const before = new Map(runtime.state.plugins.filter(p => pluginIssue(p, runtime.errors[p.id])).map(p => [p.id, p.installedAt]));
    setBusy(true); setError(''); setNotice('');
    try {
      // A rejected activation can still leave a new, disabled installation on disk.
      let operationError: unknown;
      try { if (await operation() === false) return false; } catch (error) { operationError = error; }
      await runtime.applyChanges();
      if (target && runtime.managedPlugin === target && runtime.state.plugins.some(plugin => plugin.id === target && plugin.enabled)) runtime.openPlugin(target);
      const failed = runtime.state.plugins.filter(p => pluginIssue(p, runtime.errors[p.id]));
      const affected = failed.find(p => p.id === target) ?? failed.find(p => before.get(p.id) !== p.installedAt);
      if (affected) { runtime.openPlugin(affected.id); requestAnimationFrame(() => {
        const notice = document.getElementById(`dsh-issue-${affected.id}`);
        notice?.focus({ preventScroll: true });
        notice?.scrollIntoView({ block: 'center' });
      }); }
      if (operationError) throw operationError;
      return !affected;
    }
    catch (error) { setError(publicErrorMessage(error, '操作未完成，请检查插件来源和版本后重试。')); return false; }
    finally { setBusy(false); }
  };
  const [completed, setCompleted] = useState<string[]>([]);
  const [explicitStep, setExplicitStep] = useState<string>();
  const slots = runtime.settingsSlots;
  const selected = runtime.state.plugins.find(plugin => plugin.id === (runtime.managedPlugin || runtime.panel?.owner || runtime.configuration?.owner));
  const entries = selected ? slots.filter(slot => slot.owner === selected.id) : [];
  const views = selected ? runtime.configurationViews.filter(view => view.owner === selected.id && view.autoGenerate && Object.keys(view.schema?.dict || {}).length) : [];
  const pages = { installed: '已安装', install: '安装插件', commands: '命令与面板', help: '兼容说明' } as const;
  const visible = runtime.state.plugins.filter(plugin => `${plugin.id} ${plugin.description || ''}`.toLowerCase().includes(query.trim().toLowerCase()) && (filter === 'all' || (filter === 'enabled' ? plugin.enabled : filter === 'disabled' ? !plugin.enabled : !!pluginIssue(plugin, runtime.errors[plugin.id]))));
  const selectedIssue = selected && pluginIssue(selected, runtime.errors[selected.id]);
  const settingsAvailable = selected?.enabled && !runtime.needsReload(selected.id);
  const onboarding = runtime.slots.filter(s => s.name === 'settings.onboarding').sort((a, b) => (a.order || 0) - (b.order || 0)).find(s => explicitStep ? s.id === explicitStep : !completed.includes(s.id!));
  const pluginSettings = selected && <>

          <div className="dsh-detail-summary"><details><summary>插件信息</summary><p>{selected.description}</p></details><div className="dsh-actions">
            <button className="secondary" disabled={busy || formState.busy || (!selected.enabled && !canActivate)} onClick={() => requestLeave(() => void act(() => api!.enable(selected.id, !selected.enabled), selected.id))}>{selected.enabled ? '停用' : '启用'}</button>
            <details className="dsh-more"><summary>管理</summary><div>
              <button disabled={busy || formState.busy || !canActivate} onClick={() => requestLeave(() => void act(() => api!.install(selected.source), selected.id))}>更新／重新安装</button>
              <button className="danger-action" disabled={busy || formState.busy} onClick={() => requestLeave(() => void act(async () => { const removed = await api!.remove(selected.id); if (removed !== false) runtime.openManager(); return removed; }))}>卸载</button>
            </div></details>
          </div></div>
          {selectedIssue && <div id={`dsh-issue-${selected.id}`} className="dsh-plugin-issue" tabIndex={-1} role="group" aria-label={`${selected.id}：${selectedIssue.title}`} aria-describedby={`dsh-reason-${selected.id}`}><Icon name="info-20" /><div><strong>{selectedIssue.title}</strong><p id={`dsh-reason-${selected.id}`}>{selectedIssue.reason}</p>{selectedIssue.detail && <details><summary>查看错误详情</summary><p>{selectedIssue.detail}</p></details>}</div></div>}

          {settingsAvailable && <>
            {(entries.length > 1 || (entries.length > 0 && views.length > 0) || views.length > 1) && <nav className="dsh-detail-tabs" aria-label="当前插件设置">
              {entries.map((slot, index) => <button key={`${slot.name}:${slot.key || slot.id || index}`} aria-current={runtime.panel === slot || (runtime.panel?.name === slot.name && runtime.panel?.key === slot.key && runtime.panel?.id === slot.id) ? 'page' : undefined} onClick={() => requestLeave(() => { runtime.configuration = undefined; runtime.panel = slot; runtime.changed(); })}>{slot.label || (entries.length === 1 ? '设置' : slot.id || slot.key || `设置 ${index + 1}`)}</button>)}
              {views.map(view => <button key={view.ns} aria-current={runtime.configuration?.ns === view.ns ? 'page' : undefined} onClick={() => requestLeave(() => { runtime.panel = undefined; runtime.configuration = view; runtime.changed(); })}>{entries.length ? (views.length === 1 ? '高级配置' : `${view.ns} · 高级配置`) : view.ns}</button>)}
            </nav>}
            {runtime.configuration ? <PluginBoundary resetKey={runtime.lifecycleVersion}><DshConfigForm key={`${runtime.configuration.ns}:${formRevision}`} view={runtime.configuration} onState={setFormState} /></PluginBoundary> : runtime.panel ? <div className="dsh-plugin-content" key={`${runtime.panel.owner}:${runtime.panel.name}:${runtime.panel.id || runtime.panel.key}`}><PluginBoundary resetKey={runtime.lifecycleVersion}><DshSlot name={runtime.panel.name} owner={{ close }} options={{ only: runtime.panel.id, entryKey: runtime.panel.key }} /></PluginBoundary></div> : <p className="field-help">这个插件没有提供设置项。</p>}
          </>}
          <DshLimitations owner={selected.id} />

  </>;
  const manager = <>
      <div className="dsh-manager-main">
      <header className="dsh-manager-heading">
        {selected && !runtime.settingsNavigate && <button className="text-button" onClick={() => requestLeave(() => runtime.openManager())}>返回插件列表</button>}
        <DshSlot name="settings.header" /><h2 id="dsh-manager-title">第三方插件</h2><DshSlot name="settings.action" />
        {!runtime.managerHost && <button className="close" aria-label="关闭" disabled={busy || formState.busy} onClick={close}><span className="dsh-sr-only" aria-hidden="true"><DshSlot name="settings.close" /></span></button>}
      </header>

      {((error && runtime.managerPage !== 'install') || runtime.state.error) && <div className="dsh-operation-issue" role="alert"><strong>插件操作未完成</strong><span>{runtime.managerPage !== 'install' && error || publicErrorMessage(runtime.state.error)}</span></div>}
      {leave && <div className="dsh-unsaved" role="alert"><p>配置尚未保存，是否放弃更改？</p><button className="secondary" onClick={() => setLeave(null)}>继续编辑</button><button className="secondary" onClick={() => { const action = leave; setLeave(null); setFormRevision(value => value + 1); setFormState({ dirty: false, busy: false }); action(); }}>放弃更改</button></div>}
      <div className="dsh-manager-body">
      {!selected && <>
      <nav className="dsh-manager-nav" aria-label="插件管理导航">
        {(Object.entries(pages) as [keyof typeof pages, string][]).filter(([page]) => page !== 'installed').map(([page, label]) => <button key={page} className={page === 'install' ? 'primary' : 'text-button'} aria-expanded={runtime.managerPage === page} disabled={busy || formState.busy} onClick={() => requestLeave(() => { setError(''); setNotice(''); runtime.openManager(runtime.managerPage === page ? 'installed' : page); })}>{label}</button>)}
      </nav>
      </>}
        {busy && runtime.managerPage !== 'install' && <p className="dsh-operation-status" role="status">正在处理插件，请稍候…</p>}
        {notice && <p className="dsh-operation-status" role="status">{notice}</p>}
        {runtime.phase === 'loading' && <p role="status">插件正在加载…</p>}
        {degraded && <p role="alert">插件界面出现异常。可停用插件后重新加载。</p>}
        {Object.entries(runtime.errors).filter(([id]) => !runtime.state.plugins.some(p => p.id === id)).map(([id, message]) => <p key={id} role="alert">{id}：{message}</p>)}
        {!selected && runtime.state.modelCompatibility && <details className="dsh-model-status"><summary>{runtime.state.modelCompatibility.supported ? '当前模型支持插件生成' : '当前模型的部分插件能力不可用'}</summary><p>{runtime.state.modelCompatibility.message}</p></details>}
        {reload && <p className="dsh-reload" role="status">部分插件需要重新加载才能完成更改。请先保留未发送的草稿。 <button className="secondary" onClick={() => location.reload()}>重新加载页面</button></p>}
        {!selected && ['commands', 'help'].includes(runtime.managerPage) && <section className="dsh-utility-section" aria-label={pages[runtime.managerPage]}>
          <button className="dsh-utility-close" aria-label="收起公共设置" disabled={busy || formState.busy} onClick={() => requestLeave(() => runtime.openManager())}><Icon name="close" /></button>
        {runtime.managerPage === 'commands' ? <>
          <DshCommands />
          {runtime.shortcutConflicts.map(message => <p key={message} role="status">{message}</p>)}
          <h3>操作面板</h3><div className="dsh-actions">{runtime.sidebarTabs.map(tab => <button className="secondary" key={tab.id} onClick={() => void openPanel(() => runtime.openSidebarTab(tab.kind))}>{tab.title()}</button>)}{runtime.slots.filter(slot => ['main', 'rightbar'].includes(slot.name)).map((slot, index) => <button className="secondary" key={`${slot.owner}:${index}`} onClick={() => void openPanel(() => { if (slot.name === 'main') runtime.selectPanel(slot.key!); else runtime.openRightbar(); })}>{slot.label || slot.key || slot.owner}</button>)}</div>
          {!runtime.sidebarTabs.length && !runtime.slots.some(slot => ['main', 'rightbar'].includes(slot.name)) && <p className="field-help">已启用的插件尚未提供操作面板。</p>}
        </> : <div className="dsh-help"><section><h3>兼容范围</h3><p>支持插件安装、配置、主题、面板、命令，以及图片附件。</p><p>完整 Agent / Session、提示词、工具执行、MCP、终端及 Harness 私有桌面接口尚未全部接入。“已启用”表示插件完成加载，不代表所有功能都可用。</p></section><section><h3>安装与数据</h3><p>插件可访问本机宿主与页面。安装脚本默认关闭，可在安装确认中允许构建。卸载保留插件数据；部分全局脚本与样式需要重新加载页面才能移除。</p><p>插件通知遵循 Town 的通知设置。需要模型的能力先检查 Being 当前模型，不适配时再使用现有 subagent 配置。两者均不可用时显示原因。Being 当前接口暂不支持插件独立生成。</p></section><DshSlot name="settings.general.item" /></div>}</section>}
        {selected ? <section className="settings-detail-page" id={`dsh-detail-${selected.id}`} aria-label={`${selected.id} 设置`}>{pluginSettings}</section> : <>
        <div className="dsh-list-toolbar"><input type="search" aria-label="搜索已安装插件" placeholder="搜索已安装插件…" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="插件状态" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部状态</option><option value="enabled">已启用</option><option value="disabled">已停用</option><option value="issue">需要处理</option></select><span className="dsh-list-count">{runtime.state.plugins.length} 个已安装</span></div>
        {!runtime.state.plugins.length ? <div className="dsh-empty"><h3>添加你的第一个插件</h3><p>安装第三方插件，为 Town 添加面板、主题和工具。</p><button className="secondary" onClick={() => requestLeave(() => runtime.openManager('install'))}>选择插件来源</button></div> : !visible.length ? <p className="dsh-empty">没有符合条件的插件。<button className="text-button" onClick={() => { setQuery(''); setFilter('all'); }}>清除筛选</button></p> : <div className="dsh-plugin-list">{visible.map(plugin => {
          const issue = pluginIssue(plugin, runtime.errors[plugin.id]);
          return <article className="dsh-plugin-row" key={plugin.id}>
            <button className="dsh-plugin-select" aria-label={`配置 ${plugin.id}`} disabled={busy || formState.busy} onClick={() => requestLeave(() => runtime.openPlugin(plugin.id))}>
              <span className="dsh-plugin-row-heading"><strong>{plugin.id}</strong><span className="dsh-plugin-version">v{plugin.version}</span><span className="dsh-status" data-issue={!!issue || undefined}>{issue ? '需要处理' : !plugin.enabled ? '已停用' : runtime.needsReload(plugin.id) ? '待重新加载' : !runtime.clientsReady(plugin.id) ? '正在启动' : plugin.limitations?.length ? '部分能力受限' : '已启用'}</span></span>
              <span className="dsh-plugin-description">{plugin.description || '此插件未提供描述。'}</span>
              <span className="dsh-row-open" aria-hidden="true"><Icon name="disclosure-down" /></span>
            </button>
          </article>;
        })}</div>}
        </>}
      </div>
      </div>
    </>;
  return <>
    {createPortal(<Dialog id="dsh-install-dialog" open={runtime.managerPage === 'install' && Boolean(runtime.managerHost || runtime.managerOpen)} busy={busy} onClose={() => { setError(''); runtime.openManager(); }} aria-labelledby="dsh-install-title" dismissOnBackdrop>
      <div className="dialog-heading"><h2 id="dsh-install-title">安装插件</h2><button className="close" aria-label="关闭安装插件" disabled={busy} onClick={() => { setError(''); runtime.openManager(); }} /></div>
      <form className="dialog-form" onSubmit={async event => {
        event.preventDefault();
        if (await act(() => api!.install(source.trim()))) { setSource(''); runtime.openManager(); setNotice('插件已安装。'); }
      }}>
        <div className="dialog-body">
          <p className="field-help">输入 npm 包名、Git 地址，或选择本地插件包。</p>
          <label htmlFor="dsh-source">插件来源</label>
          <input id="dsh-source" autoFocus value={source} onChange={event => setSource(event.target.value)} placeholder="包名、Git URL 或本地路径" disabled={busy} />
          <div className="dsh-install-alternatives"><button className="secondary" type="button" disabled={busy || !canActivate} onClick={async () => {
            if (await act(() => api!.install())) { setSource(''); runtime.openManager(); setNotice('插件已安装。'); }
          }}>选择本地插件</button><a href="https://dshopen.org/zh/" target="_blank" rel="noreferrer">浏览社区插件 ↗</a></div>
          <p className="field-help">安装前会显示来源和权限确认。并非所有 Harness 能力都已接入，缺少依赖时会说明原因。</p>
          {busy && <p className="dsh-operation-status" role="status">正在安装并加载插件，请稍候…</p>}
          {error && <div className="dsh-operation-issue" role="alert"><strong>安装未完成</strong><span>{error}</span></div>}
        </div>
        <div className="dialog-footer"><button className="secondary" type="button" disabled={busy} onClick={() => { setError(''); runtime.openManager(); }}>取消</button><button className="primary" type="submit" disabled={busy || !source.trim() || !canActivate}>{busy ? '正在安装…' : '安装'}</button></div>
      </form>
    </Dialog>, document.body)}
    {runtime.managerHost ? createPortal(<section id="third-party-plugins" className="dsh-manager-embedded" aria-label="第三方插件" aria-busy={busy || formState.busy || undefined}>{manager}</section>, runtime.managerHost) : runtime.managerOpen && !runtime.settingsNavigate && <><div className="dsh-manager-backdrop" onClick={close} /><Dialog id="third-party-plugins" modal={false} busy={busy || formState.busy} open onClose={close} aria-labelledby="dsh-manager-title" tabIndex={-1} dismissOnBackdrop>{manager}</Dialog></>}
    <DshNavigation boundary={PluginBoundary} openOnboarding={id => setExplicitStep(id)} />
    {runtime.mainPanel && <section className="dsh-main-panel"><header><button className="secondary" onClick={() => { runtime.selectPanel(null); }}>返回 Town</button></header><PluginBoundary key={runtime.mainPanel} resetKey={runtime.lifecycleVersion}><DshSlot name="main" options={{ entryKey: runtime.mainPanel }} /></PluginBoundary></section>}
    {drawerHost && createPortal(<DrawerPresence open={runtime.rightbar.open}>{runtime.rightbar.open && <WorkspaceDrawer className={`dsh-rightbar ${runtime.rightbar.fullscreen ? 'fullscreen' : ''}`} aria-label="插件操作面板">
      <header className="dsh-rightbar-heading"><h2>{runtime.sidebarTabs.find(tab => tab.id === runtime.activeSidebarTab)?.title() || '插件面板'}</h2>
        <button aria-label={runtime.rightbar.fullscreen ? '还原插件侧栏' : '展开插件侧栏'} title={runtime.rightbar.fullscreen ? '还原插件侧栏' : '展开插件侧栏'} aria-pressed={runtime.rightbar.fullscreen} onClick={() => runtime.toggleRightbarFullscreen()}><Icon name={runtime.rightbar.fullscreen ? 'split-panel' : 'expand'} /></button>
        <button aria-label="关闭插件侧栏" title="关闭插件侧栏" onClick={() => runtime.closeRightbar()}><Icon name="close" /></button>
      </header>
      <PluginBoundary resetKey={runtime.lifecycleVersion}><div className="dsh-rightbar-content">
        <DshLimitations owner={runtime.slots.find(slot => slot.name === 'sidebar.right.pane.tab' && slot.key === runtime.activeSidebarTab)?.owner} />
        <div className="dsh-pane-slot" ref={rightbarSlot}>{runtime.activeSidebarTab ? <DshSlot name="sidebar.right.pane.tab" options={{ entryKey: runtime.activeSidebarTab }} /> : <DshSlot name="rightbar" owner={{ width: rightbarWidth, viewportWidth: innerWidth, canShow: true }} />}</div>
      </div></PluginBoundary>
    </WorkspaceDrawer>}</DrawerPresence>, drawerHost)}
    {onboarding && <PluginBoundary key={onboarding.id}><DshSlot name="settings.onboarding" options={{ only: onboarding.id }} owner={{ stepId: onboarding.id, explicit: !!explicitStep, complete: () => { setCompleted(previous => [...previous, onboarding.id!]); setExplicitStep(undefined); }, openSection: (id: string) => { runtime.openSettingsSection(id); } }} /></PluginBoundary>}
    <div className="dsh-shell-overlay"><PluginBoundary resetKey={runtime.lifecycleVersion}><DshSlot name="shell.overlay" /></PluginBoundary><PluginBoundary resetKey={runtime.lifecycleVersion}><DshSlot name="overlay" /></PluginBoundary><PluginBoundary resetKey={runtime.lifecycleVersion}><DshSlot name="app.overlay" /></PluginBoundary></div>
  </>;
}

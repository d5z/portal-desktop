import { DshNavigation } from './navigation';
import { DshConfigForm } from './config-form';
import { Component, useState, type ReactNode } from 'react';
import { useModel } from '../../shared/hooks/use-model';
import { dshRuntime, DshSlot, DshSurfaceContext } from './runtime';
import { Dialog } from '../../shared/components/dialog';
import { useManagerFocus } from './use-manager-focus';
import './styles.scss';
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
function DshPluginContent({ degraded = false }: { degraded?: boolean }) {
  const runtime = useModel(dshRuntime);
  const [source, setSource] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const reload = runtime.restartRequired;
  const [formState, setFormState] = useState({ dirty: false, busy: false });
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const requestLeave = (action: () => void) => {
    if (busy || formState.busy) return;
    if (formState.dirty) setLeave(() => action); else action();
  };
  const close = () => requestLeave(() => runtime.closeManager());
  useManagerFocus(runtime.managerOpen, close);
  const api = window.beings?.dshPlugins;
  const act = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { const result = await operation(); if (result !== false) { await runtime.applyChanges(); } }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  const [completed, setCompleted] = useState<string[]>([]);
  const [explicitStep, setExplicitStep] = useState<string>();
  const slots = runtime.slots.filter(slot => ['settings.section', 'settings.plugins.tab', 'settings.plugin.item', 'plugins.bundle.config'].includes(slot.name));
  const onboarding = runtime.slots.filter(s => s.name === 'settings.onboarding').sort((a, b) => (a.order || 0) - (b.order || 0)).find(s => explicitStep ? s.id === explicitStep : !completed.includes(s.id!));
  return <>
    {runtime.managerOpen && <div className="dsh-manager-backdrop" onClick={close} />}
    {runtime.managerOpen && <Dialog id="third-party-plugins" modal={false} busy={busy || formState.busy} open onClose={close} aria-labelledby="dsh-manager-title" tabIndex={-1} dismissOnBackdrop>
      <header className="dsh-manager-heading">
        {(runtime.panel || runtime.configuration) && <button className="dsh-back" disabled={busy || formState.busy} aria-label="返回插件管理" onClick={() => requestLeave(() => runtime.openManager())}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></button>}
        <div><DshSlot name="settings.header" /><h2 id="dsh-manager-title">{runtime.panel?.label || runtime.configuration?.ns || '第三方插件'}</h2><p>{runtime.panel?.owner || runtime.configuration?.owner || '安装和管理兼容 DSH 的插件'}</p></div>
        <DshSlot name="settings.action" /><button className="close" aria-label="关闭" disabled={busy || formState.busy} onClick={close}><span className="dsh-sr-only" aria-hidden="true"><DshSlot name="settings.close" /></span></button>
      </header>
      {leave && <div className="dsh-unsaved" role="alert"><p>配置尚未保存，是否放弃更改？</p><button className="secondary" onClick={() => setLeave(null)}>继续编辑</button><button className="secondary" onClick={() => { const action = leave; setLeave(null); setFormState({ dirty: false, busy: false }); action(); }}>放弃更改</button></div>}
      <div className="dsh-manager-body" key={runtime.panel ? `${runtime.panel.owner}:${runtime.panel.id || runtime.panel.key || runtime.panel.name}` : 'manager'}>
      {runtime.configuration ? <PluginBoundary resetKey={runtime.lifecycleVersion}><DshConfigForm key={runtime.configuration.ns} view={runtime.configuration} onState={setFormState} /></PluginBoundary> : runtime.panel ? <div className="dsh-plugin-content"><PluginBoundary resetKey={runtime.lifecycleVersion}><DshSlot name={runtime.panel.name} owner={{ close }} options={{ only: runtime.panel.id, entryKey: runtime.panel.key }} /></PluginBoundary></div> : <>
        <DshSlot name="settings.general.item" /><form className="dsh-install" onSubmit={e => { e.preventDefault(); if (api) void act(() => api.install(source.trim())); }}>
          <label htmlFor="dsh-source">npm 包名、Git URL 或本地包路径</label>
          <div><input id="dsh-source" value={source} onChange={e => setSource(e.target.value)} placeholder="例如 dsh-boot-suite 或 https://github.com/作者/插件.git" disabled={busy} /><button className="primary" disabled={busy || !source.trim() || !api}>安装</button><button className="secondary" type="button" disabled={busy || !api} onClick={() => void act(() => api!.install())}>选择本地插件</button></div>
        </form>
        {busy && <p role="status">正在处理插件，请稍候…</p>}
        {runtime.phase === 'loading' && <p role="status">插件正在加载，Town 可继续使用。</p>}
        {degraded && <p role="alert">插件界面出现异常。可在此停用插件后重新加载，恢复界面。</p>}
        {(error || runtime.state.error) && <p role="alert">{error || runtime.state.error}</p>}
        {Object.entries(runtime.errors).filter(([id]) => !runtime.state.plugins.some(p => p.id === id)).map(([id, message]) => <p key={id} role="alert">{id}：{message}</p>)}
        {reload && <p className="dsh-reload" role="status">插件状态已保存。部分全局脚本或未完成的清理需要重新加载；其他插件可继续使用。重新加载前请保留未发送的草稿。 <button className="primary" onClick={() => location.reload()}>重新加载页面</button></p>}
        {!runtime.state.plugins.length && <p className="field-help">尚未安装第三方插件。原有 Town 接口插件仍在工具库中管理。</p>}
        {runtime.state.plugins.map(plugin => <article className="plugin-card" key={plugin.id}>
          <h3>{plugin.id} <span className="mini-tag">第三方 · DSH</span></h3><p>{plugin.description}</p><p className="card-meta">v{plugin.version} · {runtime.needsReload(plugin.id) ? '等待重新加载' : plugin.enabled ? plugin.status === 'active' && !runtime.errors[plugin.id] ? '已加载' : '加载受阻' : '已停用'}</p>
          {(plugin.error || runtime.errors[plugin.id]) && <p role="alert">{plugin.error || runtime.errors[plugin.id]}</p>}
          <div className="dsh-actions"><button className="secondary" disabled={busy} onClick={() => void act(() => api!.enable(plugin.id, !plugin.enabled))}>{plugin.enabled ? '停用' : '启用'}</button><button className="secondary" disabled={busy} onClick={() => void act(() => api!.remove(plugin.id))}>卸载</button><button className="secondary" disabled={busy} onClick={() => void act(() => api!.install(plugin.source))}>更新／重新安装</button></div>
          <div className="dsh-contributions">{runtime.configurationViews.filter(view => !runtime.needsReload(plugin.id) && plugin.enabled && view.owner === plugin.id && view.autoGenerate && Object.keys(view.schema?.dict || {}).length).map(view => <button key={view.ns} className="secondary" onClick={() => { runtime.configuration = view; runtime.changed(); }}>{view.ns} 配置</button>)}{plugin.enabled && !runtime.needsReload(plugin.id) && runtime.slots.filter(s => s.owner === plugin.id && ['main', 'rightbar'].includes(s.name)).map((slot, i) => <button className="secondary" key={slot.id || slot.key || i} onClick={() => { runtime.panel = slot; runtime.changed(); }}>{slot.label || slot.id || slot.key || '打开插件面板'}</button>)}
          {plugin.enabled && !runtime.needsReload(plugin.id) && slots.filter(s => s.owner === plugin.id).map((slot, index) => <button className="secondary" key={slot.id || index} onClick={() => { runtime.panel = slot; runtime.changed(); }}>{slot.label || slot.id || '插件设置'}</button>)}</div>
        </article>)}
        <details className="dsh-compatibility"><summary>兼容能力与限制</summary><p>支持 npm／Git／本地包安装、Cordis 生命周期与配置、Host 路由、全局脚本与样式、客户端模块、设置和独立面板插槽。启停与卸载会清理插件注册的入口、服务和受管理的副作用。插件注入的全局脚本或无法完成的清理仍需重新加载页面；未受影响的插件继续可用。</p><p>已接入 DSH 插槽、store、配置表单与通用 UI 组件。Agent／Session、模型供应商、工具执行、MCP、终端、自动化任务及 Harness 专用桌面 IPC 尚未桥接。依赖这些能力的插件会显示缺失依赖，不能视为完整兼容。Being 仍由 Town 原有服务管理。</p><p>第三方插件拥有本机宿主和主页面访问能力；安装脚本默认禁用；安装确认中可按需允许依赖构建。原生依赖仍须兼容当前系统和宿主 Node 版本。插件系统通知需先在 Town 设置中打开通知总开关。</p></details>
      </>}
      </div>
    </Dialog>}
    <DshNavigation boundary={PluginBoundary} openOnboarding={id => setExplicitStep(id)} />
    {runtime.mainPanel && <section className="dsh-main-panel"><header><button className="secondary" onClick={() => { runtime.selectPanel(null); }}>返回 Town</button></header><PluginBoundary key={runtime.mainPanel} resetKey={runtime.lifecycleVersion}><DshSlot name="main" options={{ entryKey: runtime.mainPanel }} /></PluginBoundary></section>}
    {runtime.rightbar.open && <aside className={`dsh-rightbar ${runtime.rightbar.fullscreen ? 'fullscreen' : ''}`}><button aria-label="关闭插件侧栏" onClick={() => { runtime.closeRightbar(); }}>关闭</button><PluginBoundary resetKey={runtime.lifecycleVersion}><DshSlot name="rightbar" owner={{ width: Math.min(400, innerWidth), viewportWidth: innerWidth, canShow: true }} /></PluginBoundary></aside>}
    {onboarding && <PluginBoundary key={onboarding.id}><DshSlot name="settings.onboarding" options={{ only: onboarding.id }} owner={{ stepId: onboarding.id, explicit: !!explicitStep, complete: () => { setCompleted(previous => [...previous, onboarding.id!]); setExplicitStep(undefined); }, openSection: (id: string) => { runtime.panel = runtime.slots.find(s => s.name === 'settings.section' && s.id === id); runtime.managerOpen = true; runtime.changed(); } }} /></PluginBoundary>}
    <div className="dsh-shell-overlay"><PluginBoundary resetKey={runtime.lifecycleVersion}><DshSlot name="shell.overlay" /></PluginBoundary><PluginBoundary resetKey={runtime.lifecycleVersion}><DshSlot name="overlay" /></PluginBoundary><PluginBoundary resetKey={runtime.lifecycleVersion}><DshSlot name="app.overlay" /></PluginBoundary></div>
  </>;
}

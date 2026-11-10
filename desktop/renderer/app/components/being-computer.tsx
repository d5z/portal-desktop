import { WorkspaceDrawer } from "../../shared/components/workspace-drawer";
import { Icon } from '../../shared/icons/icon';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SplitChatToggle } from './navigation';
import { PanelResizeHandle, usePanelWidth } from '../../shared/components/panel-resize';
import type { HomeAPI, HomeAction, HomeState } from '../../../shared/home';
function ComputerPresence({ loading = false }: { loading?: boolean }) {
  return <svg className="being-computer-presence" data-loading={loading || undefined} viewBox="0 0 48 48" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="7" y="9" width="34" height="26" rx="7" /><path d="M18 41h12m-6-6v6" />
    <path className="being-computer-eyes" d="M19 20v5m10-5v5" strokeWidth="3" />
  </svg>;
}
function ComputerLoading({ label }: { label: string }) {
  return <span className="being-computer-preview-placeholder" role="status"><ComputerPresence loading /><span>{label}</span></span>;
}
const initial: HomeState = { authenticated: false, authenticating: false, viewer: 'closed' };
export function BeingComputer({ name, api, active, context, browserHost, available = true }: {
  name: string; api?: HomeAPI; active: boolean; context: string;
  browserHost?: HTMLElement | null; available?: boolean;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [width, setWidth] = usePanelWidth('cloud-browser', Math.round(innerWidth * .58));
  const panel = useRef<HTMLElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState(initial);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<HomeAction>();
  const [confirmation, setConfirmation] = useState<'bind' | 'stop' | 'recreate' | 'logout'>();
  const viewport = useRef<HTMLDivElement>(null);
  const previewViewport = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const autoOpen = useRef(false);
  const viewing = state.viewer === 'loading' || state.viewer === 'page';
  const showPanel = panelOpen && available && viewing;
  useEffect(() => api?.onExpand?.(() => { if (active && available && viewing) setPanelOpen(true); }), [api, active, available, viewing]);
  const collapse = () => { setPanelOpen(false); setMaximized(false); requestAnimationFrame(() => openButton.current?.focus()); };
  useEffect(() => { if (showPanel) closeButton.current?.focus(); }, [showPanel]);
  useEffect(() => { if (!viewing) setPreview(null); }, [viewing]);
  useEffect(() => { if (!state.authenticated || state.binding !== 'matched' || state.computer?.status === 'stopped') setPanelOpen(false); }, [state.authenticated, state.binding, state.computer?.status]);
  useEffect(() => {
    if (!api?.preview || !viewing || (!active && !showPanel) || (showPanel && !menuOpen && !confirmation)) return;
    let cancelled = false;
    const capture = async () => {
      try { const image = await api.preview(); if (!cancelled && image) setPreview(image); } catch { /* Opening remains available if preview is temporarily unavailable. */ }
    };
    void capture();
    return () => { cancelled = true; };
  }, [api, active, showPanel, viewing, state.viewer, context, menuOpen, confirmation]);
  useEffect(() => { if (!active) setMenuOpen(false); }, [active]);
  useEffect(() => { autoOpen.current = false; setPreview(null); setPanelOpen(false); }, [context]);
  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setMenuOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [menuOpen]);
  const run = async (action: HomeAction) => {
    if (!api) return;
    setBusy(action); setConfirmation(undefined); setMenuOpen(false);
    if (action === 'close' || action === 'logout') setPanelOpen(false);
    try { const next = await api.action(action); setState(next); if (next.error && !next.pending) autoOpen.current = false; }
    catch { setState(previous => ({ ...previous, error: '无法完成操作，请重试。' })); }
    finally { setBusy(undefined); }
  };
  useEffect(() => {
    if (!api) { setLoaded(true); return; }
    let mounted = true, received = false;
    const stop = api.subscribe(value => { received = true; if (mounted) { setState(value); setLoaded(true); } });
    void api.state().then(value => { if (mounted && !received) { setState(value); setLoaded(true); } }).catch(() => { if (mounted) { setLoaded(true); setState(previous => ({ ...previous, error: '无法读取 Home 状态，请刷新重试。' })); } });
    return () => { mounted = false; stop(); };
  }, [api]);
  useEffect(() => {
    if (!api || (!active && !viewing)) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const poll = async () => {
      try {
        const next = await api.refresh();
        if (!cancelled) { setState(next); setLoaded(true); failures = next.error ? failures + 1 : 0; }
      } catch { failures++; }
      if (!cancelled) timer = setTimeout(poll, Math.min(30_000, (state.pending ? 3000 : (active || showPanel) ? 15_000 : 30_000) * 2 ** Math.min(failures, 3)));
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [api, active, context, viewing, showPanel, state.pending]);
  useEffect(() => {
    if (!active || !autoOpen.current || busy || state.pending || !state.browserReady || state.computer?.status !== 'running') return;
    autoOpen.current = false;
    void run('open');
  }, [active, busy, state.pending, state.browserReady, state.computer?.status]);
  useLayoutEffect(() => {
    if (!api) return;
    if (!available || !viewing || (!active && !showPanel)) { void api.bounds({ x: 0, y: 0, width: 0, height: 0, visible: false }).catch(() => {}); return; }
    let last = '', frame = 0;
    const layout = () => {
      const el = showPanel ? viewport.current : previewViewport.current;
      if (!el) return;
      const blocked = menuOpen || !!confirmation || !!el.closest('[hidden], [data-animating]') || !!document.querySelector('dialog[open], [data-resizing="true"]');
      const b = el.getBoundingClientRect(), clip = el.closest('.being-info-content')?.getBoundingClientRect();
      // A scrolled-out region must not intercept another surface's input.
      const visible = !blocked && b.width > 0 && b.height > 0 && b.y >= 0 && b.bottom <= innerHeight && b.x >= 0 && b.right <= innerWidth &&
        (!clip || (b.top >= clip.top && b.bottom <= clip.bottom && b.left >= clip.left && b.right <= clip.right));
      const bounds = { x: b.x, y: b.y, width: b.width, height: b.height, visible, dark: document.documentElement.dataset.theme === 'dark' || document.body.dataset.theme === 'dark', presentation: showPanel ? 'browser' as const : 'preview' as const };
      const value = JSON.stringify(bounds);
      if (value !== last) { last = value; void api.bounds(bounds).catch(() => { last = ''; }); }
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(layout); };
    layout();
    const resize = new ResizeObserver(schedule);
    const target = showPanel ? viewport.current : previewViewport.current; if (target) resize.observe(target);
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open', 'hidden', 'data-resizing', 'class', 'data-theme'], childList: true });
    window.addEventListener('beings:drawer-motion', schedule);
    window.addEventListener('resize', schedule); document.addEventListener('scroll', schedule, true);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); observer.disconnect(); window.removeEventListener('beings:drawer-motion', schedule); window.removeEventListener('resize', schedule); document.removeEventListener('scroll', schedule, true); };
  }, [api, active, available, viewing, showPanel, confirmation, menuOpen, maximized, browserHost]);
  // Only unmount or an actual hidden presentation hides the native view. Effect
  // dependency cleanup during maximize must not release the control lease.
  useEffect(() => () => { void api?.bounds({ x: 0, y: 0, width: 0, height: 0, visible: false }).catch(() => {}); }, [api]);
  const running = state.computer?.status === 'running';
  const pending = !!state.pending || ['starting', 'stopping'].includes(state.computer?.status || '');
  const ready = state.authenticated && state.binding === 'matched' && state.enabled && state.storageReady;
  let title = '电脑正在休眠', detail = '';
  let action: HomeAction | undefined = 'wake', label = '唤醒';
  if (!api) { title = '云电脑'; detail = '请在桌面客户端连接 Being Home。'; action = undefined; }
  else if (!loaded) { title = '正在连接…'; detail = ''; action = undefined; }
  else if (state.authenticating) { title = '等待登录'; detail = '在系统浏览器中完成授权，然后回到这里。'; action = 'cancel-login'; label = '取消登录'; }
  else if (!state.authenticated) { title = '连接云电脑'; detail = '登录 Being Home，使用你的云端浏览器。'; action = 'login'; label = '连接 Being Home'; }
  else if (state.needsInitialization) { title = '准备你的云电脑'; detail = '先为当前 Home 账号初始化 Being。'; action = 'initialize'; label = '初始化 Being'; }
  else if (state.binding === 'no-connection') { title = '先连接一个 Being'; detail = '在连接设置中添加 Being 后，回到这里关联云电脑。'; action = undefined; }
  else if (state.binding === 'missing') { title = '关联当前 Being'; detail = `将 ${name} 关联到 Home 账号 ${state.username || ''}。`; action = 'bind'; label = '关联 Being'; }
  else if (state.binding === 'mismatch') { title = 'Home 账号关联了其他 Being'; detail = '请退出 Home，登录与当前 Being 对应的账号。'; action = 'logout'; label = '退出 Home'; }
  else if (state.enabled === undefined) { title = '正在连接…'; detail = ''; action = undefined; }
  else if (!state.enabled) { title = '云电脑暂不可用'; detail = '当前 Home 尚未启用云电脑。'; action = undefined; }
  else if (!state.storageReady) { title = '正在准备云端存储'; detail = '准备完成后即可唤醒电脑。'; action = undefined; }
  else if (pending) {
    title = state.pending === 'stop' ? '正在停止…' : state.pending === 'recreate' ? '正在恢复…' : '正在唤醒…';
    detail = state.operation ? '' : '请求结果尚未确认，可继续同一次操作。';
    action = state.operation ? undefined : state.pending === 'stop' ? 'stop' : state.pending === 'recreate' ? 'recreate' : 'wake'; label = '继续操作';
  } else if (running && !state.browserReady) { title = '正在准备浏览器…'; detail = ''; action = undefined; }
  else if (running) { title = '浏览器已就绪'; detail = ''; action = 'open'; label = '打开浏览器'; }
  else if (state.computer?.status === 'error') { title = '电脑需要恢复'; detail = '重新创建运行环境，保留工作区文件。'; action = 'recreate'; label = '恢复电脑'; }
  else if (state.computer && state.computer.status !== 'stopped') { title = '正在确认电脑状态'; detail = '稍后刷新后再试。'; action = undefined; }
  if (ready && (state.viewer === 'expired' || state.viewer === 'error') && running) { title = state.viewer === 'expired' ? '查看会话已过期' : '浏览器连接中断'; detail = '重新打开以建立新的查看会话。'; label = '重新打开'; }
  const loading = !loaded || !!busy || pending || (!!ready && running && !state.browserReady);
  const activate = (next: HomeAction) => {
    if (['bind', 'stop', 'recreate', 'logout'].includes(next)) { autoOpen.current = false; setMenuOpen(false); setConfirmation(next as typeof confirmation); return; }
    if (next === 'wake') autoOpen.current = true;
    void run(next);
  };
  const refresh = async () => {
    if (!api || refreshing) return;
    setRefreshing(true);
    try { setState(await api.refresh()); }
    catch { setState(previous => ({ ...previous, error: '刷新未完成，请稍后重试。' })); }
    finally { setRefreshing(false); }
  };
  const controls = api && <div className="being-computer-controls" ref={menu} onKeyDown={event => {
    if (event.key === 'Escape' && menuOpen) { event.stopPropagation(); setMenuOpen(false); menu.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus(); }
  }}>
    <button type="button" className="topbar-icon-button" aria-label="刷新电脑状态" title="刷新状态" aria-busy={refreshing} disabled={!!busy || refreshing}
      onClick={() => void refresh()}><Icon name="refresh" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></button>
    {state.authenticated && <button type="button" className="topbar-icon-button" aria-label="电脑更多操作" title="更多" aria-haspopup="true" aria-expanded={menuOpen}
      onClick={() => setMenuOpen(value => !value)}><Icon name="more" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></button>}
    {menuOpen && <div className="being-computer-menu" aria-label="电脑操作">
      {viewing && <button type="button" disabled={!!busy} onClick={() => void run('open')}>重新连接浏览器</button>}
      {viewing && <button type="button" onClick={() => { autoOpen.current = false; void run('close'); }}>关闭浏览器</button>}
      {ready && running && !pending && <button type="button" disabled={!!busy} onClick={() => activate('stop')}>停止电脑…</button>}
      <button type="button" disabled={!!busy} onClick={() => activate('logout')}>退出 Home…</button>
    </div>}
  </div>;
  const feedback = <>{state.error && <p className="being-computer-error" role="alert">{state.error}</p>}
    {confirmation && <div className="being-computer-confirm" role="group" aria-label="确认云电脑操作">
      <p>{confirmation === 'bind' ? `将当前 ${name} 的连接授权给 Home 账号 ${state.username || ''}，由 Home 保存并用于访问这个 Being。`
        : confirmation === 'stop' ? '停止云电脑将中断当前浏览器和运行中的任务，工作区文件会保留。'
        : confirmation === 'recreate' ? '恢复电脑会重建运行环境并中断当前任务，工作区文件会保留。' : '退出此设备上的 Home 登录，云端电脑继续运行。'}</p>
      <div><button className="primary" type="button" disabled={!!busy} onClick={() => void run(confirmation)}>确认{confirmation === 'bind' ? '关联' : confirmation === 'stop' ? '停止' : confirmation === 'recreate' ? '恢复' : '退出'}</button>
        <button type="button" onClick={() => setConfirmation(undefined)}>取消</button></div>
    </div>}</>;
  return <>
    <figure className="being-computer" aria-busy={loading || state.viewer === 'loading'}>
      {viewing ? <div className="being-computer-preview">
        <div ref={previewViewport} className="being-computer-live-preview" aria-label="电脑实时视口">
          {preview && <img src={preview} alt="" />}
          {!preview && <ComputerLoading label="正在连接…" />}
        </div>
        <button ref={openButton} type="button" className="being-computer-open" aria-label="放大展示云端浏览器" onClick={() => setPanelOpen(true)}><Icon name="expand" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />放大展示</button>
      </div> : <div className="being-computer-screen" data-connection={running ? 'running' : 'sleeping'}>
        <ComputerPresence loading={loading} />
        <strong role="status">{busy === 'wake' ? '正在唤醒…' : busy === 'open' ? '正在连接…' : title}</strong>{detail && !busy && <p>{detail}</p>}
        {action && (!busy || action === 'cancel-login') && <button className="primary being-computer-primary" type="button" disabled={!!busy && action !== 'cancel-login'} onClick={() => activate(action!)}>{busy && !state.authenticating ? '请稍候…' : label}</button>}
      </div>}
      <figcaption className="being-computer-footer"><span>{name} 的屏幕</span>{!showPanel && controls}</figcaption>
      {!showPanel && feedback}
    </figure>
    {browserHost && createPortal(<WorkspaceDrawer ref={panel} className="cloud-browser-pane" aria-label="云端浏览器" open={showPanel} data-maximized={maximized || undefined}
      style={{ width, flexBasis: width }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); if (confirmation) setConfirmation(undefined); else if (!menuOpen) collapse(); } }}>
      <PanelResizeHandle panel={panel} label="调整云端浏览器宽度" width={width} onResize={setWidth} initial={Math.round(innerWidth * .58)} min={360} max={1800} reserve={320} disabled={!showPanel || maximized} />
      <header className="place-sheet-heading cloud-browser-heading"><div className="place-sheet-title-row">
        <div className="place-sheet-title-main">{showPanel && <SplitChatToggle expanded={!maximized} onToggle={() => setMaximized(value => !value)} />}<h2>{name} 的电脑</h2></div>
        <button ref={closeButton} className="icon-button close" type="button" title="关闭面板" aria-label="关闭云电脑面板" onClick={collapse} />
      </div></header>
      <div className="being-computer-viewport" ref={viewport} aria-label="云端浏览器画面">{preview ? <img src={preview} alt="" /> : <ComputerLoading label="正在连接…" />}</div>
      {showPanel && feedback}
    </WorkspaceDrawer>, browserHost)}
  </>;
}

import { LocalRemote } from './remote';
import settingsPluginsURL from '@deepseek-ai/dsh-client-ui-settings-plugins/client?url';
import settingsURL from '@deepseek-ai/dsh-client-ui-settings/client?url';
import TimerService from '@deepseek-ai/cordis-plugin-timer';
import { observeDshAppearance } from './appearance';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as JSXRuntime from 'react/jsx-runtime';
import { Context } from '@deepseek-ai/cordis';
import * as Cordis from '@deepseek-ai/cordis';
import * as SlotCore from '@deepseek-ai/dsh-client-ui-slots';
import * as DshStore from '@deepseek-ai/dsh-client-store';
import rendererURL from '@deepseek-ai/dsh-client-ui-renderer/client?url';
import { DSH_SLOTS, type DshClientModule, type DshPluginState } from '../../../shared/dsh-plugins';
import { Store } from '../../shared/models/store';
import { installPresentationServices } from './services';

type Slot = { name: string; id?: string; key?: string; order?: number; label?: string; component: React.ComponentType<any>; owner: string };
type Module = { id: string; factory(require: (id: string) => any): any };
export const DshSlotContext = React.createContext<any>(null);
export const DshSurfaceContext = React.createContext<React.ReactNode>(null);
function TownSlotRoot(props: any) { return <DshSlotContext.Provider value={props}>{React.useContext(DshSurfaceContext)}</DshSlotContext.Provider>; }
export function DshSlot({ name, owner = {}, options }: { name: string; owner?: any; options?: any }) {
  const props = React.useContext(DshSlotContext);
  return props?.renderSlot(name, owner, options) ?? null;
}
/** Town owns the surface; the published standalone renderer owns DSH slot semantics. */
export class DshClientRuntime extends Store {
  state: DshPluginState = { plugins: [], clients: [], routes: [], injections: [] };
  errors: Record<string, string> = {};
  panel?: Slot;
  configurationViews: any[] = [];
  configuration?: any;
  configForm(ns: string): any { return (this.ctx.get('configForms') as any).get(ns); }
  async refreshForms() { try { const result = await (this.ctx.get('remote.settings') as any)?.describe(); this.configurationViews = result?.ok ? result.value.namespaces.map((view: any) => ({ ...view, schema: (this.ctx.get('settingsSchema') as any).rehydrate(view.schema) })) : []; this.changed(); } catch (error) { console.error(error); } }
  managerOpen = false;
  phase: 'loading' | 'ready' | 'error' = 'loading';
  lifecycleVersion = 0;
  private reloadOwners = new Set<string>();
  private cleanupFailures = new Set<string>();
  private injectionReloadRequired = false;
  get restartRequired() { return this.phase === 'error' || this.injectionReloadRequired || this.reloadOwners.size > 0; }
  needsReload(owner: string) { return this.reloadOwners.has(owner); }
  navigationHost: HTMLDivElement | null = null;
  setNavigationHost = (host: HTMLDivElement | null) => {
    if (host === this.navigationHost) return;
    this.navigationHost = host;
    this.changed();
  };
  get hasTools(): boolean {
    // Only explicit navigation contributions create entries; themes, startup
    // injections and settings sections alone leave the rail unchanged.
    return ['sidebar', 'sidebar.panellist', 'sidebar.footer', 'sidebar.footer.action', 'settings.launcher', 'settings.trigger'].some(name =>
      this.registry?.entries(name).some((entry: any) => {
        const owner = this.ownerByModule.get(entry.registrant) || entry.registrant;
        return this.state.plugins.some(plugin => plugin.id === owner && plugin.enabled);
      }),
    );
  }
  revealNavigation() {
    const entry = this.navigationHost?.querySelector<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]');
    entry?.scrollIntoView({ block: 'nearest' });
    entry?.focus({ preventScroll: true });
  }
  mainPanel: string | null = null;
  selectPanel(key: string | null) { (this.ctx.get('layout') as any)?.selectPanel(key); }
  closeRightbar() { (this.ctx.get('layout') as any)?.closeRightbar(); }
  rightbar = { open: false, track: true, fullscreen: false };
  private navigation = new AbortController();
  private modules = new Map<string, Module>();
  private exports = new Map<string, any>();
  private ctx = new Context();
  private registry: any;
  private starting?: Promise<void>;
  private ownerByModule = new Map<string, string>();
  private appliedPackages = new Map<string, string>();
  private injected = new Set<string>();
  private moduleKeys = new Map<string, string>();
  private fibers = new Map<string, { fiber: ReturnType<Context['plugin']>; owner: string; key: string; dependencies: Set<string> }>();
  private applying: Promise<void> = Promise.resolve();
  private appearanceActive = false;
  private presentation?: ReturnType<typeof installPresentationServices>;
  private packageKey(plugin: DshPluginState['plugins'][number]) {
    return JSON.stringify([plugin.version, plugin.source, plugin.installedAt]);
  }
  private clientKey(client: DshClientModule) {
    const owner = this.state.plugins.find(plugin => plugin.id === client.owner)!;
    return JSON.stringify([client.owner, this.packageKey(owner), client.url]);
  }
  private injectionKeys(rows: DshPluginState['injections']) {
    const counts = new Map<string, number>();
    return rows.map(row => {
      const signature = JSON.stringify(row), occurrence = counts.get(signature) || 0;
      counts.set(signature, occurrence + 1);
      return signature + ':' + occurrence;
    });
  }
  /** Reconcile the host's desired clients against live fibers. Never gate an
   * unrelated plugin on a peer's pending document reload. */
  applyChanges() {
    const apply = async () => {
      await this.start();
      await this.refresh();
      if (this.phase === 'error') throw new Error('插件运行环境初始化失败，请重新加载页面后重试。');
      const desired = new Map(this.state.clients.map(client => [client.id, client]));
      const nextInjections = new Set(this.injectionKeys(this.state.injections));
      this.injectionReloadRequired = [...this.injected].some(key => !nextInjections.has(key));
      this.reloadOwners = new Set(this.cleanupFailures);
      if (this.injectionReloadRequired) for (const [id, key] of this.appliedPackages) {
        const next = this.state.plugins.find(plugin => plugin.id === id && plugin.enabled);
        if (!next || this.packageKey(next) !== key) this.reloadOwners.add(id);
      }
      const removed = new Set([...this.fibers].filter(([id, live]) => {
        const next = desired.get(id);
        return !next || live.key !== this.clientKey(next) || live.fiber.uid === null || this.needsReload(live.owner);
      }).map(([id]) => id));
      // Factories can capture exports as well as declaring injected services.
      // Recreate consumers of a replaced/removed module, retaining other fibers.
      for (let changed = true; changed;) {
        changed = false;
        for (const [id, live] of this.fibers) if (!removed.has(id) && [...live.dependencies].some(dep => removed.has(dep))) {
          removed.add(id); changed = true;
        }
      }
      const disposals: Promise<void>[] = [];
      for (const [id, live] of [...this.fibers].reverse()) if (removed.has(id)) {
        this.fibers.delete(id); this.exports.delete(id); delete this.errors[live.owner];
        disposals.push(this.disposeClient(live));
      }
      await Promise.all(disposals);
      for (const owner of Object.keys(this.errors)) if (!this.state.plugins.some(p => p.id === owner && p.enabled) && !this.cleanupFailures.has(owner)) delete this.errors[owner];
      if (!this.injectionReloadRequired) for (const id of this.appliedPackages.keys()) {
        if (!this.state.plugins.some(plugin => plugin.id === id && plugin.enabled)) this.appliedPackages.delete(id);
      }
      await this.activate(this.state);
      // Reset subscribers only after removed consumers have unsubscribed and
      // the replacement host and client services are ready.
      (this.ctx as any).emit('connection/reset');
      await this.refreshForms();
      if (this.mainPanel && !this.slots.some(slot => slot.name === 'main' && slot.key === this.mainPanel)) this.selectPanel(null);
      if (this.rightbar.open && !this.slots.some(slot => slot.name === 'rightbar')) this.closeRightbar();
      if (this.panel && !this.slots.some(slot => slot.owner === this.panel!.owner && slot.name === this.panel!.name && slot.id === this.panel!.id && slot.key === this.panel!.key)) this.panel = undefined;
      if (this.configuration && !this.configurationViews.some(view => view.ns === this.configuration.ns)) this.configuration = undefined;
      this.lifecycleVersion++;
      this.changed();
    };
    const result = this.applying.then(apply);
    this.applying = result.catch(() => {});
    return result;
  }
  private async disposeClient({ fiber, owner }: { fiber: ReturnType<Context['plugin']>; owner: string }) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([fiber.dispose(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('插件清理超时，请重新加载页面完成清理。')), 2000);
      })]);
    } catch (error) {
      this.cleanupFailures.add(owner); this.reloadOwners.add(owner); this.errors[owner] = String(error);
    } finally { clearTimeout(timer); }
  }
  get slots(): Slot[] {
    if (!this.registry) return [];
    return DSH_SLOTS.flatMap(name => this.registry.entries(name).map((entry: any) => {
      const owner = this.ownerByModule.get(entry.registrant) || entry.registrant || 'Town';
      let label: string | undefined;
      try { label = SlotCore.resolveSlotLabel(entry.options.label); }
      catch (error) { this.errors[owner] ??= `插件入口名称加载失败：${String(error)}`; }
      return { ...entry.options, label, name, component: entry.component, owner };
    })).filter(slot => this.state.plugins.some(plugin => plugin.id === slot.owner && plugin.enabled && plugin.status === 'active') && !this.needsReload(slot.owner));
  }
  renderRoot() { return this.registry?.renderSlot('root', {}) ?? null; }
  openManager() { this.managerOpen = true; this.panel = undefined; this.configuration = undefined; void this.refreshForms(); this.changed(); }
  closeManager() { this.managerOpen = false; this.panel = undefined; this.configuration = undefined; this.changed(); }
  start() { return this.starting ??= this.boot(); }
  async refresh() { if (window.beings?.dshPlugins) this.state = await window.beings.dshPlugins.state(); this.changed(); }
  private require = (id: string): any => {
    const libraries: Record<string, any> = { react: React, 'react-dom': ReactDOM, 'react-dom/client': ReactDOMClient, 'react/jsx-runtime': JSXRuntime, '@deepseek-ai/cordis': Cordis, '@deepseek-ai/dsh-client-ui-slots': SlotCore, '@deepseek-ai/dsh-client-store': DshStore };
    if (id in libraries) return libraries[id];
    if (this.exports.has(id)) return this.exports.get(id);
    throw new Error(`Town 尚未提供客户端模块：${id}`);
  };
  private async boot() {
    const ready = (window as any).__DSH_BOOT_READY__ ??= (() => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; })();
    try {
      await this.refresh();
      (window as any).__ModuleLoader__ = { load: (module: Module) => {
        if (!module || typeof module.id !== 'string' || typeof module.factory !== 'function' || this.modules.has(module.id)) throw new Error('DSH 客户端模块重复或格式无效。');
        this.modules.set(module.id, module);
      } };
      await this.script(rendererURL);
      const renderer = this.modules.get('@deepseek-ai/dsh-client-ui-renderer')!.factory(this.require);
      const rendererFiber = this.ctx.plugin(renderer); await rendererFiber.await();
      const registry = this.ctx.get('slots') as any;
      new TimerService(this.ctx);
      const absentSession = DshStore.createSnapshotStore({ key: undefined, hooks: {}, keyedHooks: {}, props: {} });
      registry.installScope('session', { current: absentSession, bindingSource: (target: unknown) => { if (target !== undefined) throw new Error('Town 未连接 DSH Session'); return absentSession; }, renderArea: (_: unknown, props: any) => props.empty?.() ?? null });
      const presentation = this.presentation = installPresentationServices(this.ctx);
      registry.installLocale(presentation.locale);
      this.exports.set('@deepseek-ai/dsh-client-ui-renderer', renderer);
      this.exports.set('@deepseek-ai/dsh-client-ui-theme', presentation.theme);
      this.exports.set('@deepseek-ai/dsh-client-locale', presentation.locale);
      this.exports.set('@deepseek-ai/dsh-client-ui-slots', SlotCore);
      this.exports.set('@deepseek-ai/dsh-client-store', DshStore);
      // Settings use Town's authenticated local transport and the published form runtime.
      new LocalRemote(this.ctx);
      await this.script(settingsURL);
      const settings = this.modules.get('@deepseek-ai/dsh-client-ui-settings')!.factory(this.require);
      await this.ctx.plugin(settings).await();
      this.exports.set('@deepseek-ai/dsh-client-ui-settings', settings);
      const rootChildren = Object.fromEntries(DSH_SLOTS.map(name => [name, { kind: ['main', 'plugins.bundle.config', 'settings.plugin.item'].includes(name) ? 'keyed' : ['sidebar', 'rightbar', 'settings.trigger', 'settings.header', 'settings.close', 'settings.launcher'].includes(name) ? 'single' : 'list', scope: 'root' }]));
      registry.register({ name: 'root', children: rootChildren }, TownSlotRoot);
      (this.ctx as any).on('slots/changed', () => { this.changed(); });
      registry.onEntryError((name: string, entry: any, error: unknown) => { this.errors[this.ownerByModule.get(entry.registrant) || entry.registrant || name] = String(error); this.changed(); });
      const layoutStore = DshStore.createSnapshotStore({ activePanelId: null as string | null });
      registry.provideRoot({ hooks: { panelInfo: layoutStore } });
      // Publish only after root and its context are renderable.
      this.registry = registry;
      const layout = {
        panelInfo: layoutStore,
        selectPanel: (key: string | null) => { if (key && key !== 'conversation' && !this.registry.entries('main').some((s: any) => s.options.key === key)) throw new Error(`未知主面板：${key}`); this.navigation.abort(); this.mainPanel = key === 'conversation' ? null : key; layoutStore.set({ activePanelId: this.mainPanel }); this.changed(); },
        beginNavigation: () => { this.navigation.abort(); this.navigation = new AbortController(); return this.navigation.signal; },
        // Town keeps a compact navigation rail visible at all times.
        toggleSidebar: () => this.revealNavigation(),
        openRightbar: (track: boolean, fullscreen: boolean) => { this.rightbar = { open: true, track, fullscreen }; document.body.classList.toggle('dsh-rightbar-track', track && !fullscreen); this.changed(); },
        closeRightbar: () => { this.rightbar = { ...this.rightbar, open: false }; document.body.classList.remove('dsh-rightbar-track'); this.changed(); },
      };
      this.ctx.provide('layout', layout); this.exports.set('@deepseek-ai/dsh-client-ui-layout', layout);
      const connection = { isLoopback: true, fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init) };
      this.ctx.provide('connection', connection);
      this.exports.set('@deepseek-ai/dsh-client-connection', connection);
      this.exports.set('@deepseek-ai/dsh-client-runtime', renderer);
      await this.script(settingsPluginsURL);
      this.exports.set('@deepseek-ai/dsh-client-ui-settings-plugins', this.modules.get('@deepseek-ai/dsh-client-ui-settings-plugins')!.factory(this.require));
      await this.activate(this.state, ready);
      this.phase = 'ready';
      this.changed();
    } catch (error) { this.phase = 'error'; this.state.error = String(error); this.changed(); }
    finally { ready.resolve(); }
  }
  private async activate(state: DshPluginState, ready?: { resolve: () => void }) {
    if ((state.clients.length || state.injections.length) && !this.appearanceActive) {
      this.appearanceActive = true;
      document.body.dataset.townDsh = '';
      observeDshAppearance();
      // A persisted plugin theme may not be registered until its module loads.
      // Publish the current fallback without validating/changing that preference.
      this.presentation?.refreshAppearance();
    }
    for (const plugin of state.plugins) if (plugin.enabled && !this.needsReload(plugin.id)) this.appliedPackages.set(plugin.id, this.packageKey(plugin));
    if (state.clients.some(c => c.inject.includes('@deepseek-ai/dsh-client-ui-primitives')) && !this.exports.has('@deepseek-ai/dsh-client-ui-primitives')) this.exports.set('@deepseek-ai/dsh-client-ui-primitives', await import('@deepseek-ai/dsh-client-ui-primitives'));
    const injectionKeys = this.injectionKeys(state.injections);
    if (!this.injectionReloadRequired) for (const [index, row] of state.injections.entries()) {
      const key = injectionKeys[index];
      if (this.injected.has(key)) continue;
      try { await this.inject(row); this.injected.add(key); } catch (error) { this.errors[row.owner || 'index-inject'] = String(error); }
    }
    ready?.resolve();
    const clients = state.clients.filter(client => !this.needsReload(client.owner));
    await Promise.all(clients.map(async client => { try {
      const key = this.clientKey(client);
      if (this.moduleKeys.get(client.id) !== key) { this.modules.delete(client.id); this.exports.delete(client.id); }
      if (!this.modules.has(client.id)) { await this.script(client.url); this.moduleKeys.set(client.id, key); }
    } catch (error) { this.errors[client.owner] = String(error); } }));
    const pending = clients.filter(client => !this.fibers.has(client.id)).sort((a, b) => Number(!!b.immediately) - Number(!!a.immediately));
    while (pending.length) {
      const index = pending.findIndex(client => client.inject.every(id => this.exports.has(id)));
      if (index < 0) {
        for (const client of pending) this.errors[client.owner] = '缺少客户端模块：' + client.inject.filter(id => !this.exports.has(id)).join('、');
        break;
      }
      const [client] = pending.splice(index, 1);
      try {
        delete this.errors[client.owner];
        const module = this.modules.get(client.id); if (!module) throw new Error(`模块未注册：${client.id}`);
        const dependencies = new Set(client.inject);
        const exports = module.factory(id => { dependencies.add(id); return this.require(id); });
        const plugin = exports.default ?? exports;
        this.ownerByModule.set(client.id, client.owner);
        const configured = typeof plugin === 'function' ? { name: client.id, apply: plugin, inject: plugin.inject } : { ...plugin, name: client.id };
        const fiber = this.ctx.plugin(configured);
        this.fibers.set(client.id, { fiber, owner: client.owner, key: this.clientKey(client), dependencies });
        this.exports.set(client.id, exports);
      } catch (error) { this.errors[client.owner] = error instanceof Error ? error.message : String(error); }
    }
    const fibers = [...this.fibers.values()].filter(({ fiber }) => fiber.uid !== null);
    const deadline = Date.now() + 15000;
    for (let pass = 0; pass <= fibers.length; pass++) {
      const before = fibers.map(f => f.fiber.state).join(',');
      await Promise.allSettled(fibers.map(async ({ fiber, owner }) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([fiber.await(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('客户端插件启动超时，已停止等待。请停用或更新插件。')), Math.max(0, deadline - Date.now()));
          })]);
        } catch (error) {
          this.errors[owner] = String(error);
          // Cleanup may itself wait for a third-party promise; never await it
          // on Town's startup path. Cordis prevents new effects after disposal.
          void this.disposeClient({ fiber, owner });
        }
        finally { clearTimeout(timer); }
      }));
      if (Date.now() >= deadline) break;
      if (before === fibers.map(f => f.fiber.state).join(',')) break;
    }
    for (const { fiber, owner } of fibers) {
      if (fiber.state === 2 && /^(缺少客户端模块：|客户端插件启动失败或缺少服务：)/.test(this.errors[owner] || '')) delete this.errors[owner];
      else if (fiber.state !== 2 && !this.errors[owner]) this.errors[owner] = '客户端插件启动失败或缺少服务：' + Object.keys(fiber.inject).filter(key => !fiber.ctx.get(key)).join('、');
    }
    this.changed();
  }
  private script(src: string, type?: string) {
    return new Promise<void>((resolve, reject) => {
      const element = document.createElement('script'); element.src = src; if (type) element.type = type;
      const timer = setTimeout(() => { element.remove(); reject(new Error(`插件脚本加载超时：${src}`)); }, 15000);
      element.onload = () => { clearTimeout(timer); resolve(); };
      element.onerror = () => { clearTimeout(timer); reject(new Error(`插件脚本加载失败：${src}`)); };
      document.head.append(element);
    });
  }
  private async inject(row: DshPluginState['injections'][number]) {
    if (row.kind === 'style' && typeof row.text === 'string') { const style = document.createElement('style'); style.textContent = row.text; document.head.append(style); return; }
    if (row.kind === 'global' && row.name && !['__proto__', 'prototype', 'constructor'].includes(row.name)) { (window as any)[row.name] = row.value; return; }
    if (row.kind === 'script-src' && row.src) { await this.script(row.src, row.type); return; }
    if (row.kind === 'script-preload' && row.src) { const link = document.createElement('link'); link.rel = 'preload'; link.as = 'script'; link.href = row.src; document.head.append(link); return; }
    if (row.kind === 'html' && row.html) {
      const template = document.createElement('template'); template.innerHTML = row.html;
      for (const script of template.content.querySelectorAll('script')) if (!script.type || ['module', 'text/javascript', 'application/javascript'].includes(script.type)) script.remove();
      if (row.placement !== 'head') {
        // Electron's native drag hit testing ignores DOM z-index. Injected UI
        // must exclude the underlying Town titlebar from its hit area. Keep an
        // ID rule as well: plugins may recreate their mount during a replay.
        const selectors: string[] = [];
        for (const element of template.content.children) {
          if (!(element instanceof HTMLElement) || ['LINK', 'STYLE', 'META'].includes(element.tagName)) continue;
          element.style.setProperty('-webkit-app-region', 'no-drag');
          if (element.id) selectors.push(`body > #${CSS.escape(element.id)}`);
        }
        if (selectors.length) {
          const style = document.createElement('style');
          style.textContent = `:where(${selectors.join(',')}) { -webkit-app-region: no-drag; }`;
          document.head.append(style);
        }
      }
      const styles = [...template.content.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map(link => new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`插件样式加载超时：${link.href}`)), 15000);
        link.onload = () => { clearTimeout(timer); resolve(); };
        link.onerror = () => { clearTimeout(timer); reject(new Error(`插件样式加载失败：${link.href}`)); };
      }));
      (row.placement === 'head' ? document.head : document.body).append(template.content);
      await Promise.all(styles); return;
    }
    throw new Error(`Town 尚未提供此 index 注入类型：${row.kind}`);
  }
}
export const dshRuntime = new DshClientRuntime();

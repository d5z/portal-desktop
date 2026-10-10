import { Store, errorText } from '../shared/models/store';
import type { DesktopPluginAPI, PluginLibrary, PluginSlot, PluginHostContext, PluginPlacement, PluginHostRequest } from '../../shared/plugins';
import type { PluginWorkspaceContext } from '../../../plugins/sdk';

export class PluginsModel extends Store {
  library: PluginLibrary = { plugins: [], problems: [] };
  selected?: { id: string; view: string; command?: string; slot?: string; placement: 'page' | 'sidebar'; revision: number };
  context?: PluginWorkspaceContext;
  private contextInput?: PluginHostContext;
  private contextQueue: Promise<unknown> = Promise.resolve();
  commandsOpen = false;
  private selectionRevision = 0;
  private draft?: { id: string; finish: (ok: boolean) => void };
  busy = false;
  error = '';
  private refreshRevision = 0;
  constructor(readonly api: DesktopPluginAPI | undefined, private navigate: (view: string, id?: string) => void,
    private host?: { notice: (text: string) => void; post: (message: unknown) => void; scene: () => string; ready: () => boolean; showChat?: () => void }) { super(); }
  receiveDraft(message: { type?: string; id?: string; ok?: boolean }) {
    if (message.type !== 'beings:scene-draft-result' || !this.draft || message.id !== this.draft.id) return false;
    this.draft.finish(message.ok === true); return true;
  }
  async compose(value: { text: string; sceneId: string }) {
    const host = this.host;
    if (!host?.ready() || host.scene() !== value.sceneId) throw new Error('对话尚未就绪或场景已切换。');
    if (this.draft) throw new Error('正在插入插件草稿。');
    return new Promise<{ inserted: boolean }>(resolve => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => finish(false), 2500);
      const finish = (ok: boolean) => {
        clearTimeout(timer); this.draft = undefined;
        const inserted = ok && host.scene() === value.sceneId;
        if (inserted) host.showChat?.();
        resolve({ inserted });
      };
      this.draft = { id, finish };
      host.post({ type: 'beings:scene-draft', id, text: value.text, sceneId: value.sceneId, expiresAt: Date.now() + 2000 });
    });
  }
  applyUI(method: string, value: any) {
    if (method === 'ui.notice') this.host?.notice(`[${value.plugin}] ${value.text}`);
    if (method === 'ui.navigate') this.navigate(value.view, value.id);
  }
  showCommands(open: boolean) { this.commandsOpen = open; this.changed(); }
  start() {
    return this.api?.onHostRequest?.(request => { void this.handleHostRequest(request); }) || (() => {});
  }
  private async handleHostRequest(request: PluginHostRequest) {
    try {
      let result: unknown;
      if (request.action === 'compose') result = await this.compose(request.value);
      else if (request.action === 'ui') this.applyUI(request.value.method, request.value.value);
      else if (request.action === 'commands') this.showCommands(true);
      else if (request.action === 'dock') this.open(request.value.id, request.value.view, undefined, 'page');
      await this.api?.replyHostRequest?.(request.requestId, result);
    } catch (error) { await this.api?.replyHostRequest?.(request.requestId, undefined, errorText(error)); }
  }
  placement(id: string, view: string): PluginPlacement {
    return this.library.plugins.find(p => p.manifest.id === id)?.placements?.[view] || 'page';
  }
  navigationViews() {
    return this.library.plugins.filter(p => p.enabled).flatMap(p => p.manifest.contributes.views
      .filter(v => p.placements?.[v.id] === 'navigation').map(view => ({ plugin: p.manifest, view })));
  }
  setPlacement(id: string, view: string, placement: PluginPlacement) {
    return this.act(async () => {
      if (!this.api?.setPlacement) throw new Error('当前客户端不支持配置显示位置。');
      await this.api.setPlacement(id, view, placement);
    });
  }
  updateContext(input: PluginHostContext | undefined) {
    if (!input) { this.context = undefined; this.contextInput = undefined; return; }
    if (JSON.stringify(this.contextInput) === JSON.stringify(input)) return;
    this.contextInput = input; this.context = input.context;
    this.contextQueue = this.contextQueue.catch(() => {}).then(() => this.api?.updateContext?.(input));
    void this.contextQueue.catch(() => {}); this.changed();
  }
  async prepareSession() { await this.contextQueue; }
  slots(location: PluginSlot['location']) {
    return this.library.plugins.filter(p => p.enabled).flatMap(p => (p.manifest.contributes.slots || []).filter(slot => slot.location === location).map(slot => ({ plugin: p.manifest, slot })))
      .filter(({ plugin, slot }) => location !== 'resource-actions' || (this.context?.resource && (!slot.resourceKinds || slot.resourceKinds.includes(this.context.resource.kind)) && plugin.capabilities.includes(this.context.resource.private ? 'town.private.read' : 'town.public.read')));
  }
  openSlot(id: string, slot: PluginSlot) {
    this.selected = { id, view: slot.view, slot: slot.id, placement: 'sidebar', revision: ++this.selectionRevision };
    this.changed();
  }
  closeSidebar() { if (this.selected?.placement === 'sidebar') { this.selected = undefined; this.changed(); } }
  async refresh() {
    if (!this.api) return;
    const revision = ++this.refreshRevision;
    try {
      const library = await this.api.list();
      if (revision !== this.refreshRevision) return;
      this.library = library; this.error = '';
      if (this.selected && !this.library.plugins.some(p => p.enabled && p.manifest.id === this.selected?.id)) this.selected = undefined;
    } catch (error) { if (revision !== this.refreshRevision) return; this.error = errorText(error); }
    this.changed();
  }
  open(id: string, view: string, command?: string, placement = this.placement(id, view)) {
    this.commandsOpen = false;
    if (placement === 'window') {
      this.changed();
      void this.act(async () => {
        if (!this.api?.openWindow) throw new Error('当前客户端不支持插件窗口。');
        await this.prepareSession(); await this.api.openWindow(id, view, command);
      });
      return;
    }
    this.selected = { id, view, command, placement: 'page', revision: ++this.selectionRevision };
    this.navigate('plugins'); this.changed();
  }
  manage() { this.selected = undefined; this.navigate('plugin-library'); this.changed(); }
  async act(operation: () => Promise<unknown>) {
    if (this.busy) return;
    this.busy = true; this.error = ''; this.changed();
    try { await operation(); await this.refresh(); }
    catch (error) { this.error = errorText(error); }
    finally { this.busy = false; this.changed(); }
  }
}

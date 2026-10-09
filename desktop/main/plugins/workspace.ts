import { PLUGIN_RESOURCE_KINDS, type PluginManifest, type PluginHostContext } from '../../shared/plugins';
import type { PluginWorkspaceContext } from '../../../plugins/sdk';

const views = ['chat', 'town', 'portal', 'plugins', ...PLUGIN_RESOURCE_KINDS];
const bounded = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !value.includes('\0');
/** Host observations are ephemeral, scoped to the current connection/scene/Town generation. */
export class PluginWorkspace {
  private current?: { key: string; value: PluginWorkspaceContext };
  private revision = 0;
  constructor(private identity: () => { key: string; endpoint: string; sceneId: string; townGeneration: number }, private changed: () => void) {}
  update(input: PluginHostContext) {
    const identity = this.identity();
    if (!input || input.endpoint !== identity.endpoint || input.sceneId !== identity.sceneId || input.townGeneration !== identity.townGeneration) throw new Error('工作区身份已切换。');
    const c = input.context;
    if (!c || !views.includes(c.view) || !bounded(c.title, 160) || !['loading', 'ready', 'error'].includes(c.status)) throw new Error('无效的工作区上下文。');
    const r = c.resource;
    if (r && (!PLUGIN_RESOURCE_KINDS.includes(r.kind) || r.kind !== c.view || !bounded(r.id, 256) || !r.id || !bounded(r.title, 300) || !bounded(r.excerpt, 2200) || typeof r.private !== 'boolean' || (r.revision !== undefined && !bounded(r.revision, 256)))) throw new Error('无效的资源上下文。');
    // Private routes remain private even if a malformed shell observation says otherwise.
    const resource = r ? { kind: r.kind, id: r.id, title: r.title, excerpt: r.excerpt, private: r.private || ['mail', 'bonfire', 'firesides', 'scrolls'].includes(r.kind), ...(r.revision ? { revision: r.revision } : {}) } : undefined;
    const value = { view: c.view, title: c.title, status: c.status, ...(resource ? { resource } : {}) };
    if (this.current?.key === identity.key && JSON.stringify({ ...this.current.value, revision: 0 }) === JSON.stringify({ ...value, revision: 0 })) return;
    this.current = { key: identity.key, value: { ...value, revision: ++this.revision } };
    this.changed();
  }
  read(manifest: PluginManifest): PluginWorkspaceContext {
    const value = this.current?.key === this.identity().key ? this.current.value : { revision: this.revision, view: 'chat', title: '当前对话', status: 'loading' as const };
    const resource = value.resource;
    const allowed = resource && manifest.capabilities.includes(resource.private ? 'town.private.read' : 'town.public.read');
    const title = !manifest.capabilities.includes('town.private.read') && ['mail', 'bonfire', 'firesides', 'scrolls'].includes(value.view) ? 'Town 私有页面' : value.title;
    return { revision: value.revision, view: value.view, title, status: value.status, ...(allowed ? { resource: { ...resource } } : {}) };
  }
}

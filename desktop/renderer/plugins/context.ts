import type { AppModel } from '../app/models/app';
import { PLUGIN_RESOURCE_KINDS, type PluginHostContext } from '../../shared/plugins';
import type { PluginResourceKind } from '../../../plugins/sdk';

/** Whitelist observable resource fields; never send app settings, tokens or local paths. */
export function hostPluginContext(app: AppModel): PluginHostContext | undefined {
  const town = app.town, view = app.view;
  const snapshot = app.snapshot, live = town.live;
  if (!snapshot || !live) return;
  const scene = app.workspace.scenes.current;
  const detail = view === town.view && !town.detailLoading && !town.detailError ? town.detail : undefined;
  const first = detail?.fragments[0];
  const kind = view as PluginResourceKind;
  const selection = scene.view === view ? scene.selection : undefined;
  const resource = PLUGIN_RESOURCE_KINDS.includes(kind) && first && detail?.query.id ? {
    kind, id: String(detail.query.id).slice(0, 256), title: String(first.title || first.name || '当前资源').slice(0, 300),
    excerpt: String(first.brief || first.content || first.description || '').slice(0, 2000),
    private: ['scrolls', 'mail', 'bonfire', 'firesides'].includes(kind),
    revision: String(first.revision || first.updated_at || '').slice(0, 256),
  } : PLUGIN_RESOURCE_KINDS.includes(kind) && selection ? {
    kind, id: selection.id.slice(0, 256), title: selection.title.slice(0, 300), excerpt: selection.excerpt.slice(0, 2000), private: selection.private,
    ...(selection.revision ? { revision: selection.revision.slice(0, 256) } : {}),
  } : undefined;
  return { endpoint: snapshot.settings.endpoint || '', sceneId: snapshot.chatScene?.scene_id || '', townGeneration: live.generation,
    context: { revision: scene.revision, view, title: scene.title.slice(0, 160), status: scene.status, ...(resource ? { resource } : {}) } };
}

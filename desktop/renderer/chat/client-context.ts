import type { ChatScene } from '../../shared/types';
import { HistoryCache } from './services/history-cache';
import { handleClientCommand } from './services/client-commands';

// Runs in a sandboxed iframe with the same origin, session and top-level site as Loom.
// No remote content, preload, credentials, or dependency on the visible window.
Object.assign(window, {
  async clientCommand(endpoint: string, verb: string, args: string, sceneId?: string, knownScenes: ChatScene[] | null = []) {
    const cache = new HistoryCache(endpoint);
    try {
      return await handleClientCommand({
        context: (id, limit) => cache.context(id, limit),
        scenes: async () => {
          const found = new Map((await cache.scenes()).map(scene => [scene.sceneId, scene]));
          for (const scene of knownScenes || []) found.set(scene.scene_id, {
            sceneId: scene.scene_id, messageCount: 0, ...found.get(scene.scene_id), label: scene.scene_meta.scene_label,
          });
          return [...found.values()];
        },
      }, verb, args, sceneId);
    }
    finally { cache.close(); }
  },
});

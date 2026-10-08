import type { ChatScene } from './types';

/** Move an existing local entry before another; omitted target means the end. */
export function moveChatSession(scenes: ChatScene[], id: string, before?: string): ChatScene[] {
  return moveChatSessions(scenes, [id], before);
}

/** Validate the complete selection before changing any entry. */
export function selectedChatSessions(scenes: ChatScene[], ids: string[]): ChatScene[] {
  if (!ids.length || ids.some(id => typeof id !== 'string' || !scenes.some(scene => scene.scene_id === id)))
    throw new Error('场景不存在，请刷新列表后重试。');
  const selected = new Set(ids);
  return scenes.filter(scene => selected.has(scene.scene_id));
}

/** Move a selection as one block, preserving its existing visual order. */
export function moveChatSessions(scenes: ChatScene[], ids: string[], before?: string): ChatScene[] {
  const items = selectedChatSessions(scenes, ids);
  if (before !== undefined && !scenes.some(scene => scene.scene_id === before))
    throw new Error('场景不存在，请刷新列表后重试。');
  const selected = new Set(ids);
  if (before !== undefined && selected.has(before)) return scenes;
  const next = scenes.filter(scene => !selected.has(scene.scene_id));
  next.splice(before === undefined ? next.length : next.findIndex(scene => scene.scene_id === before), 0, ...items);
  return next;
}

import type { ChatItem, Message, Run } from './chat';
import type { SceneTask } from '../../../shared/types';
import type { MessageScene } from './scenes';

/** Keep the wire text intact for history matching; separate Desktop metadata only for presentation. */
export function splitSchedulingHint(text: string) {
  const marker = '\n\n[Desktop 场景调度提示]\n';
  const start = text.lastIndexOf(marker);
  if (start < 0 || !text.endsWith('\n[/Desktop 场景调度提示]')) return { text, hint: '' };
  const hint = text.slice(start + marker.length, -'\n[/Desktop 场景调度提示]'.length);
  if (!hint.startsWith('当前输入属于 scene_id=') || !hint.includes('本客户端其他场景尚在处理或等待回复：')) return { text, hint: '' };
  return { text: text.slice(0, start), hint };
}

/** Attach process metadata only to an existing run in its originating scene/turn.
 * Reloaded history without transient reasoning stays free of process rows.
 * Do not change wire messages or runtime state.
 */
export function withScheduling(items: ChatItem[], tasks: SceneTask[], currentScene?: MessageScene): ChatItem[] {
  const users = items.filter((item): item is Message => item.kind === 'message' && item.role === 'user');
  // Most turns have no scheduling metadata. Avoid matching every historical
  // run to a user (and allocating another timeline) on each streamed frame.
  if (!tasks.length && !users.some(user => splitSchedulingHint(user.text).hint)) return items;
  const owner = (sceneId: string | undefined, at: number) => users
    .filter(user => (sceneId ? user.sceneId === sceneId : currentScene?.sceneId ? user.sceneId === currentScene.sceneId : true) && user.createdAt != null && user.createdAt <= at)
    .sort((a, b) => b.createdAt! - a.createdAt!)[0];
  const groups = new Map<string, { user: Message; hint: string; tasks: SceneTask[]; run?: Run }>();
  for (const user of users) groups.set(user.id, { user, hint: splitSchedulingHint(user.text).hint, tasks: [] });
  for (const task of tasks) {
    const user = owner(task.sceneId, task.createdAt);
    if (user) groups.get(user.id)!.tasks.push(task);
  }
  const precedingUsers = new Map<string | undefined, Message>();
  for (const item of items) {
    if (item.kind === 'message' && item.role === 'user') precedingUsers.set(item.sceneId, item);
    if (item.kind !== 'run') continue;
    // Run timers can start before the server timestamps the user message.
    // The transcript's scene/turn order keeps that run with its actual bubble.
    const user = precedingUsers.get(item.sceneId);
    const group = user && groups.get(user.id);
    if (group && !group.run) group.run = item;
  }
  const replacements = new Map<string, Run>();
  for (const group of groups.values()) {
    if (!group.run || (!group.hint && !group.tasks.length)) continue;
    // The task ledger describes child work, not the parent stream lifecycle.
    // Keep completion, waiting and timing owned by the chat runtime.
    replacements.set(group.run.id, {
      ...group.run,
      scheduling: { hint: group.hint, tasks: group.tasks },
    });
  }
  return items.map(item => replacements.get(item.id) || item);
}

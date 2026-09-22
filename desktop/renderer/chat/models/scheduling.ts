import type { ChatItem, Message, Run } from './chat';
import type { SceneTask } from '../../../shared/types';

/** Keep the wire text intact for history matching; separate Desktop metadata only for presentation. */
export function splitSchedulingHint(text: string) {
  const marker = '\n\n[Desktop 场景调度提示]\n';
  const start = text.lastIndexOf(marker);
  if (start < 0 || !text.endsWith('\n[/Desktop 场景调度提示]')) return { text, hint: '' };
  const hint = text.slice(start + marker.length, -'\n[/Desktop 场景调度提示]'.length);
  if (!hint.startsWith('当前输入属于 scene_id=') || !hint.includes('本客户端其他场景尚在处理或等待回复：')) return { text, hint: '' };
  return { text: text.slice(0, start), hint };
}

/** Attach process metadata to its originating scene/turn, never the selected scene.
 * History may not contain transient reasoning runs; in that case create one
 * presentation-only process row. Do not change wire messages or runtime state.
 */
export function withScheduling(items: ChatItem[], tasks: SceneTask[]): ChatItem[] {
  const users = items.filter((item): item is Message => item.kind === 'message' && item.role === 'user');
  const owner = (sceneId: string | undefined, at: number) => users
    .filter(user => user.sceneId === sceneId && user.createdAt != null && user.createdAt <= at)
    .sort((a, b) => b.createdAt! - a.createdAt!)[0];
  const groups = new Map<string, { user: Message; hint: string; tasks: SceneTask[]; run?: Run }>();
  for (const user of users) groups.set(user.id, { user, hint: splitSchedulingHint(user.text).hint, tasks: [] });
  for (const task of tasks) {
    const user = owner(task.sceneId, task.createdAt);
    if (user) groups.get(user.id)!.tasks.push(task);
  }
  for (const item of items) {
    if (item.kind !== 'run') continue;
    const user = owner(item.sceneId, item.start);
    const group = user && groups.get(user.id);
    if (group && !group.run) group.run = item;
  }
  const replacements = new Map<string, Run>();
  const insertions = new Map<string, Run>();
  for (const group of groups.values()) {
    if (!group.hint && !group.tasks.length) continue;
    const { user, tasks: assigned } = group;
    const lastEnd = Math.max(0, ...assigned.map(task => task.endedAt || 0));
    const replied = lastEnd > 0 && items.some(item => item.kind === 'message' && item.role === 'being'
      && item.sceneId === user.sceneId && (item.createdAt || 0) >= lastEnd
      && owner(item.sceneId, item.createdAt || 0)?.id === user.id);
    const active = assigned.some(task => task.status === 'running' || task.status === 'queued');
    const waiting = !active && !replied && assigned.some(task => task.status === 'done');
    const failed = !active && !waiting && !replied && assigned.some(task => task.status !== 'done');
    const run: Run = group.run ? { ...group.run } : {
      kind: 'run', id: `scheduling-${user.id}`, sceneId: user.sceneId, sceneLabel: user.sceneLabel,
      entries: [], start: user.createdAt || 0, end: lastEnd || user.createdAt || 1,
      label: '思考过程', hint: '', arg: '', synthetic: true,
    };
    run.scheduling = { hint: group.hint, tasks: assigned };
    // A stage reply ends a breath, but does not finish its delegated work.
    if (active) {
      run.end = undefined;
      run.label = '后台执行中';
      run.waitingForReply = true;
      run.outcome = undefined;
    } else if (waiting && run.outcome !== 'error' && run.outcome !== 'stopped') {
      run.end = undefined;
      run.label = '后台已完成，尚未收到回复';
      run.waitingForReply = true;
      run.outcome = undefined;
    } else if (failed && (run.end || run.synthetic)) {
      run.label = '后台任务异常'; run.outcome = 'error';
    }
    if (group.run) replacements.set(group.run.id, run);
    else insertions.set(user.id, run);
  }
  return items.flatMap(item => {
    const inserted = insertions.get(item.id);
    return inserted ? [item, inserted] : [replacements.get(item.id) || item];
  });
}

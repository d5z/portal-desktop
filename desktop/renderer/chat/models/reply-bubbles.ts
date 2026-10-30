import type { ChatItem, Message } from './chat';
import { isImageGenerationText } from '../../../shared/image-generation';

/** Quiet mode has one typing indicator per scene; streamed text is its own progress. */
export function quietProgressRuns(items: ChatItem[]): Set<string> {
  const latestMessages = new Map<string, Message>();
  const latestRuns = new Map<string, string>();
  const stopNotices = new Set<string>();
  for (const item of items) {
    const scene = item.sceneId || '';
    if (item.kind === 'message' && (item.role === 'user' || item.role === 'being')) latestMessages.set(scene, item);
    if (item.kind === 'message' && item.notice === 'stop' && item.statusRunId) stopNotices.add(item.statusRunId);
    if (item.kind === 'run' && !item.end && !['error', 'timeout', 'stopped'].includes(item.status || item.outcome || '')) latestRuns.set(scene, item.id);
  }
  return new Set([...latestRuns].flatMap(([scene, id]) => {
    const message = latestMessages.get(scene);
    return stopNotices.has(id) || (message?.role === 'being' && message.streaming) ? [] : [id];
  }));
}

/** A durable fragment may be displayed inside a combined reply bubble. */
export function historyTargetBubble(items: ChatItem[], timeline: ChatItem[], seq: number): Message | undefined {
  const source = items.find((item): item is Message => item.kind === 'message' && item.historySeq === seq);
  return source && timeline.find((item): item is Message => item.kind === 'message' &&
    (item.id === source.id || !!item.sourceMessageIds?.includes(source.id)));
}

/** Keep durable fragments intact; only combine adjacent speech from one reply. */
export function replyBubbles(items: ChatItem[]): ChatItem[] {
  const result: ChatItem[] = [];
  for (const item of items) {
    const previous = result.at(-1);
    if (item.kind === 'message' && item.role === 'being' && item.replyId &&
        previous?.kind === 'message' && previous.role === 'being' &&
        !isImageGenerationText(previous.text) && !isImageGenerationText(item.text) &&
        previous.replyId === item.replyId &&
        (!previous.sceneId || !item.sceneId || previous.sceneId === item.sceneId)) {
      const combined: Message = {
        ...previous,
        sceneId: previous.sceneId || item.sceneId,
        sceneLabel: previous.sceneLabel || item.sceneLabel,
        text: `${previous.text}\n\n${item.text}`,
        streaming: item.streaming,
        interim: item.interim,
        persistedFrom: item.persistedFrom,
        sourceMessageIds: [...(previous.sourceMessageIds || [previous.id]), item.id],
      };
      result[result.length - 1] = combined;
    } else result.push(item);
  }
  return result;
}

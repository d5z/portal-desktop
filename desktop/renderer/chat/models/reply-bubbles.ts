import type { ChatItem, Message } from './chat';

/** Keep durable fragments intact; only combine adjacent speech from one reply. */
export function replyBubbles(items: ChatItem[]): ChatItem[] {
  const result: ChatItem[] = [];
  for (const item of items) {
    const previous = result.at(-1);
    if (item.kind === 'message' && item.role === 'being' && item.replyId &&
        previous?.kind === 'message' && previous.role === 'being' &&
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

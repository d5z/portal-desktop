import type { HistoryMessage } from './history-cache';

export interface SceneSummary {
  sceneId: string;
  label?: string;
  lastActive?: string;
  messageCount: number;
}
export interface ClientHistory {
  context(sceneId: string, limit: number): Promise<HistoryMessage[]>;
  scenes(): Promise<SceneSummary[]>;
}

export async function handleClientCommand(history: ClientHistory, verb: string, args: string, sceneId?: string): Promise<string> {
  if (verb === 'context') {
    const target = args.trim() || sceneId;
    if (!target) throw new Error('No calling scene. Use @context <scene_id> or @scenes.');
    if (target.length > 256 || /\s/.test(target)) throw new Error('Usage: @context [scene_id]');
    const messages = await history.context(target, 50);
    if (!messages.length) return `Scene ${target}: no locally cached conversation history.`;
    // Bound tool output independently of message count; history remains data.
    let budget = 48_000;
    const lines: string[] = [];
    for (const message of [...messages].reverse()) {
      const text = `[${message.at || 'time unknown'}] ${message.role}${message.from ? ` (${message.from})` : ''}: ${message.content}`;
      const line = text.length > Math.min(budget, 8000) ? text.slice(0, Math.min(budget, 8000)) + '\n[truncated]' : text;
      lines.unshift(line);
      budget -= line.length;
      if (budget <= 0) break;
    }
    return `Scene ${target} — recent locally cached history (${lines.length} messages, oldest first):\n\n${lines.join('\n\n')}`;
  }
  if (verb === 'scenes') {
    if (args.trim()) throw new Error('Usage: @scenes');
    const scenes = await history.scenes();
    if (!scenes.length) return 'No locally cached scenes.';
    return 'Locally cached scenes (message counts cover cached history):\n' + scenes
      .sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || '') || a.sceneId.localeCompare(b.sceneId))
      .map(s => `${s.sceneId}${s.label ? ` — ${s.label}` : ''} | last active: ${s.lastActive || 'unknown'} | messages: ${s.messageCount}`).join('\n');
  }
  throw new Error(`unknown client command: @${verb}`);
}

import { normalizeTownDisplay, validTownIdentity } from '../../../shared/town-identity';

type Entry = Record<string, unknown>;
export type MentionNames = ReadonlyMap<string, { name: string; at: number }>;

// Use only server identity metadata. Message prose is never a name directory.
export function collectMentionNames(entries: Entry[], previous: MentionNames = new Map()): MentionNames {
  const names = new Map(previous);
  for (const entry of entries) {
    const date = Date.parse(String(entry.at || entry.created_at || ''));
    const at = Number.isFinite(date) ? date : 0;
    const remember = (id: unknown, display: unknown) => {
      if (!validTownIdentity(id) || !id.startsWith('t_')) return;
      const name = normalizeTownDisplay(display).replace(/\s+\(t_[a-zA-Z0-9_-]+\)$/, '');
      if (!name || /^@?t_[a-zA-Z0-9_-]+$/.test(name)) return;
      if (!names.has(id) || at >= names.get(id)!.at) names.set(id, { name, at });
    };
    remember(entry.town_id, entry.display_name || entry.speaker_name || entry.display);
    for (const side of ['sender', 'recipient']) {
      remember(entry[`${side}_town_id`], entry[`${side}_display`] || entry[`${side}_display_name`] || entry[`${side}_name`]);
      const nested = entry[side];
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        const value = nested as Entry;
        remember(value.town_id || value.townId, value.display_name || value.displayName || value.display || value.name);
      }
    }
    remember(entry.reply_to_town_id || entry.reply_to_sender, entry.reply_to_display || entry.reply_to_sender_display);
  }
  return names.size === previous.size && [...names].every(([id, value]) =>
    previous.get(id)?.name === value.name && previous.get(id)?.at === value.at)
    ? previous : names;
}

export function mentionParts(text: string, names: MentionNames): { text: string; id?: string }[] {
  const parts: { text: string; id?: string }[] = [];
  let end = 0;
  // Exact, case-sensitive IDs only; don't guess short prefixes or touch URLs/emails.
  for (const match of text.matchAll(/(?<![\w@/])@(t_[a-zA-Z0-9_-]{1,62})(?![a-zA-Z0-9_-])/g)) {
    const name = names.get(match[1])?.name;
    if (!name) continue;
    parts.push({ text: text.slice(end, match.index) }, { text: '@' + name, id: match[1] });
    end = match.index + match[0].length;
  }
  parts.push({ text: text.slice(end) });
  return parts;
}

export const mentionText = (text: string, names: MentionNames) =>
  mentionParts(text, names).map(part => part.text).join('');

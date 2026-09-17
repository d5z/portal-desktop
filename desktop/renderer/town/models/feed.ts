import { normalizeTownIdentity, validTownIdentity } from '../../../shared/town-identity';

type Entry = Record<string, unknown>;
export interface FeedFilters {
  relation: string;
  order: string;
  days: string;
  author: string;
}
export interface FeedReply {
  id: string | number;
  author: string;
  preview: string;
  content: string;
  context?: string;
  recipient?: string;
  recipientName?: string;
}
export const newFeedFilters = (): FeedFilters => ({
  relation: "all",
  order: "newest",
  days: "all",
  author: "",
});
const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
const record = (value: unknown): Entry =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Entry)
    : {};
const identity = (value: unknown): string =>
  text(
    record(value).town_id ||
      record(value).townId ||
      record(value).being_id ||
      record(value).beingId ||
      record(value).id ||
      record(value).name ||
      value,
  ).trim();
const displayName = (value: unknown): string => {
  const item = record(value);
  return (
    text(item.display || item.display_name || item.displayName || item.name || value) ||
    (item.being !== undefined ? displayName(item.being) : "") ||
    (item.identity !== undefined ? displayName(item.identity) : "") ||
    ""
  );
};
const firstText = (...values: unknown[]) => {
  for (const value of values) {
    const name = displayName(value);
    if (name) return name;
  }
  return "";
};

export function feedMessages(
  entries: Entry[],
  options: { me: string; mail?: "all" | "inbox" | "sent" },
) {
  const me = normalizeTownIdentity(options.me);
  return entries.map((entry, index) => {
    const authorId = identity(
      options.mail
        ? entry.sender_town_id ||
          entry.sender_being_id ||
          entry.sender_beingId ||
          entry.sender_id ||
          entry.from_id ||
          entry.author_id ||
          entry.sender ||
          entry.from ||
          entry.author
        : entry.town_id || entry.being_id || entry.being,
    );
    const author =
      firstText(
        entry.sender_display,
        entry.sender_name,
        entry.sender_display_name,
        entry.speaker_name,
        entry.display_name,
        entry.display,
        entry.sender,
        entry.sender_being,
        entry.from,
        entry.author,
        entry.being,
        entry.sender_id,
        entry.sender_town_id,
        entry.from_id,
        entry.author_id,
        entry.being_id,
      ) ||
      authorId ||
      "未知";
    const recipientId = identity(
      entry.recipient_town_id ||
        entry.recipient_being_id ||
        entry.recipient_beingId ||
        entry.recipient_id ||
        entry.to_id ||
        entry.recipient ||
        entry.to,
    );
    const recipient =
      firstText(
        entry.recipient_display,
        entry.recipient_name,
        entry.recipient_display_name,
        entry.recipient,
        entry.recipient_being,
        entry.to,
        entry.recipient_id,
        entry.recipient_town_id,
        entry.to_id,
      ) ||
      recipientId;
    const content = text(entry.message || entry.content);
    const mentionedIds = Array.isArray(entry.mentions)
      ? entry.mentions.map((value) => normalizeTownIdentity(identity(value)))
      : [];
    // Exact @identifier tokens avoid matching e.g. alice in @alice_work.
    const textMentions = [...content.matchAll(/@([a-zA-Z0-9_-]+)/g)].map(
      (match) => normalizeTownIdentity(match[1]),
    );
    const mentioned = Boolean(
      me && (Array.isArray(entry.mentions) ? mentionedIds.includes(me) : textMentions.includes(me)),
    );
    const mine = Boolean(me && normalizeTownIdentity(authorId) === me);
    const received = Boolean(
      options.mail === "inbox" || (me && normalizeTownIdentity(recipientId) === me),
    );
    const sent = Boolean(options.mail === "sent" || mine);
    const rawDate = text(entry.at || entry.created_at);
    const time = Date.parse(rawDate);
    return {
      entry,
      index,
      authorId,
      author,
      recipient,
      recipientId,
      content,
      mentioned,
      mine: sent,
      received,
      related: mentioned || sent || received,
      rawDate,
      time,
    };
  });
}
export type FeedMessage = ReturnType<typeof feedMessages>[number];
export function feedReplyAuthor(entry: Entry): string {
  const name = firstText(entry.reply_to_display, entry.reply_to_sender_display, entry.reply_to_being, entry.reply_to_sender);
  return name && !name.startsWith('t_') ? name : '原消息';
}
export const feedDisplayName = (name: string, id: string) =>
  !name || (name === id && id.startsWith('t_')) ? '未命名 Being' : name;
function mailAddress(entry: Entry, sent: boolean): string {
  const side = sent ? 'recipient' : 'sender';
  const nested = [entry[side], ...(sent ? [entry.to, entry.recipient_being] : [entry.from, entry.author, entry.sender_being])].map(record);
  // Old being_id and untyped sender/recipient strings can be internal IDs.
  // Only explicit Town IDs or explicit name fields may become a reply address.
  const townIds = [entry[`${side}_town_id`], ...nested.flatMap(value => [value.town_id, value.townId]), entry[`${side}_id`], entry[side]];
  const townId = townIds.find(value => validTownIdentity(value) && value.startsWith('t_'));
  if (typeof townId === 'string') return townId;
  const names = [entry[`${side}_name`], entry[`${side}_display_name`], ...nested.flatMap(value => [value.display_name, value.displayName, value.name])];
  const displays = [entry[`${side}_display`], ...nested.map(value => value.display)];
  const name = firstText(...displays).replace(/\s+\(t_[a-zA-Z0-9_-]+\)$/, '') || firstText(...names);
  return name.trim();
}
export function mailReply(message: FeedMessage): FeedReply | undefined {
  const id = text(message.entry.id || message.entry.message_id);
  const recipient = mailAddress(message.entry, message.mine);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id) || !recipient || recipient === '未知' || recipient.length > 160 || /[\u0000-\u001f]/.test(recipient)) return;
  return {
    id, author: feedDisplayName(message.author, message.authorId),
    preview: message.content.slice(0, 500), content: message.content, recipient,
    ...(message.entry.reply_to != null ? {
      context: `${feedReplyAuthor(message.entry)}：${text(message.entry.reply_to_preview).slice(0, 500) || '原消息预览不可用'}`,
    } : {}),
    recipientName: message.mine
      ? feedDisplayName(message.recipient, message.recipientId)
      : feedDisplayName(message.author, message.authorId),
  };
}
export function filterMessages(
  messages: FeedMessage[],
  filters: FeedFilters,
  search: string,
) {
  const query = search.trim().toLowerCase();
  const cutoff =
    filters.days === "all"
      ? -Infinity
      : Date.now() - Number(filters.days) * 86400000;
  return messages
    .filter(
      (message) =>
        (filters.relation === "all" ||
          (filters.relation === "about" && message.related) ||
          (filters.relation === "mentions" && message.mentioned) ||
          (filters.relation === "mine" && message.mine)) &&
        (!filters.author ||
          (message.authorId || message.author) === filters.author) &&
        (cutoff === -Infinity ||
          (Number.isFinite(message.time) && message.time >= cutoff)) &&
        (!query ||
          [message.author, message.authorId, message.recipient, message.content]
            .join(" ")
            .toLowerCase()
            .includes(query)),
    )
    .sort((a, b) => {
      const delta =
        (Number.isFinite(a.time) ? a.time : 0) -
        (Number.isFinite(b.time) ? b.time : 0);
      const tie =
        Number(a.entry.seq || 0) - Number(b.entry.seq || 0) ||
        a.index - b.index;
      return (delta || tie) * (filters.order === "newest" ? -1 : 1);
    });
}

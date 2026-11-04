import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  feedMessages,
  feedDisplayName,
  filterMessages,
  newFeedFilters,
  type FeedFilters,
  type FeedMessage,
} from "../models/feed";
import { TownModel, list, str, type Data } from "../models/town";
import { sceneExcerpt } from "../../shared/models/scene";
import { collectMentionNames } from '../models/mentions';
import {useMessageMenu} from '../../shared/components/message-menu';
import { TownMessage } from './message';
const messageKey = (message: FeedMessage) => str(message.entry.id || message.entry.seq ||
  `${message.authorId}:${message.rawDate}:${message.index}`);
export function TownFeed({
  town,
  data,
  filterKey,
  heading,
}: {
  town: TownModel;
  data: Data;
  filterKey: string;
  heading?: import("react").ReactNode;
}) {
  const [filters, setFilters] = useState<FeedFilters>(
    () => town.feedFilters[filterKey] || newFeedFilters(),
  );
  const [selected, setSelected] = useState("");
  const messageMenu=useMessageMenu(text=>town.api.copyText(text),filterKey);
  const more = useRef<HTMLDetailsElement>(null);
  const me = town.me || (typeof data.being === "string" ? data.being : "");
  const mail =
    town.view === "mail"
      ? (town.tab as "all" | "inbox" | "sent")
      : undefined;
  const normalized = useMemo(() => new WeakMap<Data, FeedMessage>(), [me, mail]);
  const messages = useMemo(() => list(data, 'messages').map((entry, index) => {
    let message = normalized.get(entry);
    if (!message || message.index !== index) {
      message = { ...feedMessages([entry], { me, mail })[0], index };
      normalized.set(entry, message);
    }
    return message;
  }), [data, me, mail, normalized]);
  const onSelect = useCallback((message: FeedMessage) => {
    const id = messageKey(message);
    setSelected(id);
    town.choose({
      id: 'message:' + id, title: `${message.author} 的发言`,
      author: message.authorId || message.author,
      revision: str(message.entry.revised_at || message.rawDate),
      excerpt: sceneExcerpt(message.content),
      private: Boolean(town.view === 'firesides' || mail),
    });
  }, [town, mail]);
  const onJumpReply = useCallback((message: FeedMessage, domId: string) => {
    setSelected(messageKey(message));
    requestAnimationFrame(() => {
      const node = document.getElementById(domId);
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      node?.focus({ preventScroll: true });
    });
  }, []);
  const messageLocations = useMemo(() => {
    const locations = new Map<string, { message: FeedMessage; domId: string }>();
    for (const message of messages) {
      const key = str(mail ? message.entry.id : message.entry.seq);
      if (key) locations.set(key, { message, domId: `town-message-${message.index}` });
    }
    return locations;
  }, [mail, messages]);
  const mentionNames = useMemo(() => collectMentionNames([
    ...list(data, 'messages'),
    { town_id: town.me, display: town.live?.display },
  ], town.mentionNames), [data, town.mentionNames, town.me, town.live?.display]);
  const authors = useMemo(
    () =>
      [
        ...new Map(
          messages.map((message) => [
            message.authorId || message.author,
            feedDisplayName(message.author, message.authorId),
          ]),
        ).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1], "zh-CN")),
    [messages],
  );
  const effective = {
    ...filters,
    relation:
      mail
        ? "all"
        : !me
        ? "all"
        : filters.relation,
    author: authors.some(([id]) => id === filters.author) ? filters.author : "",
  };
  const filtered = filterMessages(messages, effective, town.search);
  const countLabel = filtered.length === messages.length ? `已加载 ${messages.length} 条` : `匹配 ${filtered.length} 条 · 已加载 ${messages.length} 条`;
  const serialized = JSON.stringify({ ...effective, search: town.search });
  useEffect(() => {
    if (!town.visible) return;
    town.feedFilters[filterKey] = JSON.parse(serialized);
    town.scenes.update({
      count: filtered.length,
      filters: { tab: town.tab, ...JSON.parse(serialized) },
      scope: `${countLabel}；未确认阅读`,
    });
  }, [town, town.visible, filterKey, serialized, filtered.length, countLabel, town.tab]);
  useEffect(() => {
    const outside = (event: Event) => {
      if (more.current && !more.current.contains(event.target as Node))
        more.current.open = false;
    };
    document.addEventListener("click", outside);
    return () => document.removeEventListener("click", outside);
  }, []);
  const select = (
    label: string,
    values: [string, string][],
    key: "order" | "days" | "author",
  ) => (
    <label className="feed-select">
      {label}
      <select
        aria-label={label}
        value={effective[key]}
        onChange={(event) =>
          setFilters({ ...effective, [key]: event.target.value })
        }
      >
        {values.map(([value, caption]) => (
          <option value={value} key={value}>
            {caption}
          </option>
        ))}
      </select>
    </label>
  );
  const summary = (
    <div className="feed-summary" role="status">
      {`${countLabel}${me ? "" : " · 配对后可识别 @我和我的发言"}`}
    </div>
  );
  return (
    <div className="social-feed">
      <div className="feed-header">
        {heading}
        <div className="feed-controls">
          {!mail && (
            <div className="feed-relations" aria-label="消息关系筛选">
              {[
                ["all", "全部"],
                ["about", "关于我"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  data-relation={value}
                  disabled={!me && value !== "all"}
                  className={effective.relation === value ? "selected" : ""}
                  aria-pressed={effective.relation === value}
                  onClick={() => setFilters({ ...effective, relation: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {summary}
          <details
            className="feed-options"
            ref={more}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                // Let the native picker close before dismissing its filter panel.
                if (event.target instanceof Element && event.target.closest("select:open")) return;
                event.preventDefault();
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}
          >
            <summary>
              {effective.order !== "newest" ||
              effective.days !== "all" ||
              effective.author
                ? "筛选 · 已设置"
                : "筛选"}
            </summary>
            <div className="feed-selectors">
              {select(
                "排序",
                [
                  ["newest", "最新在前"],
                  ["oldest", "最早在前"],
                ],
                "order",
              )}
              {select(
                "时间",
                [
                  ["all", "全部时间"],
                  ["1", "最近 24 小时"],
                  ["7", "最近 7 天"],
                  ["30", "最近 30 天"],
                ],
                "days",
              )}
              {select("作者", [["", "全部作者"], ...authors], "author")}
            </div>
          </details>
        </div>
      </div>
      <div className="social-messages">
        {filtered.map((message) => {
          const id = messageKey(message);
          const location = messageLocations.get(str(mail ? message.entry.id : message.entry.seq));
          const replyTarget = messageLocations.get(str(message.entry.reply_to));
          return (
            <TownMessage
              key={id}
              openMenu={messageMenu.openMenu}
              {...{ message, town, mail, mentionNames }}
              domId={location?.domId || `town-message-${message.index}`}
              replyTarget={replyTarget?.message}
              replyDomId={replyTarget?.domId}
              onJumpReply={onJumpReply}
              selected={selected === id}
              onSelect={onSelect}
              canReply={town.live?.phase === 'connected'}
            />
          );
        })}
        {!filtered.length && (
          <div className="feed-empty">
            <strong>
              {messages.length ? "没有符合条件的消息" : "暂无消息"}
            </strong>
            <p>
              {messages.length
                ? "试试其他筛选条件，或清空搜索关键词。"
                : "刷新后，新消息会显示在这里。"}
            </p>
            {messages.length > 0 && (
              <button
                className="secondary"
                onClick={() => { setFilters(newFeedFilters()); town.setSearch(""); }}
              >
                清空搜索与筛选
              </button>
            )}
          </div>
        )}
      </div>
      {messageMenu.menu}
    </div>
  );
}

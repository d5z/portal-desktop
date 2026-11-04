import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { feedDisplayName, feedReplyAuthor, mailReply, type FeedMessage } from "../models/feed";
import { str, type TownModel } from "../models/town";
import { Markdown, markdownText } from "../../shared/components/markdown";
import { mentionText, type MentionNames } from "../models/mentions";
import { MentionText } from "./mention-text";
import type { useMessageMenu } from "../../shared/components/message-menu";
import { messageTimeLabel } from "../../shared/lib/message-time";
import { CopyMessage } from "../../shared/components/copy-message";

export const TownMessage = memo(function TownMessage({
  message: m,
  town,
  mail,
  mentionNames,
  domId,
  replyTarget,
  replyDomId,
  canReply,
  onJumpReply,
  selected,
  onSelect,
  openMenu,
}: {
  openMenu: ReturnType<typeof useMessageMenu>["openMenu"];
  message: FeedMessage;
  town: TownModel;
  mail?: "all" | "inbox" | "sent";
  mentionNames: MentionNames;
  domId: string;
  replyTarget?: FeedMessage;
  replyDomId?: string;
  canReply: boolean;
  onJumpReply: (message: FeedMessage, domId: string) => void;
  selected: boolean;
  onSelect: (message: FeedMessage) => void;
}) {

  const [replyOpen, setReplyOpen] = useState(false);
  const collapsible = m.content.length > 480 || m.content.split("\n").length > 8;
  const renderText = useCallback(
    (text: string) => <MentionText text={text} names={mentionNames} />,
    [mentionNames],
  );
  const via = str(m.entry.via),
    replyId = Number(m.entry.seq),
    state = str(m.entry.delivery_status);
  const reply = mail ? mailReply(m) : Number.isSafeInteger(replyId) && replyId > 0
    ? {
        id: replyId,
        author: feedDisplayName(m.author, m.authorId),
        preview: m.content.slice(0, 500),
        content: m.content,
        ...(m.entry.reply_to != null ? {
          context: `${feedReplyAuthor(m.entry)}：${str(m.entry.reply_to_preview).slice(0, 500) || replyTarget?.content.slice(0, 500) || "原消息预览不可用"}`,
        } : {}),
      }
    : undefined;
  const authorName = feedDisplayName(m.author, m.authorId);
  const replyAuthor = feedReplyAuthor(m.entry);
  const labels: Record<string, string> = {
    delivered: "已送达",
    pending: "待送达",
    failed: "送达失败",
    read: "已读",
  };
  const snippet = useMemo(
    () =>
      collapsible ? markdownText(m.content, text => mentionText(text, mentionNames))
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 240) : "",
    [collapsible, m.content, mentionNames],
  );
  const quotedContent = str(m.entry.reply_to_preview) || replyTarget?.content || "原消息预览不可用";
  const quotedPreview = useMemo(
    () => markdownText(quotedContent.slice(0, 500), text => mentionText(text, mentionNames)).replace(/\s+/g, ' ').trim(),
    [quotedContent, mentionNames],
  );
  const body = (
    <Markdown richCode className="reading-text social-body" content={m.content}
      renderText={renderText} />
  );
  const avatar = <span className="social-avatar" aria-hidden="true">
    {authorName === '未命名 Being' ? '·' : authorName.slice(0, 1)}
  </span>;
  return (
    <article
      id={domId}
      tabIndex={-1}
      data-copy-group
      className={`social-message${m.mine ? " social-mine" : ""}${m.mentioned ? " mentions-me" : ""}${selected ? " scene-selected" : ""}`}
    >
      <div className="social-content">
        <div className="social-meta">
          {avatar}
          <strong className="social-author" title={m.authorId}>
            {authorName}
          </strong>
          {via.startsWith("client:") && (
            <span
              className="relation-tag via-tag"
              title="人类伙伴通过客户端，以此 Being 的身份发言"
            >
              客户端发送
            </span>
          )}
          {m.mine && <span className="relation-tag">本 Being 发送</span>}
          {m.received && <span className="relation-tag">发给我</span>}
          {m.mentioned && <span className="relation-tag mention-tag">@我</span>}
          {mail && m.recipient && !m.received && (
            <span className="social-recipient" title={m.recipientId}>→ {feedDisplayName(m.recipient, m.recipientId)}</span>
          )}
          <span className="message-time-actions">
            <time dateTime={m.time ? new Date(m.time).toISOString() : undefined}>
              {m.time ? messageTimeLabel(m.time) : m.rawDate}
            </time>
            <CopyMessage text={m.content} copy={text => town.api.copyText(text)} />

          </span>
        </div>
        <div className="social-bubble" tabIndex={0} role="group" aria-label={`${authorName}的消息`} aria-haspopup="menu"
          onContextMenu={event=>openMenu(event,{text:m.content,time:m.time,fallbackTime:m.rawDate})}
          onKeyDown={event=>openMenu(event,{text:m.content,time:m.time,fallbackTime:m.rawDate})}>
        {m.entry.reply_to != null && (
          <details
            className={`feed-reply-preview${replyTarget ? " has-full-reply" : ""}`}
            onToggle={event => setReplyOpen(event.currentTarget.open)}
          >
            <summary>
              <span className="feed-reply-copy">
                <strong>回复 {replyTarget ? feedDisplayName(replyTarget.author, replyTarget.authorId) : replyAuthor}</strong>
                <span className="feed-reply-excerpt">{quotedPreview}</span>
              </span>
              <span className="feed-reply-toggle" aria-hidden="true" />
            </summary>
            {replyOpen && <div className="feed-reply-full">
              {replyTarget ? (
                <Markdown richCode
                  className="reading-text social-body"
                  content={replyTarget.content}
                  renderText={renderText}
                />
              ) : (
                <p>原消息不在当前加载范围内，以上为 Town 返回的引用预览。</p>
              )}
              {replyTarget && replyDomId && (
                <button className="text-button" type="button" onClick={() => onJumpReply(replyTarget, replyDomId)}>
                  跳转原文
                </button>
              )}
            </div>}
          </details>
        )}
        {collapsible ? (
          <MessageExpansion snippet={snippet}>{body}</MessageExpansion>
        ) : (
          body
        )}
        </div>
        <div className="social-foot">
          {mail
            ? labels[state] || state
            : m.entry.revised_at ? '已编辑' : ''}
          {(town.view === "firesides" || town.view === "bonfire" || mail) &&
            canReply &&
            reply && (
              <button
                className="scene-select"
                type="button"
                onClick={() => town.compose(reply)}
              >
                回复
              </button>
            )}
          <button className="scene-select" type="button" onClick={() => onSelect(m)}>
            一起看
          </button>
        </div>
      </div>
    </article>
  );
});

function MessageExpansion({snippet,children}:{snippet:string;children:import('react').ReactNode}) {
  const [open,setOpen]=useState(false);
  const [visited,setVisited]=useState(false);
  const contentId=useId();
  const box=useRef<HTMLDivElement>(null);
  const restoreAnchor=useRef(false);
  const toggle=()=>{
    // Collapse back to the message instead of leaving the reader below it.
    const scroller=box.current?.closest('.fireside-thread, #town-body');
    restoreAnchor.current=Boolean(open && box.current && scroller &&
      box.current.getBoundingClientRect().top < scroller.getBoundingClientRect().top);
    setVisited(true);setOpen(value=>!value);
  };
  useLayoutEffect(()=>{
    if (!open && restoreAnchor.current) {
      box.current?.closest('article')?.scrollIntoView({block:'start',behavior:'instant'});
      restoreAnchor.current=false;
    }
  },[open]);
  return <div className="social-expansion" ref={box}>
    <div hidden={open}><span className="social-preview">{snippet}</span></div>
    <div id={contentId} className="social-expanded-body" hidden={!open}>{visited ? children : null}</div>
    <button className="text-button expand-label" type="button" aria-controls={contentId} aria-expanded={open} onClick={toggle}>{open?'收起全文':'展开全文'}</button>
  </div>;
}

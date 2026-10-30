import useMemoizedFn from 'ahooks/es/useMemoizedFn';
import { useEffect, useSyncExternalStore, useMemo, useRef, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";
import { splitSchedulingHint } from "../models/scheduling";
import { markdownText } from "../../shared/components/markdown";
import {firstAfter} from '../models/scroll-position';
import type {useMessageScroll} from '../hooks/use-message-scroll';
import type { ChatItem, Message } from "../models/chat";

export function JumpToLatest({ container, scrollLock, clearAnchor, status, trimHistory }: {
  trimHistory: () => void;
  status: Pick<ReturnType<typeof useMessageScroll>, "subscribe" | "getSnapshot">;
  container: RefObject<HTMLDivElement | null>;
  scrollLock: RefObject<boolean>;
  clearAnchor: () => void;
}) {
  const {away,count}=useSyncExternalStore(status.subscribe,status.getSnapshot);
  const label=count?`${count}条消息`:'最新消息';
  return <button id="chat-jump-latest" type="button" hidden={!away}
    aria-label="回到底部" aria-description={count?`下方还有${count}条消息`:undefined} title={count?`下方还有${count}条消息`:'回到底部'}
    onClick={() => {
      clearAnchor();
      scrollLock.current = true;
      trimHistory();
      container.current?.scrollTo({ top: container.current.scrollHeight,
        behavior: "instant" });
    }}>
    <span>{label}</span>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
  </button>;
}

export function ChatIndex({
  items,
  container,
  elements,
  scrollLock,
  clearAnchor,
  highlight,
}: {
  items: ChatItem[];
  container: RefObject<HTMLDivElement | null>;
  elements: RefObject<Map<string, HTMLDivElement>>;
  scrollLock: RefObject<boolean>;
  clearAnchor: () => void;
  highlight: (id: string | null) => void;
}) {
  // Serialize the user-turn snapshot: streaming reply mutations must not reparse every title.
  const signature = JSON.stringify(items.filter((item): item is Message => item.kind === 'message' && item.role === 'user').map(({ id, text }) => ({ id, text })));
  const turns = useMemo(() => {
    const users: { id: string; text: string }[] = JSON.parse(signature);
    return users.map(item => ({
      id: item.id,
      messageId: item.id,
      text: markdownText(splitSchedulingHint(item.text).text).slice(0, 240) || '附件消息',
    }));
  }, [signature]);
  const nav = useRef<HTMLElement>(null),
    ticks = useRef<HTMLDivElement>(null),
    buttons = useRef(new Map<string, HTMLButtonElement>()),
    preview = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0),
    [hovered, setHovered] = useState<string | null>(null),
    [top, setTop] = useState(12);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const updateActive = useMemoizedFn(() => {
    const messages = container.current;
    if (!messages) return;
    const top = messages.getBoundingClientRect().top + 44;
    let next=Math.max(0,firstAfter(turns.length,top,index=>elements.current.get(turns[index].messageId)?.getBoundingClientRect().top??Infinity)-1);
    if (messages.scrollHeight - messages.scrollTop - messages.clientHeight < 8)
      next = turns.length - 1;
    setActive(next);
  });
  function jump(id: string) {
    const turn = turns.find((turn) => turn.id === id),
      messages = container.current;
    if (!messages || !turn) return;
    clearAnchor();
    const target = elements.current.get(turn.messageId);
    if (!target) return;
    scrollLock.current = false;
    messages.scrollTo({
      top: messages.scrollTop +
          target.getBoundingClientRect().top -
          messages.getBoundingClientRect().top -
          24,
      behavior: "instant",
    });
    highlight(turn.messageId);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => highlight(null), 1400);
    setHovered(null);
    updateActive();
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    const messages = container.current;
    if (!messages) return;
    let frame=0;
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;updateActive();});};
    const observer = new ResizeObserver(schedule);
    observer.observe(messages);
    messages.addEventListener("scroll", schedule, { passive: true });
    updateActive();
    return () => {
      cancelAnimationFrame(frame);observer.disconnect();
      messages.removeEventListener("scroll", schedule);
    };
  }, [container, updateActive]);
  useLayoutEffect(() => {
    updateActive();
  }, [items.length, turns, updateActive]);
  useEffect(() => {
    const button = buttons.current.get(turns[active]?.id);
    if (
      button &&
      ticks.current &&
      !nav.current?.matches(":hover, :focus-within")
    )
      ticks.current.scrollTop =
        button.offsetTop -
        ticks.current.clientHeight / 2 +
        button.offsetHeight / 2;
  }, [active, turns]);
  const turn = turns.find((turn) => turn.id === hovered);
  const start = turn
    ? items.findIndex((item) => item.id === turn.messageId)
    : -1;
  const replies: string[] = [];
  if (start >= 0)
    for (const item of items.slice(start + 1)) {
      if (item.kind !== "message") continue;
      if (item.role === "user") break;
      if (item.role === "being") replies.push(markdownText(splitSchedulingHint(item.text).text));
      if (replies.join(" ").length >= 240) break;
    }
  const replyPreview = replies.join(" ");
  useLayoutEffect(() => {
    if (!hovered) return;
    const rect = buttons.current.get(hovered)?.getBoundingClientRect();
    if (rect)
      setTop(
        Math.max(
          12,
          Math.min(
            rect.top - 20,
            innerHeight - (preview.current?.offsetHeight || 0) - 12,
          ),
        ),
      );
  }, [hovered, replyPreview]);
  return (
    <>
      <nav
        ref={nav}
        id="chat-index"
        aria-label="对话快速索引"
        hidden={!turns.length}
      >
        <div
          ref={ticks}
          id="chat-index-ticks"
          onScroll={() => setHovered(null)}
          onKeyDown={(event) => {
            const index = turns.findIndex(
              (turn) => buttons.current.get(turn.id) === event.target,
            );
            const next =
              event.key === "ArrowDown"
                ? Math.min(index + 1, turns.length - 1)
                : event.key === "ArrowUp"
                  ? Math.max(index - 1, 0)
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? turns.length - 1
                      : -1;
            if (next >= 0) {
              event.preventDefault();
              buttons.current.get(turns[next].id)?.focus();
            }
            if (event.key === "Escape") setHovered(null);
          }}
        >
          {turns.map((turn, index) => (
            <button
              ref={(el) => {
                if (el) buttons.current.set(turn.id, el);
                else buttons.current.delete(turn.id);
              }}
              key={turn.id}
              type="button"
              className="chat-index-tick"
              aria-label={`跳转到提问 ${index + 1}：${turn.text}`}
              aria-describedby={hovered === turn.id ? "chat-index-preview" : undefined}
              aria-current={active === index ? "location" : undefined}
              style={
                {
                  "--tick-width": `${[26, 20, 15, 10][Math.abs(index - active)] || 6}px`,
                } as CSSProperties
              }
              onMouseEnter={() => setHovered(turn.id)}
              onFocus={() => setHovered(turn.id)}
              onMouseLeave={() => setHovered(null)}
              onBlur={() => setHovered(null)}
              onClick={() => jump(turn.id)}
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
      </nav>
      <div
        ref={preview}
        id="chat-index-preview"
        role="tooltip"
        hidden={!turn}
        style={{ top }}
      >
        <strong>{turn?.text}</strong>
        <p>{replyPreview.slice(0, 240) || "暂无回复"}</p>
      </div>
    </>
  );
}

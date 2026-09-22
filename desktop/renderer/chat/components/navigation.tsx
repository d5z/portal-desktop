import { splitSchedulingHint } from '../models/scheduling';
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
  type RefObject,
} from "react";
import type { PlaceView } from "../../shared/lib/navigation";
import { markdownText } from "../../shared/components/markdown";
import type { ChatItem, Message } from "../models/chat";
const places = [
  {
    view: "bonfire" as PlaceView,
    label: "篝火",
    icon: (
      <>
        <path d="M12 3c1 4-4 5-4 9 0 1 .5 2 1 2 0-3 3-3 4-6 4 3 6 6 5 9a6.5 6.5 0 0 1-12-1c-1-5 3-8 6-13Z" />
      </>
    ),
  },
  {
    view: "firesides" as PlaceView,
    label: "围炉",
    icon: (
      <>
        <circle cx="8" cy="7" r="3" />
        <path d="M2 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 13a5 5 0 0 1 4 5v3" />
      </>
    ),
  },
  {
    view: "mail" as PlaceView,
    label: "私信",
    icon: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </>
    ),
  },
  {
    view: "seeds" as PlaceView,
    label: "花园",
    icon: (
      <>
        <path d="M12 21V11M12 15C5 15 3 11 3 6c6 0 9 3 9 9ZM12 11c0-6 3-9 9-9 0 6-3 9-9 9Z" />
      </>
    ),
  },
  {
    view: "embers" as PlaceView,
    label: "书架",
    icon: (
      <>
        <path d="M12 5v16M12 5C9 3 6 3 3 4v15c3-1 6-1 9 2 3-3 6-3 9-2V4c-3-1-6-1-9 1Z" />
      </>
    ),
  },
  {
    view: "scrolls" as PlaceView,
    label: "卷轴",
    icon: (
      <>
        <path d="M7 3h12a2 2 0 0 1 2 2v3h-4V5a2 2 0 0 1 4 0M7 3a2 2 0 0 0-2 2v14a2 2 0 0 1-4 0v-3h12v3a2 2 0 0 0 4 0V7M3 21h12M8 8h5M8 12h5" />
      </>
    ),
  },
  {
    view: "kits" as PlaceView,
    label: "工具库",
    icon: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </>
    ),
  },
];
export function ChatPlaces({
  send,
  channels = [],
}: {
  send: (message: Record<string, unknown>) => void;
  channels?: string[];
}) {
  const [open, setOpen] = useState(true);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  useLayoutEffect(() => {
    if (focusIndex !== null) {
      buttons.current[focusIndex]?.focus();
      setFocusIndex(null);
    }
  }, [focusIndex]);
  const label =
    (open ? "收起小镇入口" : "展开小镇入口") +
    (channels.length ? " · 有新动态" : "");
  return (
    <div
      id="chat-places"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
          return;
        }
        if (
          ![
            "ArrowRight",
            "ArrowLeft",
            "ArrowDown",
            "ArrowUp",
            "Home",
            "End",
          ].includes(event.key)
        )
          return;
        event.preventDefault();
        setOpen(true);
        const current = buttons.current.indexOf(
            event.target as HTMLButtonElement,
          ),
          backwards = ["ArrowLeft", "ArrowUp"].includes(event.key);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? places.length - 1
              : current < 0
                ? backwards
                  ? places.length - 1
                  : 0
                : (current + (backwards ? -1 : 1) + places.length) %
                  places.length;
        setFocusIndex(next);
      }}
    >
      <button
        ref={trigger}
        id="chat-places-trigger"
        type="button"
        aria-controls="chat-places-menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={channels.length ? "has-town-activity" : ""}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m14 6-6 6 6 6" />
        </svg>
      </button>
      <div id="chat-places-popup" hidden={!open}>
        <nav id="chat-places-menu" aria-label="小镇入口">
          {places.map((place, i) => (
            <button
              key={place.view}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              data-place={place.view}
              className={
                channels.includes(place.view) ? "has-town-activity" : ""
              }
              aria-label={
                place.label +
                (channels.includes(place.view) ? " · 有新动态" : "")
              }
              onClick={() =>
                send({ type: "beings:open-place", view: place.view })
              }
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {place.icon}
              </svg>
              <span>{place.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

export interface ChatIndexHandle {
  publish(): void;
  jump(id: string): void;
}
export function ChatIndex({
  items,
  container,
  elements,
  scrollLock,
  send,
  highlight,
  ref,
}: {
  items: ChatItem[];
  container: RefObject<HTMLDivElement | null>;
  elements: RefObject<Map<string, HTMLDivElement>>;
  scrollLock: RefObject<boolean>;
  send: (data: Record<string, unknown>) => void;
  highlight: (id: string | null) => void;
  ref: Ref<ChatIndexHandle>;
}) {
  const signature = items
    .filter(
      (item): item is Message =>
        item.kind === "message" && item.role === "user",
    )
    .map((item) => `${item.id}:${item.text}`)
    .join("\n");
  const turns = useMemo(
    () =>
      items
        .filter(
          (item): item is Message =>
            item.kind === "message" && item.role === "user",
        )
        .map((item) => ({
          id: item.turnId!,
          messageId: item.id,
          text: markdownText(splitSchedulingHint(item.text).text).slice(0, 240) || "附件消息",
        })),
    [signature],
  );
  const nav = useRef<HTMLElement>(null),
    ticks = useRef<HTMLDivElement>(null),
    buttons = useRef(new Map<string, HTMLButtonElement>()),
    preview = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0),
    [hovered, setHovered] = useState<string | null>(null),
    [top, setTop] = useState(12);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const publish = () =>
    send({
      type: "beings:search-index",
      entries: turns.slice(-2000).map(({ id, text }) => ({ id, text })),
    });
  function updateActive() {
    const messages = container.current;
    if (!messages) return;
    const top = messages.getBoundingClientRect().top + 44;
    let next = 0;
    for (let i = 0; i < turns.length; i++) {
      if (
        (elements.current.get(turns[i].messageId)?.getBoundingClientRect()
          .top ?? Infinity) > top
      )
        break;
      next = i;
    }
    if (messages.scrollHeight - messages.scrollTop - messages.clientHeight < 8)
      next = turns.length - 1;
    setActive(next);
  }
  function jump(id?: string) {
    const turn = turns.find((turn) => turn.id === id),
      messages = container.current;
    if (!messages || (id && !turn)) return;
    const target = turn && elements.current.get(turn.messageId);
    scrollLock.current = !turn;
    messages.scrollTo({
      top: target
        ? messages.scrollTop +
          target.getBoundingClientRect().top -
          messages.getBoundingClientRect().top -
          24
        : messages.scrollHeight,
      behavior: "instant",
    });
    highlight(turn?.messageId || null);
    clearTimeout(timer.current);
    if (turn) timer.current = setTimeout(() => highlight(null), 1400);
    setHovered(null);
    updateActive();
  }
  useImperativeHandle(ref, () => ({ publish, jump }));
  useEffect(publish, [turns, send]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    const messages = container.current;
    if (!messages) return;
    const observer = new ResizeObserver(updateActive);
    observer.observe(messages);
    messages.addEventListener("scroll", updateActive, { passive: true });
    updateActive();
    return () => {
      observer.disconnect();
      messages.removeEventListener("scroll", updateActive);
    };
  }, [turns]);
  useLayoutEffect(() => {
    updateActive();
  }, [items.length]);
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
  }, [hovered, replies.join(" ")]);
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
              aria-describedby="chat-index-preview"
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
        <button
          id="chat-index-latest"
          type="button"
          title="回到最新消息"
          aria-label="回到最新消息"
          onClick={() => jump()}
        >
          ↓
        </button>
      </nav>
      <div
        ref={preview}
        id="chat-index-preview"
        role="tooltip"
        hidden={!turn}
        style={{ top }}
      >
        <strong>{turn?.text}</strong>
        <p>{replies.join(" ").slice(0, 240) || "暂无回复"}</p>
      </div>
    </>
  );
}

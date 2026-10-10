import { useLayoutEffect, useState, type RefObject } from "react";
import type { ChatItem } from "../models/chat";

export function JumpToLatest({ items, container, elements, scrollLock, clearAnchor }: {
  items: ChatItem[];
  container: RefObject<HTMLDivElement | null>;
  elements: RefObject<Map<string, HTMLDivElement>>;
  scrollLock: RefObject<boolean>;
  clearAnchor: () => void;
}) {
  const [below, setBelow] = useState(0);
  const [away, setAway] = useState(false);
  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const distant = node.scrollHeight - node.scrollTop - node.clientHeight > 24;
      const bottom = node.getBoundingClientRect().bottom;
      setAway(distant);
      setBelow(distant ? items.filter(item => item.kind === "message" &&
        (elements.current.get(item.id)?.getBoundingClientRect().bottom ?? 0) > bottom + 1).length : 0);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    for (const child of node.children) observer.observe(child);
    node.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); node.removeEventListener("scroll", schedule); };
  }, [items, container, elements]);
  return <button id="chat-jump-latest" type="button" hidden={!away}
    aria-label={below ? `${below} 条消息，回到最新消息` : "回到最新消息"}
    onClick={() => {
      clearAnchor();
      scrollLock.current = true;
      container.current?.scrollTo({ top: container.current.scrollHeight,
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    }}>
    <span>{below ? `${below} 条消息` : "回到最新消息"}</span>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
  </button>;
}

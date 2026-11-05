import useEventListener from 'ahooks/es/useEventListener';
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject, type TouchEvent, type WheelEvent } from 'react';
import type { ChatItem } from '../models/chat';
import { firstAfter } from '../models/scroll-position';

/** One controller owns bottom-follow and reading-position compensation. */
export function useMessageScroll(items: ChatItem[], container: RefObject<HTMLDivElement | null>, elements: RefObject<Map<string, HTMLDivElement>>) {
  const ordered = useRef<HTMLDivElement[]>([]);
  const snapshot = useRef({ away: false, count: 0 }), listeners = useRef(new Set<() => void>());
  const subscribe = useCallback((listener: () => void) => { listeners.current.add(listener); return () => { listeners.current.delete(listener); }; }, []);
  const getSnapshot = useCallback(() => snapshot.current, []);
  const publish = useCallback(() => {
    const el = container.current;
    if (!el) return;
    const away = el.clientHeight > 0 && el.scrollHeight - el.scrollTop - el.clientHeight > 2;
    const bottom = away ? el.getBoundingClientRect().top + el.clientHeight : 0;
    const count = away ? ordered.current.length - firstAfter(ordered.current.length, bottom + 2, index => ordered.current[index].getBoundingClientRect().bottom) : 0;
    if (snapshot.current.away === away && snapshot.current.count === count) return;
    snapshot.current = { away, count };
    listeners.current.forEach(listener => listener());
  }, [container]);
  const scrollLock = useRef(true), observedTop = useRef<number | null>(null), frame = useRef(0);
  const touchY = useRef(0);
  const reading = useRef<{ node: Element; offset: number; scrollTop: number; width: number } | null>(null);
  const remember = useCallback(() => {
    const el = container.current;
    if (!el) return;
    if (scrollLock.current) { reading.current = null; return; }
    const top = el.getBoundingClientRect().top;
    const boundary = top + parseFloat(getComputedStyle(el).scrollPaddingTop) + 1;
    let node: Element | undefined = ordered.current[firstAfter(ordered.current.length, boundary, index => ordered.current[index].getBoundingClientRect().bottom)];
    // Anchor the visible block inside a long reply, not its offscreen beginning.
    if (node && node.getBoundingClientRect().top < boundary) {
      let anchor: Element = node.querySelector('.message-bubble-body') || node;
      while (anchor.children.length && !anchor.matches('p,pre,li,h1,h2,h3,h4,h5,h6,button,img,video,canvas')) {
        const children: HTMLCollection = anchor.children;
        const child: Element | undefined = children[firstAfter(children.length, boundary, index => children[index].getBoundingClientRect().bottom)];
        if (!child) break;
        anchor = child;
      }
      node = anchor;
    }
    const offset = node ? node.getBoundingClientRect().top - top : el.clientHeight;
    reading.current = node && offset < el.clientHeight ? { node, offset, scrollTop: el.scrollTop, width: el.clientWidth } : null;
  }, [container]);
  const currentItems = useRef(items); currentItems.current = items;
  const releaseAnchor = useCallback(() => {
    // Explicit navigation replaces both the reading position and any pending
    // programmatic scroll event, before its highlight/history render commits.
    reading.current = null;
    observedTop.current = null;
  }, []);
  const layout = useCallback((follow = true) => {
    const el = container.current;
    if (!el || !el.clientWidth || !el.clientHeight) return;
    const floor = Math.max(0, el.scrollHeight - el.clientHeight);
    // Like Harness, record our writes separately from reader movement. Browser
    // clamping after shrink and delayed scroll events must not cancel following.
    const moved = observedTop.current !== null && Math.abs(el.scrollTop - Math.min(observedTop.current, floor)) > 0.5;
    const saved = reading.current;
    const reflow = saved && saved.width !== el.clientWidth;
    if (moved && !reflow) {
      scrollLock.current = floor - el.scrollTop <= 2;
    }
    if (scrollLock.current) {
      if (follow || !moved) el.scrollTop = floor;
    } else if (saved?.node.isConnected) {
      // Content-space movement excludes concurrent user scrolling. Native
      // overflow anchoring is disabled so this shift is applied exactly once.
      // A wider chat can clamp scrollTop before ResizeObserver runs. In that
      // case restore the screen offset directly instead of counting the clamp
      // as reader movement and applying the layout delta a second time.
      const clamped = observedTop.current !== null && observedTop.current > floor && Math.abs(el.scrollTop - floor) < 1;
      const shift = saved.node.getBoundingClientRect().top - el.getBoundingClientRect().top - saved.offset +
        (reflow || clamped ? 0 : el.scrollTop - saved.scrollTop);
      if (Math.abs(shift) > 0.5) el.scrollTop += shift;
    }
    observedTop.current = el.scrollTop;
    remember();
    publish();
  }, [container, remember, publish]);
  const schedule = useCallback(() => { if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; layout(); }); }, [layout]);
  // Draft/status renders do not need another synchronous geometry scan.
  const structure = items.map(item => item.id).join('\u0000');
  useLayoutEffect(() => {
    ordered.current = currentItems.current.flatMap(item => {
      const node = item.kind === 'message' ? elements.current.get(item.id) : undefined;
      return node ? [node] : [];
    });
    layout();
  }, [structure, layout, elements]);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    // Settle stream, image, composer and viewport growth before paint.
    const observer = new ResizeObserver(() => layout());
    const observed = new Set<Element>();
    const observe = () => {
      observer.observe(el);
      for (const child of observed) if (child.parentElement !== el) { observer.unobserve(child); observed.delete(child); }
      for (const child of el.children) if (!observed.has(child)) { observed.add(child); observer.observe(child, { box: 'border-box' }); }
      schedule();
    };
    const mutation = new MutationObserver(observe);
    mutation.observe(el, { childList: true }); observe();
    return () => { observer.disconnect(); mutation.disconnect(); cancelAnimationFrame(frame.current); frame.current = 0; };
  }, [container, schedule, layout]);
  useEventListener('keydown', (event: KeyboardEvent) => {
    if (event.defaultPrevented || !(event.target instanceof HTMLElement) || event.target.closest('input,textarea,select,[contenteditable=true],[role=menu]')) return;
    if (['PageUp', 'Home', 'ArrowUp'].includes(event.key) || (event.key === ' ' && event.shiftKey && !event.target.closest('button'))) {
      scrollLock.current = false;
      remember();
    }
  }, { target: container });
  return {
    scrollLock, releaseAnchor, subscribe, getSnapshot,
    onWheel(event: WheelEvent) {
      if (event.deltaY >= 0) return;
      scrollLock.current = false;
      remember();
    },
    onTouchStart(event: TouchEvent) { touchY.current = event.touches[0].clientY; },
    onTouchMove(event: TouchEvent) {
      const y = event.touches[0].clientY;
      if (y > touchY.current) { scrollLock.current = false; remember(); }
      touchY.current = y;
    },
    onScroll() { layout(false); },
  };
}

import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Retain the closing panel, and reverse from its current visual position on interruption. */
export function usePanelMotion(ref: RefObject<HTMLElement | null>, open: boolean, width: number) {
  const [retained, setRetained] = useState(open);
  const previous = useRef(open);
  const interrupted = useRef<{ opacity: string; transform: string } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const content = element?.querySelector<HTMLElement>('.being-info-body');
    if (!element || !content) return;
    const changed = previous.current !== open;
    previous.current = open;
    if (open) setRetained(true);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    if (!changed || reduced.matches) {
      interrupted.current = null;
      setRetained(open);
      return;
    }
    const from = interrupted.current;
    interrupted.current = null;
    // Animate only composited properties. Resizing flex-basis on every frame also
    // resizes the chat iframe, reflows messages and invokes its scroll controller.
    element.dataset.animating = 'true';
    const options = { duration: open ? 320 : 220, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' as const };
    const rail = element.animate([
      { transform: from?.transform || (open ? 'translateX(100%)' : 'translateX(0)') },
      { transform: open ? 'translateX(0)' : 'translateX(100%)' },
    ], options);
    const ink = content.animate([
      { opacity: from?.opacity || (open ? '0' : '1') },
      { opacity: open ? '1' : '0' },
    ], options);
    let finished = false;
    const finish = () => {
      finished = true;
      // data-closing keeps the final offscreen transform after cancellation,
      // until React commits hidden; there is no visible rollback frame.
      rail.cancel(); ink.cancel();
      delete element.dataset.animating;
      setRetained(open);
    };
    rail.onfinish = finish;
    // Resizing and live accessibility changes settle immediately, without fighting a drag.
    window.addEventListener('resize', finish);
    reduced.addEventListener('change', finish);
    return () => {
      if (!finished) interrupted.current = {
        opacity: getComputedStyle(content).opacity,
        transform: getComputedStyle(element).transform,
      };
      rail.cancel(); ink.cancel();
      delete element.dataset.animating;
      window.removeEventListener('resize', finish);
      reduced.removeEventListener('change', finish);
    };
  }, [ref, open, width]);
  return open || retained;
}

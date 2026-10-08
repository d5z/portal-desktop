import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

// Portal choices, not claimed Codex measurements. See the interaction spec.
export const SIDEBAR_WIDTH = { default: 224, min: 200, max: 400, contentMin: 320 };

export function useSidebarWidth(panel: RefObject<HTMLElement | null>, storageKey: string) {
  const [preferred, setPreferred] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved >= SIDEBAR_WIDTH.min && saved <= SIDEBAR_WIDTH.max) return saved;
    } catch { /* Private browsing can disable storage. */ }
    return SIDEBAR_WIDTH.default;
  });
  const [bounds, setBounds] = useState({ min: SIDEBAR_WIDTH.min, max: SIDEBAR_WIDTH.max });
  const [canOccupySpace, setCanOccupySpace] = useState(true);
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ x: number; width: number; preferred: number; element: HTMLElement; pointer: number } | null>(null);
  const current = useRef(preferred);
  const width = Math.round(Math.max(bounds.min, Math.min(bounds.max, preferred)));
  const persist = (value: number) => { try { localStorage.setItem(storageKey, String(value)); } catch { /* Width remains usable for this window. */ } };
  const update = (value: number, save = false) => {
    current.current = Math.round(Math.max(bounds.min, Math.min(bounds.max, value)));
    setPreferred(current.current);
    if (save) persist(current.current);
  };
  const finish = (cancel: boolean) => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    if (cancel) { current.current = active.preferred; setPreferred(active.preferred); }
    else persist(current.current);
    if (active.element.hasPointerCapture(active.pointer)) active.element.releasePointerCapture(active.pointer);
    setResizing(false);
  };
  useLayoutEffect(() => {
    const stage = panel.current?.closest<HTMLElement>('.workspace-stage');
    if (!stage) return;
    const measure = () => {
      const available = stage.clientWidth;
      if (!available) return;
      const min = Math.min(SIDEBAR_WIDTH.min, Math.max(0, available - 48));
      const max = Math.max(min, Math.min(SIDEBAR_WIDTH.max, available - SIDEBAR_WIDTH.contentMin));
      setBounds(current => current.min === min && current.max === max ? current : { min, max });
      const sidebarWidth = panel.current?.getBoundingClientRect().width ?? 0;
      setCanOccupySpace(available - sidebarWidth >= SIDEBAR_WIDTH.contentMin);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    if (panel.current) observer.observe(panel.current);
    measure();
    return () => observer.disconnect();
  }, [panel]);
  useLayoutEffect(() => {
    const stage = panel.current?.closest<HTMLElement>('.workspace-stage');
    stage?.style.setProperty('--scene-sidebar-width', `${width}px`);
    return () => { stage?.style.removeProperty('--scene-sidebar-width'); };
  }, [panel, width]);
  useLayoutEffect(() => {
    if (!resizing) return;
    const stage = panel.current?.closest<HTMLElement>('.workspace-stage');
    stage?.setAttribute('data-sidebar-sizing', 'true');
    const cancel = () => finish(true);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    return () => {
      stage?.removeAttribute('data-sidebar-sizing');
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
    };
  }, [resizing, panel]);
  return { width, bounds, resizing, canOccupySpace, reset: () => update(SIDEBAR_WIDTH.default, true),
    props: {
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        event.preventDefault(); event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width, preferred, element: event.currentTarget, pointer: event.pointerId };
        current.current = width; setResizing(true);
      },
      onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
        if (drag.current) update(drag.current.width + event.clientX - drag.current.x);
      },
      onPointerUp: () => finish(false),
      onPointerCancel: () => finish(true),
      onLostPointerCapture: () => finish(true),
      onDoubleClick: () => update(SIDEBAR_WIDTH.default, true),
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        update(event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max
          : width + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 32 : 8), true);
      },
    },
  };
}

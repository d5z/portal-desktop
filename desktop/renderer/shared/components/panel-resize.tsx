import clsx from 'clsx';
import styles from './panel-resize.module.scss';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Shared sizing for supplementary panels; never remounts their content. */
export function usePanelWidth(key: string, initial: number) {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(`beings:panel:${key}`));
      if (Number.isFinite(saved) && saved >= 180 && saved <= 1600) return saved;
    } catch { /* Optional preference. */ }
    return initial;
  });
  const resize = (next: number) => {
    const value = Math.round(next);
    setWidth(value);
    try { localStorage.setItem(`beings:panel:${key}`, String(value)); } catch { /* Optional preference. */ }
  };
  return [width, resize] as const;
}

export function PanelResizeHandle({ panel, label, width, onResize, initial, min = 240, max = 640, reserve = 320, edge = "left", disabled = false, onDraggingChange }: {
  panel: RefObject<HTMLElement | null>; label: string; width: number; onResize: (width: number) => void;
  initial: number; min?: number; max?: number; reserve?: number; edge?: "left" | "right"; disabled?: boolean;
  onDraggingChange?: (dragging: boolean) => void;
}) {
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const pending = useRef<{ frame: number; commit: () => void } | null>(null);
  const [limit, setLimit] = useState(max);
  useLayoutEffect(() => {
    const parent = panel.current?.parentElement;
    if (!parent || disabled) return;
    const update = () => {
      const rail = parent.querySelector(':scope > .workspace-rail')?.getBoundingClientRect().width || 0;
      setLimit(Math.max(0, Math.min(max, parent.clientWidth - reserve - rail)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [panel, max, reserve, disabled]);
  const lower = Math.min(min, limit);
  const apply = (next: number) => onResize(Math.max(lower, Math.min(limit, next)));
  const stop = () => {
    const active = drag.current;
    drag.current = null;
    // Keep the final pointer position even when release precedes the next paint.
    if (pending.current) { cancelAnimationFrame(pending.current.frame); pending.current.commit(); }
    if (active && handle.current?.hasPointerCapture(active.id)) handle.current.releasePointerCapture(active.id);
    handle.current?.removeAttribute("data-resizing");
    if (active) onDraggingChange?.(false);
  };
  useEffect(() => {
    window.addEventListener("blur", stop);
    return () => { window.removeEventListener("blur", stop); stop(); };
  }, []);
  useEffect(() => { if (disabled) stop(); }, [disabled]);
  return <div ref={handle} className={clsx(styles.handle, styles[edge])} data-slot="panel-resize-handle" role="separator" tabIndex={0} hidden={disabled}
    aria-description="拖动调整宽度，双击恢复" aria-label={label} aria-orientation="vertical" aria-valuemin={lower} aria-valuemax={limit}
    aria-valuenow={Math.max(lower, Math.min(limit, width))} aria-valuetext={`${Math.max(lower, Math.min(limit, width))} 像素`}
    onPointerDown={event => {
      if (event.button !== 0 || !panel.current) return;
      event.preventDefault(); event.currentTarget.focus();
      drag.current = { id: event.pointerId, x: event.clientX, width: panel.current.getBoundingClientRect().width };
      event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.dataset.resizing = "true";
      onDraggingChange?.(true);
    }}
    onPointerMove={event => {
      const active = drag.current;
      if (active?.id !== event.pointerId) return;
      const next = active.width + (event.clientX - active.x) * (edge === "right" ? 1 : -1);
      if (pending.current) cancelAnimationFrame(pending.current.frame);
      // Multiple pointer events in one frame need one render and preference write.
      const commit = () => { pending.current = null; apply(next); };
      pending.current = { frame: requestAnimationFrame(commit), commit };
    }}
    onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
    onDoubleClick={() => apply(initial)}
    onKeyDown={event => {
      const step = event.shiftKey ? 64 : 24;
      const actual = panel.current?.getBoundingClientRect().width || width;
      const next = event.key === "Home" ? lower : event.key === "End" ? limit :
        event.key === "ArrowLeft" ? actual + (edge === "left" ? step : -step) :
        event.key === "ArrowRight" ? actual + (edge === "left" ? -step : step) : undefined;
      if (next !== undefined) { event.preventDefault(); apply(next); }
    }} />;
}

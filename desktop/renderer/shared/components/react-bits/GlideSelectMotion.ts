import type { FocusEvent, PointerEvent } from 'react';

// Active-pill update adapted from GlideSelect-TS-CSS. See SOURCES.md.
export function moveMenuGlide(surface: HTMLElement, target: EventTarget | null) {
  if (!(target instanceof Element)) return;
  const row = target.closest<HTMLElement>('button:not(:disabled), summary');
  if (!row || row.closest('[data-attachment-glide]') !== surface) return;
  const bounds = row.getBoundingClientRect();
  const panel = surface.getBoundingClientRect();
  const scale = panel.height / surface.offsetHeight || 1;
  const p = surface.querySelector<HTMLElement>(':scope > .glide-select__pill')!;
  const activeTop = (bounds.top - panel.top) / scale - surface.clientTop;
  const jump = p.style.opacity !== '1';
  p.style.transitionDuration = jump ? '0ms, 150ms' : '';
  p.style.transform = `translateY(${activeTop}px)`;
  p.style.height = `${bounds.height / scale}px`;
  p.style.opacity = '1';
  surface.dataset.gliding = '';
}

export function clearMenuGlide(surface: HTMLElement) {
  surface.querySelector<HTMLElement>(':scope > .glide-select__pill')!.style.opacity = '0';
  delete surface.dataset.gliding;
}

export const menuGlide = {
  'data-attachment-glide': '',
  onPointerOver: (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse') moveMenuGlide(event.currentTarget, event.target);
  },
  onFocus: (event: FocusEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.matches(':focus-visible')) clearMenuGlide(event.currentTarget);
  },
  onPointerLeave: (event: PointerEvent<HTMLElement>) => { clearMenuGlide(event.currentTarget); },
  onBlur: (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) clearMenuGlide(event.currentTarget);
  },
};

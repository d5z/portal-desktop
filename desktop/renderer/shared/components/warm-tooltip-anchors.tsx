import { useContext, useEffect, useEffectEvent, type RefObject } from 'react';
import { useReducedMotion } from 'motion/react';
import { WarmTooltipGroupContext, type WarmTooltipSide } from './react-bits/WarmTooltip';

type AnchorAppearance = {
  side: WarmTooltipSide;
  gap: number;
  radius: number;
  font: number;
  px: number;
  py: number;
  surfaceColor: string;
  inkColor: string;
};

export const shellTooltipAppearance: AnchorAppearance = {
  side: 'right', gap: 12, radius: 12, font: 13, px: 12, py: 9,
  surfaceColor: 'var(--control)', inkColor: 'var(--text)',
};

// Delegate on the DOM so native summaries, hit areas and portaled plugin controls
// can share the upstream Warm Tooltip group without an extra trigger element.
export function WarmTooltipAnchors({ rootRef, appearance, selector = '[data-warm-tooltip]' }: {
  rootRef: RefObject<HTMLElement | null>;
  appearance: AnchorAppearance;
  selector?: string;
}) {
  const group = useContext(WarmTooltipGroupContext)!;
  const reduced = useReducedMotion();
  const open = useEffectEvent((trigger: HTMLElement, id: string, label: string, mode: 'cold' | 'warm' | 'instant') => {
    group.show({
      id, trigger, content: <span>{label}</span>,
      shortcut: trigger.dataset.warmTooltipShortcut ?? trigger.dataset.railShortcut,
      ...appearance, arrow: false,
      popDuration: reduced ? 0 : 120, popScale: 1, popBlur: 0, warmWindow: group.warmWindow,
    }, mode);
  });
  const close = useEffectEvent((id: string, instant: boolean) => group.hide(id, instant));
  const isWarm = useEffectEvent(() => group.isWarm());
  const reset = useEffectEvent(() => group.reset());
  const { id: tooltipId, delay } = group;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ids = new WeakMap<HTMLElement, string>();
    let nextId = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: { trigger: HTMLElement; id: string } | undefined;

    const hide = (instant: boolean) => {
      clearTimeout(timer);
      if (!current) return;
      const { trigger, id } = current;
      const descriptions = (trigger.getAttribute('aria-describedby') || '').split(/\s+/).filter(token => token && token !== tooltipId);
      if (descriptions.length) trigger.setAttribute('aria-describedby', descriptions.join(' '));
      else trigger.removeAttribute('aria-describedby');
      close(id, instant);
      current = undefined;
    };
    const find = (target: EventTarget | null) =>
      target instanceof Element && target.closest('[data-warm-tooltip-scope]') === root
        ? target.closest<HTMLElement>(selector) : null;
    const canShow = (trigger: HTMLElement) => root.contains(trigger)
      && !trigger.matches(':disabled, [aria-disabled="true"], details[open] > summary')
      && !trigger.closest('[inert], [data-sorting]')
      && !root.querySelector('[data-queue-dragging]');
    const enter = (trigger: HTMLElement, instant: boolean) => {
      if (current?.trigger === trigger || !canShow(trigger)) return;
      const label = trigger.dataset.warmTooltip ?? trigger.dataset.railTooltip
        ?? (trigger.getAttribute('aria-label') || trigger.title || trigger.textContent?.trim());
      if (!label) return;
      hide(false);
      const id = ids.get(trigger) ?? String(++nextId);
      ids.set(trigger, id);
      current = { trigger, id };
      const show = (mode: 'cold' | 'warm' | 'instant') => {
        if (!canShow(trigger)) return;
        const descriptions = trigger.getAttribute('aria-describedby');
        trigger.setAttribute('aria-describedby', descriptions ? `${descriptions} ${tooltipId}` : tooltipId);
        open(trigger, id, label, mode);
      };
      if (instant) show('instant');
      else if (isWarm()) show('warm');
      else timer = setTimeout(() => show('cold'), delay);
    };
    const listeners = new AbortController();
    const options = { signal: listeners.signal, capture: true };
    root.addEventListener('pointerover', event => {
      const trigger = find(event.target);
      if (trigger && event.pointerType !== 'touch' && !event.buttons && find(event.relatedTarget) !== trigger) enter(trigger, false);
    }, options);
    root.addEventListener('pointerout', event => {
      if (current && event.pointerType !== 'touch' && find(event.target) === current.trigger && find(event.relatedTarget) !== current.trigger) hide(false);
    }, options);
    root.addEventListener('focusin', event => {
      const trigger = find(event.target);
      if (trigger?.matches(':focus-visible')) enter(trigger, true);
    }, options);
    root.addEventListener('focusout', event => {
      if (current && find(event.target) === current.trigger) hide(true);
    }, options);
    root.addEventListener('pointerdown', () => hide(true), options);
    root.addEventListener('click', () => hide(true), options);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        hide(true);
        reset();
      }
    }, options);
    window.addEventListener('blur', () => { hide(true); reset(); }, options);
    return () => { listeners.abort(); hide(true); };
  }, [rootRef, selector, tooltipId, delay]);

  return null;
}

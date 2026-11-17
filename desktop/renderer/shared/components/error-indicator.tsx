import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../icons/icon';
import styles from './error-indicator.module.scss';

export function ErrorIndicator({ description, retry }: {
  description: string;
  retry?: { label: string; run(): void; disabled?: boolean };
}) {
  const id = useId();
  const tooltip = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const tip = tooltip.current!;
    function dismiss(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !tip.matches(':popover-open')) return;
      event.preventDefault();
      event.stopPropagation();
      tip.hidePopover();
    }
    const dismissOnScroll = (event: Event) => {
      if (event.target === tip) return;
      if (trigger.current?.matches(':focus-visible')) position();
      else tip.hidePopover();
    };
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!tip.contains(target) && !trigger.current?.contains(target)) tip.hidePopover();
    };
    document.addEventListener('keydown', dismiss, true);
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('scroll', dismissOnScroll, { capture: true, passive: true });
    window.addEventListener('resize', position);
    return () => {
      document.removeEventListener('keydown', dismiss, true);
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('scroll', dismissOnScroll, true);
      window.removeEventListener('resize', position);
    };
  }, [open]);
  function position() {
    const tip = tooltip.current!;
    const { left, right, top, bottom } = trigger.current!.getBoundingClientRect();
    const { width, height } = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min((left + right - width) / 2, innerWidth - width - 8)) + 'px';
    const preferredTop = top >= height + 14 ? top - height - 6 : bottom + 6;
    tip.style.top = Math.max(8, Math.min(preferredTop, innerHeight - height - 8)) + 'px';
  }
  function show() {
    const tip = tooltip.current!;
    if (tip.matches(':popover-open')) return;
    tip.showPopover();
    position();
  }
  function hide() {
    tooltip.current?.hidePopover();
  }
  return <span className={`${styles.indicator} chat-error-indicator`}>
    <span className={styles.description} role="alert">{description}</span>
    <button ref={trigger} className={styles.status} type="button" aria-label="错误原因" aria-describedby={id}
      onPointerEnter={event => { if (event.pointerType !== 'touch') show(); }}
      onPointerLeave={event => {
        if (event.pointerType !== 'touch' && event.relatedTarget !== tooltip.current && !event.currentTarget.matches(':focus-visible')) hide();
      }}
      onFocus={event => { if (event.currentTarget.matches(':focus-visible')) show(); }}
      onBlur={hide} onClick={event => {
        event.stopPropagation();
        if (event.nativeEvent instanceof PointerEvent && event.nativeEvent.pointerType === 'touch' && tooltip.current?.matches(':popover-open')) hide();
        else show();
      }}
    >
      <Icon name="chat-error" width="16" height="16" />
    </button>
    {retry && <button className={styles.retry} type="button" aria-label={retry.label} title={retry.label}
      disabled={retry.disabled} onClick={event => { event.stopPropagation(); retry.run(); }}>
      <Icon name="chat-retry" width="16" height="16" />
    </button>}
    <span ref={tooltip} id={id} className={styles.tooltip} role="tooltip" popover="manual" onToggle={event => setOpen(event.newState === 'open')} onPointerLeave={event => {
      if (event.pointerType !== 'touch' && event.relatedTarget !== trigger.current && !trigger.current?.matches(':focus-visible')) hide();
    }}>{description}</span>
  </span>;
}

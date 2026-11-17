import { dropdownMenuPopover } from '../../shared/components/animate-ui/dropdown-menu-motion';
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { clearMenuGlide, moveMenuGlide } from '../../shared/components/react-bits/GlideSelectMotion';
import { useDismissAttachmentMenu } from './use-dismiss-attachment-menu';
import { Icon } from '../../shared/icons/icon';
import { positionActionMenu } from '../../shared/lib/action-menu-position';

export function AttachmentFileMenu({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => { if (popup.current?.matches(':popover-open')) popup.current.hidePopover(); };
  function dismiss(event: KeyboardEvent | globalThis.KeyboardEvent) {
    if (event.key !== 'Escape' || !popup.current?.matches(':popover-open')) return false;
    event.preventDefault();
    event.stopPropagation();
    close();
    trigger.current?.focus({ preventScroll: true });
    return true;
  }
  useDismissAttachmentMenu(open, [trigger, popup], close);
  const place = () => positionActionMenu(trigger.current!, popup.current!);
  useLayoutEffect(() => {
    if (!open) return;
    const node = popup.current!;
    place();
    const resize = new ResizeObserver(place);
    resize.observe(node);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    // File action groups are portals, so listen on the shared DOM menu.
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    node.addEventListener('keydown', event => {
        if (dismiss(event)) return;
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        const items = Array.from(node.querySelectorAll<HTMLButtonElement>('button:enabled'));
        const selected = items.indexOf(document.activeElement as HTMLButtonElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : event.key === 'ArrowUp' ? selected > 0 ? selected - 1 : items.length - 1 : (selected + 1) % items.length;
        event.preventDefault();
        items[index]?.focus();
    }, options);
    node.addEventListener('pointerover', event => {
      if (event.pointerType === 'mouse') moveMenuGlide(node, event.target);
    }, options);
    node.addEventListener('pointerleave', () => clearMenuGlide(node), options);
    node.addEventListener('focusin', event => {
      if (event.target instanceof Element && event.target.matches(':focus-visible')) clearMenuGlide(node);
    }, options);
    node.addEventListener('focusout', event => {
      if (!(event.relatedTarget instanceof Node) || !node.contains(event.relatedTarget)) clearMenuGlide(node);
    }, options);
    return () => {
      listeners.abort();
      resize.disconnect();
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="attachment-menu-trigger" aria-label={label}
      data-warm-tooltip={open ? undefined : '更多消息操作'}
      aria-haspopup="menu" aria-expanded={open} aria-controls={id} popoverTarget={id} onKeyDown={dismiss} onClick={event => {
        if (!open && popup.current) popup.current.dataset.pointerMotion = String(event.detail > 0);
      }}><Icon name="chat-more" width="14" height="14" strokeWidth="2" /></button>
    {createPortal(<div ref={popup} id={id} popover="auto" className="attachment-file-popover"
      role="menu" aria-label={label} tabIndex={-1} data-attachment-glide {...dropdownMenuPopover}
      onToggle={event => {
        if (event.target !== event.currentTarget) return;
        const node = event.currentTarget;
        const next = node.matches(':popover-open');
        if (!next) clearMenuGlide(node);
        else {
          const first = node.dataset.pointerMotion === 'false' && node.querySelector<HTMLButtonElement>('button[role="menuitem"]:enabled');
          (first || node).focus({ preventScroll: true });
        }
        setOpen(next);
      }}><span className="glide-select__pill" aria-hidden="true" />{children}</div>, document.body)}
  </>;
}

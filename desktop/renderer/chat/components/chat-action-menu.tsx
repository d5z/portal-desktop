import { dropdownMenuPopover } from '../../shared/components/animate-ui/dropdown-menu-motion';
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { clearMenuGlide, menuGlide } from '../../shared/components/react-bits/GlideSelectMotion';
import { useDismissAttachmentMenu } from './use-dismiss-attachment-menu';
import { Icon } from '../../shared/icons/icon';
import { positionActionMenu } from '../../shared/lib/action-menu-position';

export function ChatActionMenu({ label, children }: {
  label: string; children: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => { if (popup.current?.matches(':popover-open')) popup.current.hidePopover(); };
  function dismiss(event: KeyboardEvent) {
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
    place();
    const resize = new ResizeObserver(place);
    resize.observe(popup.current!);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => { resize.disconnect(); window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="attachment-menu-trigger" aria-label={label}
      aria-haspopup="menu" aria-expanded={open} aria-controls={id} popoverTarget={id} onKeyDown={dismiss} onClick={event => {
        if (!open && popup.current) popup.current.dataset.pointerMotion = String(event.detail > 0);
      }}><Icon name="chat-more" width="16" height="16" /></button>
    {createPortal(<div ref={popup} id={id} popover="auto" className="attachment-file-popover"
      role="menu" aria-label={label} {...menuGlide} {...dropdownMenuPopover}
      onKeyDown={event => {
        if (dismiss(event)) return;
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:enabled'));
        const selected = items.indexOf(document.activeElement as HTMLButtonElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : event.key === 'ArrowUp' ? selected > 0 ? selected - 1 : items.length - 1 : (selected + 1) % items.length;
        event.preventDefault();
        items[index]?.focus();
      }}
      onToggle={event => {
        const next = event.currentTarget.matches(':popover-open');
        if (!next) clearMenuGlide(event.currentTarget);
        else if (event.currentTarget.dataset.pointerMotion === 'false') {
          event.currentTarget.querySelector<HTMLButtonElement>('button[role="menuitem"]:enabled')?.focus({ preventScroll: true });
        }
        setOpen(next);
      }}><span className="glide-select__pill" aria-hidden="true" />{children}</div>, document.body)}
  </>;
}

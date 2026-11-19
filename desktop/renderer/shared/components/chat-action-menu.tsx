import { dropdownMenuPopover } from './animate-ui/dropdown-menu-motion';
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { clearMenuGlide, menuGlide } from './react-bits/GlideSelectMotion';
import { useDismissAttachmentMenu } from '../hooks/use-dismiss-attachment-menu';
import { Icon } from '../icons/icon';

export function ChatActionMenu({ label, className = '', children }: {
  label: string; className?: string; children: ReactNode | ((dismissToTrigger: () => void) => ReactNode);
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => { if (popup.current?.matches(':popover-open')) popup.current.hidePopover(); };
  const dismissToTrigger = () => {
    close();
    trigger.current?.focus({ preventScroll: true });
  };
  const dismissForDialog = () => {
    if (popup.current) popup.current.dataset.dialogHandoff = '';
    dismissToTrigger();
  };
  function dismiss(event: Pick<KeyboardEvent, 'key' | 'preventDefault' | 'stopPropagation'>) {
    if (event.key !== 'Escape' || !popup.current?.matches(':popover-open')) return false;
    event.preventDefault();
    event.stopPropagation();
    dismissToTrigger();
    return true;
  }
  useDismissAttachmentMenu(open, [trigger, popup], close);
  const place = () => {
    const button = trigger.current!, menu = popup.current!;
    const card = (button.closest('.attachment-file-row, [data-slot="file-card"]') ?? button).getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = menu;
    const gap = 6, edge = 8;
    const leftRoom = card.left - gap - edge, rightRoom = innerWidth - card.right - gap - edge;
    const beside = Math.max(leftRoom, rightRoom) >= width;
    const onLeft = beside && leftRoom >= rightRoom;
    const above = !beside && card.top - gap - edge >= height;
    const left = beside ? onLeft ? card.left - gap - width : card.right + gap : card.right - width;
    const top = beside ? card.top + (card.height - height) / 2 : above ? card.top - gap - height : card.bottom + gap;
    menu.style.left = `${Math.max(edge, Math.min(left, innerWidth - width - edge))}px`;
    menu.style.top = `${Math.max(edge, Math.min(top, innerHeight - height - edge))}px`;
    menu.style.transformOrigin = beside ? (onLeft ? 'right center' : 'left center') : (above ? 'right bottom' : 'right top');
  };
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const resize = new ResizeObserver(place);
    resize.observe(popup.current!);
    document.addEventListener('keydown', dismiss);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      resize.disconnect();
      document.removeEventListener('keydown', dismiss);
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className={`attachment-menu-trigger ${className}`} aria-label={label}
      aria-haspopup="menu" aria-expanded={open} aria-controls={id} popoverTarget={id} onKeyDown={dismiss} onClick={event => {
        if (popup.current && !popup.current.matches(':popover-open')) {
          delete popup.current.dataset.dialogHandoff;
          popup.current.dataset.pointerMotion = String(event.detail > 0);
        }
      }}><Icon name="chat-more" width="16" height="16" /></button>
    {createPortal(<div ref={popup} id={id} popover="auto" className="attachment-file-popover"
      role="menu" aria-label={label} {...menuGlide} {...dropdownMenuPopover}
      onKeyDown={event => {
        if (!event.currentTarget.contains(event.target as Node)) return;
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
        if (event.target !== event.currentTarget) return;
        const next = event.currentTarget.matches(':popover-open');
        if (!next) clearMenuGlide(event.currentTarget);
        else if (event.currentTarget.dataset.pointerMotion === 'false') {
          event.currentTarget.querySelector<HTMLButtonElement>('button[role="menuitem"]:enabled')?.focus({ preventScroll: true });
        }
        setOpen(next);
      }}><span className="glide-select__pill" aria-hidden="true" />{
        typeof children === 'function' ? children(dismissForDialog) : children
      }</div>, document.body)}
  </>;
}

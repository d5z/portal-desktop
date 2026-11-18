import { dropdownMenuPopover } from '../../shared/components/animate-ui/dropdown-menu-motion';
import { ChatActionTooltip } from '../../shared/components/chat-action-tooltip';
import { Icon } from '../../shared/icons/icon';
import { clearMenuGlide, menuGlide } from '../../shared/components/react-bits/GlideSelectMotion';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { canUseComposerCommand, composerCommands, insertComposerCommand } from '../models/composer-commands';
import { ComposerMenuIcon } from '../../shared/icons/composer-menu';
import type { ChatState } from '../models/chat';


export function ComposerAddMenu({ state, onUpload, onSelect }: {
  state: ChatState; onUpload: () => void; onSelect: () => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => { if (menu.current?.matches(':popover-open')) menu.current.hidePopover(); };
  const position = () => {
    const element = menu.current!, anchor = trigger.current!.getBoundingClientRect(), composer = trigger.current!.closest('#input-area')?.getBoundingClientRect();
    const left = Math.max(8, Math.min(composer?.left ?? anchor.left, innerWidth - element.offsetWidth - 8));
    const above = (composer?.top ?? anchor.top) - element.offsetHeight - 10 >= 8;
    element.style.left = `${left}px`;
    element.style.top = `${above ? (composer?.top ?? anchor.top) - element.offsetHeight - 10 : Math.max(8, Math.min(anchor.bottom + 8, innerHeight - element.offsetHeight - 8))}px`;
    element.style.transformOrigin = `${anchor.left + anchor.width / 2 - left}px ${above ? 'bottom' : 'top'}`;
  };
  const toggle = () => {
    const element = menu.current!;
    if (element.matches(':popover-open')) { close(); return; }
    // Position in the opening event, before the browser paints the top layer.
    element.showPopover(); position(); setOpen(true);
    element.querySelector<HTMLButtonElement>('button')?.focus();
  };
  useLayoutEffect(() => {
    if (!open) return;
    const element = menu.current!;
    position();
    const observer = new ResizeObserver(position); observer.observe(element);
    window.addEventListener('resize', close); window.addEventListener('blur', close);
    return () => { observer.disconnect(); window.removeEventListener('resize', close); window.removeEventListener('blur', close); };
  }, [open]);
  return <div className="composer-add">
    <ChatActionTooltip content={state.intelligentUIForMessage ? '添加附件和工具 · 本条已开启智能 UI' : '添加附件和工具'} disabled={open}>
      <button ref={trigger} type="button" className="btn-icon composer-add-trigger" aria-label="添加附件和工具"
        popoverTarget={id} onClick={event => { event.preventDefault(); toggle(); }} aria-haspopup="menu" aria-expanded={open} data-active={state.intelligentUIForMessage}>
        <Icon name="chat-plus" width="18" height="18" />
        {state.intelligentUIForMessage && <span className="composer-add-dot" aria-hidden="true"/>}
      </button>
    </ChatActionTooltip>
    <div id={id} ref={menu} popover="auto" role="menu" aria-label="添加附件和工具" className="composer-add-menu" {...menuGlide} {...dropdownMenuPopover}
      onToggle={event => {
        if (event.newState !== 'open') clearMenuGlide(event.currentTarget);
        setOpen(event.newState === 'open');
      }}
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
        items[next]?.focus();
      }}>
      <span className="glide-select__pill" aria-hidden="true" />
      <button type="button" role="menuitem" title="图片、文档和其他文件" onClick={() => { close(); onUpload(); }}><ComposerMenuIcon chat kind="file"/><span className="composer-menu-copy"><strong>上传附件</strong></span></button>
      <div role="separator"/>
      {composerCommands.map(command => <button key={command.id} className="composer-command-main" type="button" role="menuitem" title={command.description} onClick={() => {
        close();
        if (!canUseComposerCommand(command.id, state)) return;
        state.draft = insertComposerCommand(state.draft, command.id);
        state.changed(); onSelect();
      }}><ComposerMenuIcon chat kind={command.id}/><span className="composer-menu-copy"><strong>{command.label}</strong></span></button>)}
    </div>
  </div>;
}

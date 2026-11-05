import { Icon } from '../../shared/icons/icon';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { canUseComposerCommand, composerCommands, insertComposerCommand } from '../models/composer-commands';
import { ComposerMenuIcon } from '../../shared/icons/composer-menu';
import type { ChatState } from '../models/chat';


export function ComposerAddMenu({ state, onUpload, onSelect, onConfigureSubagent, onEnableSubagent, subagentEnabling, subagentEnableFailed }: {
  state: ChatState; onUpload: () => void; onSelect: () => void;
  onConfigureSubagent?: () => void; onEnableSubagent?: () => void; subagentEnabling?: boolean; subagentEnableFailed?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => { if (menu.current?.matches(':popover-open')) menu.current.hidePopover(); };
  const position = () => {
    const element = menu.current!, anchor = trigger.current!.getBoundingClientRect(), composer = trigger.current!.closest('#input-area')?.getBoundingClientRect(), bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(composer?.left ?? anchor.left, innerWidth - bounds.width - 8))}px`;
    element.style.top = `${(composer?.top ?? anchor.top) - bounds.height - 10 >= 8 ? (composer?.top ?? anchor.top) - bounds.height - 10 : Math.max(8, Math.min(anchor.bottom + 8, innerHeight - bounds.height - 8))}px`;
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
    <button ref={trigger} type="button" className="btn-icon composer-add-trigger" aria-label="添加附件和工具" title={state.intelligentUIForMessage ? '添加附件和工具 · 本条已开启智能 UI' : '添加附件和工具'}
      popoverTarget={id} onClick={event => { event.preventDefault(); toggle(); }} aria-haspopup="menu" aria-expanded={open} data-active={state.intelligentUIForMessage}>
      <Icon name="plus" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {state.intelligentUIForMessage && <span className="composer-add-dot" aria-hidden="true"/>}
    </button>
    <div id={id} ref={menu} popover="auto" role="menu" aria-label="添加附件和工具" className="composer-add-menu" onToggle={event => setOpen(event.newState === 'open')}
      onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
        items[next]?.focus();
      }}>
      <button type="button" role="menuitem" title="图片、文档和其他文件" onClick={() => { close(); onUpload(); }}><ComposerMenuIcon kind="file"/><span className="composer-menu-copy"><strong>上传附件</strong></span></button>
      <div role="separator"/>
      {composerCommands.map(command => <button key={command.id} className="composer-command-main" type="button" role="menuitem" title={command.description} onClick={() => {
        close();
        if (!canUseComposerCommand(command.id, state, onConfigureSubagent)) return;
        state.draft = insertComposerCommand(state.draft, command.id);
        state.changed(); onSelect();
      }}><ComposerMenuIcon kind={command.id}/><span className="composer-menu-copy"><strong>{command.label}</strong>{command.id === 'subagent' && onConfigureSubagent && state.subagentConfigured !== true && <small>需配置</small>}</span></button>)}
      {onEnableSubagent && state.subagentConfigured && state.subagentEnabled === false && <button type="button" role="menuitem" disabled={subagentEnabling} onClick={onEnableSubagent}><ComposerMenuIcon kind="subagent"/><span className="composer-menu-copy"><strong>{subagentEnabling ? '正在开启 Subagent…' : subagentEnableFailed ? '重试开启 Subagent' : '开启 Subagent'}</strong></span></button>}
    </div>
  </div>;
}

import { useId, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { RichComposer, type RichComposerProps } from '../../shared/components/rich-composer';
import { useModel } from '../../shared/hooks/use-model';
import { ComposerMenuIcon } from '../../shared/icons/composer-menu';
import { ComposerExamples } from './composer-examples';
import { composerEditorExtensions } from './composer-command-extension';
import type { ChatState } from '../models/chat';
import { canUseComposerCommand, composerCommandQuery, insertComposerCommand, matchingComposerCommands, type ComposerCommandId } from '../models/composer-commands';

/** Keep keystrokes out of the history render path; send always reads the live draft. */
export function ChatComposer({ state, onKeyDown, onConfigureSubagent, onExamples, ...props }: Omit<RichComposerProps, 'value' | 'onChange'> & { state: ChatState; onConfigureSubagent?: () => void; onExamples?: () => void }) {
  useModel(state);
  const [, redraw] = useReducer((version: number) => version + 1, 0);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusAfterSelection = useRef(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [composing, setComposing] = useState(false);
  const compositionEndedAt = useRef(0);
  const query = composerCommandQuery(state.draft);
  const commands = query === null ? [] : matchingComposerCommands(query);
  const actions = commands.flatMap(command => command.id === 'ui' && onExamples ? [command.id, 'example' as const] : [command.id]);
  const open = focused && !composing && query !== null && dismissed !== state.draft && commands.length > 0;
  const active = Math.min(selected, actions.length - 1);
  const select = (command: ComposerCommandId | 'example') => {
    if (command === 'example') { setDismissed(state.draft); onExamples?.(); return; }
    if (!canUseComposerCommand(command, state, onConfigureSubagent)) { setDismissed(state.draft); return; }
    focusAfterSelection.current = true;
    state.draft = insertComposerCommand(state.draft, command);
    state.changed();
  };
  useLayoutEffect(() => {
    if (focusAfterSelection.current) props.textareaRef.current?.focus();
    focusAfterSelection.current = false;
  }, [state.draft]);
  useLayoutEffect(() => {
    const element = menu.current;
    if (!open || !element) return;
    const viewport = window.visualViewport;
    const position = () => {
      // Mobile keyboards shrink the visual viewport without changing dvh.
      const available = element.getBoundingClientRect().bottom - (viewport?.offsetTop || 0) - 8;
      element.style.setProperty('--composer-menu-height', `${Math.max(0, Math.min(available, (viewport?.height || innerHeight) / 2))}px`);
      const selected = element.querySelector<HTMLElement>('[aria-selected=true]');
      if (!selected) return;
      const bounds = element.getBoundingClientRect(), option = selected.getBoundingClientRect();
      // Scroll only the options, never the page or the focused editor.
      if (option.top < bounds.top) element.scrollTop += option.top - bounds.top;
      else if (option.bottom > bounds.bottom) element.scrollTop += option.bottom - bounds.bottom;
    };
    let frame = 0;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(position); };
    const observer = new ResizeObserver(schedule);
    for (const anchor of [element.offsetParent, root.current?.closest('#input-area'), root.current?.closest('.chat-root')]) {
      if (anchor) observer.observe(anchor);
    }
    position();
    window.addEventListener('resize', schedule);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      window.removeEventListener('resize', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
    };
  }, [open, active]);
  return <div ref={root} className="chat-composer" onFocus={() => setFocused(true)} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
  }}>
    {open && <div ref={menu} className="composer-slash-menu" role="listbox" aria-label="斜杠功能" id={id}>
      <div className="composer-menu-header"><strong>选择功能</strong><span>本次对话 <kbd>/</kbd></span></div>
      {commands.map(command => {
        const index = actions.indexOf(command.id);
        return <div key={command.id} className="composer-command-row" role="presentation"><button className="composer-command-main" type="button" role="option" id={`${id}-${index}`}
        aria-selected={active === index} tabIndex={-1} onMouseDown={event => event.preventDefault()}
        onMouseEnter={() => setSelected(index)} onClick={() => select(command.id)}>
        <ComposerMenuIcon kind={command.id}/>
        <span className="composer-menu-copy"><strong>{command.label}</strong><small>{command.id === 'subagent' && onConfigureSubagent && state.subagentConfigured !== true ? '尚未配置 · 点击配置模型' : command.description}</small></span><code className="composer-menu-shortcut">/{command.id}</code><span className="composer-menu-return" aria-hidden="true">↵</span>
      </button>{command.id === 'ui' && onExamples && <ComposerExamples onSelect={() => select('example')} option={{ id: `${id}-${index + 1}`, selected: active === index + 1, onHover: () => setSelected(index + 1) }}/>}</div>;
      })}
      <div className="composer-menu-footer" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 使用</span><span><kbd>esc</kbd> 关闭</span></div>
    </div>}
    <RichComposer {...props} editorExtensions={composerEditorExtensions} aria-controls={open ? id : undefined} aria-autocomplete="list" aria-activedescendant={open ? `${id}-${active}` : undefined}
      value={state.draft} onCompositionStart={event => { setComposing(true); props.onCompositionStart?.(event); }}
      onCompositionEnd={event => { setComposing(false); compositionEndedAt.current = Date.now(); props.onCompositionEnd?.(event); }}
      onKeyDown={event => {
        if (composing || event.nativeEvent.isComposing || event.keyCode === 229 || (event.key === 'Enter' && Date.now() - compositionEndedAt.current < 50)) return;
        if (open && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
          if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
            if (event.key === 'Escape') setDismissed(state.draft);
            else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') setSelected((active + (event.key === 'ArrowDown' ? 1 : -1) + actions.length) % actions.length);
            else select(actions[active]);
            return;
          }
        }
        onKeyDown?.(event);
      }} onChange={value => {
        const hadText = Boolean(state.draft.trim());
        state.draft = value;
        setSelected(0); setDismissed(null);
        // The surrounding send/stop and queue controls only depend on emptiness.
        if (hadText !== Boolean(value.trim())) state.changed();
        else redraw();
      }} />
  </div>;
}

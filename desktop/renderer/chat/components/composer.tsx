import { AnimatePresence } from 'motion/react';
import { DropdownMenuMotion } from '../../shared/components/animate-ui/dropdown-menu-motion';
import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { RichComposer, type RichComposerProps } from '../../shared/components/rich-composer';
import { useModel } from '../../shared/hooks/use-model';
import { ComposerMenuIcon } from '../../shared/icons/composer-menu';
import { ComposerExamples } from './composer-examples';
import { composerEditorExtensions } from './composer-command-extension';
import type { ChatState } from '../models/chat';
import { canUseComposerCommand, composerCommandQuery, insertComposerCommand, matchingComposerCommands, type ComposerCommandId } from '../models/composer-commands';
import { workDraftLink } from '../../shared/lib/navigation';

/** Keep keystrokes out of the history render path; send always reads the live draft. */
export function ChatComposer({ state, onKeyDown, onExamples, queueEdit, loadWorkTitles, ...props }: Omit<RichComposerProps, 'value' | 'onChange'> & {
  state: ChatState; onExamples?: () => void; queueEdit?: { text: string; onChange: (text: string) => void };
  loadWorkTitles?: (refresh: boolean) => Promise<Record<string, string>>;
}) {
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
  const [workTitles, setWorkTitles] = useState<Record<string, string>>({});
  const compositionEndedAt = useRef(0);
  const query = queueEdit ? null : composerCommandQuery(state.draft);
  const mentionQuery = loadWorkTitles && !queueEdit ? /(?:^|[\s（，。！？：、])@([^@\n[\]()]{0,80})$/u.exec(state.draft)?.[1] : undefined;
  const mentioning = focused && !composing && mentionQuery !== undefined && dismissed !== state.draft;
  useEffect(() => {
    if (!mentioning || !loadWorkTitles) return;
    let active = true;
    void loadWorkTitles(true).then(titles => { if (active) setWorkTitles(titles); });
    return () => { active = false; };
  }, [mentioning, loadWorkTitles]);
  const mentions = mentioning ? Object.entries(workTitles).filter(([id, title]) =>
    id.startsWith('work_') && title.toLowerCase().includes(mentionQuery!.trim().toLowerCase())).slice(0, 6) : [];
  const commands = query === null ? [] : matchingComposerCommands(query);
  const actions = commands.flatMap(command => command.id === 'ui' && onExamples ? [command.id, 'example' as const] : [command.id]);
  const optionCount = mentioning ? mentions.length : actions.length;
  const open = focused && !composing && dismissed !== state.draft && optionCount > 0;
  const active = Math.min(selected, optionCount - 1);
  const select = (command: ComposerCommandId | 'example') => {
    if (command === 'example') { setDismissed(state.draft); onExamples?.(); return; }
    if (!canUseComposerCommand(command, state)) { setDismissed(state.draft); return; }
    focusAfterSelection.current = true;
    state.draft = insertComposerCommand(state.draft, command);
    state.changed();
  };
  const selectMention = (index: number) => {
    const [taskId, title] = mentions[index];
    focusAfterSelection.current = true;
    state.draft = state.draft.slice(0, state.draft.lastIndexOf('@')) + workDraftLink(title, taskId) + ' ';
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
      const anchor = element.offsetParent;
      const bottom = (anchor ? anchor.getBoundingClientRect().top + anchor.clientTop : 0) + element.offsetTop + element.offsetHeight;
      const available = bottom - (viewport?.offsetTop || 0) - 8;
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
    <AnimatePresence>{open && <DropdownMenuMotion ref={menu} className="composer-slash-menu" role="listbox" aria-label={mentioning ? 'Work 任务' : '斜杠功能'} id={id}>
      {mentioning ? mentions.map(([taskId, title], index) =>
        <button key={taskId} className="composer-command-main" type="button" role="option" id={`${id}-${index}`} aria-selected={active === index}
          tabIndex={-1} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setSelected(index)} onClick={() => selectMention(index)}>
          <ComposerMenuIcon chat kind="work"/><span className="composer-menu-copy"><strong>{title}</strong></span>
        </button>) : commands.map(command => {
        const index = actions.indexOf(command.id);
        return <div key={command.id} className="composer-command-row" role="presentation"><button className="composer-command-main" type="button" role="option" id={`${id}-${index}`}
        aria-selected={active === index} title={command.description} tabIndex={-1} onMouseDown={event => event.preventDefault()}
        onMouseEnter={() => setSelected(index)} onClick={() => select(command.id)}>
        <ComposerMenuIcon chat kind={command.id}/>
        <span className="composer-menu-copy"><strong>{command.label}</strong></span>
      </button>{command.id === 'ui' && onExamples && <ComposerExamples onSelect={() => select('example')} option={{ id: `${id}-${index + 1}`, selected: active === index + 1, onHover: () => setSelected(index + 1) }}/>}</div>;
      })}
    </DropdownMenuMotion>}</AnimatePresence>
    <RichComposer {...props} editorExtensions={composerEditorExtensions} aria-controls={open ? id : undefined} aria-autocomplete="list" aria-activedescendant={open ? `${id}-${active}` : undefined}
      value={queueEdit?.text ?? state.draft} onCompositionStart={event => { setComposing(true); props.onCompositionStart?.(event); }}
      onCompositionEnd={event => { setComposing(false); compositionEndedAt.current = Date.now(); props.onCompositionEnd?.(event); }}
      onKeyDown={event => {
        if (composing || event.nativeEvent.isComposing || event.keyCode === 229 || (event.key === 'Enter' && Date.now() - compositionEndedAt.current < 50)) return;
        if (open && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
          if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
            if (event.key === 'Escape') setDismissed(state.draft);
            else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') setSelected((active + (event.key === 'ArrowDown' ? 1 : -1) + optionCount) % optionCount);
            else if (mentioning) selectMention(active);
            else select(actions[active]);
            return;
          }
        }
        onKeyDown?.(event);
      }} onChange={value => {
        if (queueEdit) { queueEdit.onChange(value); return; }
        const hadText = Boolean(state.draft.trim());
        state.draft = value;
        setSelected(0); setDismissed(null);
        // The surrounding send/stop and queue controls only depend on emptiness.
        if (hadText !== Boolean(value.trim())) state.changed();
        else redraw();
      }} />
  </div>;
}

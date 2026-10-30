import './rich-composer.css';
import { appendChatText } from '../models/message-time';
import { useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type RefObject, type TextareaHTMLAttributes, type KeyboardEventHandler, type CompositionEventHandler } from 'react';
import { HighlightedCode } from './markdown';
import { detectStructuredText } from './structured-text';
import { MarkdownEditor, type ComposerHandle } from './markdown-editor';
import type { Extensions } from '@tiptap/core';
export type { ComposerHandle } from './markdown-editor';

type Format = 'auto' | 'markdown' | 'json' | 'plaintext';

export interface RichComposerProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'onKeyDown' | 'onCompositionStart' | 'onCompositionEnd'> {
  textareaRef: RefObject<ComposerHandle | null>;
  value: string;
  onChange: (value: string) => void;
  showFormatControls?: boolean;
  editorExtensions?: Extensions;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  onCompositionStart?: CompositionEventHandler<HTMLElement>;
  onCompositionEnd?: CompositionEventHandler<HTMLElement>;
}

/** Markdown is an editable document; JSON and explicit source mode retain exact source. */
export function RichComposer({ textareaRef, value, onChange, onKeyDown, onCompositionStart, onCompositionEnd, showFormatControls = false, editorExtensions, ...props }: RichComposerProps) {
  const [format, setFormat] = useState<Format>('auto');
  const [source, setSource] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const inferred = useMemo(() => detectStructuredText(value) || (/^\s*[\[{]/.test(value) && !/^\s*\[[^\n]*\]\(/.test(value) ? 'json' : 'markdown'), [value]);
  const language = format === 'auto' ? inferred : format;
  const rich = language === 'markdown' && !source;
  const change = (text: string) => {
    restoreFocus.current = Boolean(root.current?.contains(document.activeElement));
    onChange(text);
  };
  useLayoutEffect(() => {
    if (restoreFocus.current) textareaRef.current?.focus();
    restoreFocus.current = false;
  }, [rich]);
  return <div ref={root} className="rich-composer" data-code={language === 'json' || language === 'jsonl'}
    onKeyDownCapture={event => { if ((event.target as HTMLElement).closest('textarea, [contenteditable]')) onKeyDown?.(event); }} onCompositionStart={onCompositionStart} onCompositionEnd={onCompositionEnd}>
    {showFormatControls && <div className="composer-format">
      <select aria-label="输入格式" value={format} onChange={event => setFormat(event.target.value as Format)}>
        <option value="auto">Auto ({inferred === 'markdown' ? 'Markdown' : inferred.toUpperCase()})</option>
        <option value="markdown">Markdown</option>
        <option value="json">JSON</option>
        <option value="plaintext">纯文本</option>
      </select>
      {language === 'markdown' && <button type="button" aria-pressed={source} onClick={() => setSource(value => !value)}>{source ? '排版' : '源码'}</button>}
    </div>}
    {rich ? <MarkdownEditor inputRef={textareaRef} id={props.id} label={props['aria-label']} placeholder={props.placeholder}
      value={value} onChange={change} disabled={props.disabled} extensions={editorExtensions} suggestions={{ controls: props['aria-controls'], active: props['aria-activedescendant'], autocomplete: props['aria-autocomplete'] }} />
      : <SourceEditor {...props} inputRef={textareaRef} value={value} language={language} onChange={change} />}
  </div>;
}

function SourceEditor({ inputRef, value, language, onChange, ...props }: Omit<RichComposerProps, 'textareaRef'> & { inputRef: RefObject<ComposerHandle | null>; language: string }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(inputRef, () => ({
    focus: () => { const el = textareaRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } },
    appendText: text => onChange(appendChatText(textareaRef.current?.value || '', text)),
  }), [onChange]);
  const paint = useRef<HTMLPreElement>(null);
  const syncScroll = () => {
    if (paint.current && textareaRef.current) {
      paint.current.scrollTop = textareaRef.current.scrollTop;
      paint.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };
  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const max = (parseFloat(style.lineHeight) || 24) * (matchMedia('(max-width: 640px)').matches ? 4 : 6)
      + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
    syncScroll();
  };
  useLayoutEffect(resize, [value, language]);
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width !== el.clientWidth) { width = el.clientWidth; resize(); }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="composer-editor">
      <pre ref={paint} className="composer-highlight" aria-hidden="true"><code>{value.length > 50000 ? value : <HighlightedCode text={value} language={language === 'jsonl' ? 'json' : language} />}{'\n'}</code></pre>
      <textarea {...props} ref={textareaRef} value={value} onChange={event => onChange(event.target.value)} spellCheck={false} onScroll={event => { syncScroll(); props.onScroll?.(event); }} />
    </div>
  );
}

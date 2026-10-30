import { useRef, useState, type RefObject } from 'react';
import useEventListener from 'ahooks/es/useEventListener';
import useMemoizedFn from 'ahooks/es/useMemoizedFn';
import useUnmount from 'ahooks/es/useUnmount';
import type { ComposerHandle } from '../../shared/components/rich-composer';

type MessageSelection = { text: string; left: number; top: number };

export function useMessageSelection(messages: RefObject<HTMLDivElement | null>, composer: RefObject<ComposerHandle | null>, nativeTouch: boolean) {
  const [selection, setSelection] = useState<MessageSelection | null>(null);
  const focusFrame = useRef(0);
  useUnmount(() => cancelAnimationFrame(focusFrame.current));
  const addToChat = useMemoizedFn((text: string) => {
    composer.current?.appendText(text);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => composer.current?.focus());
  });
  useEventListener('selectionchange', () => {
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || !selected.anchorNode || !selected.focusNode || !selected.rangeCount || !selected.toString().trim()) {
      setSelection(null); return;
    }
    const anchor = selected.anchorNode instanceof Element ? selected.anchorNode : selected.anchorNode.parentElement;
    const el = anchor?.closest<HTMLElement>('.message[data-message-id]');
    if (!el || !messages.current?.contains(el) || !el.matches('.user,.being') || !el.contains(selected.focusNode)) {
      setSelection(null); return;
    }
    const text = selected.toString().trim(), rect = selected.getRangeAt(0).getBoundingClientRect();
    const next = {
      text: text.length > 2000 ? text.slice(0, 2000) + '\n[引用已截取]' : text,
      left: Math.max(8, Math.min(rect.left + rect.width / 2 - 100, innerWidth - 200)),
      top: Math.max(8, Math.min(rect.top >= 54 ? rect.top - 48 : rect.bottom + 8, innerHeight - 48)),
    };
    setSelection(previous => previous?.text === next.text && previous.left === next.left && previous.top === next.top ? previous : next);
  }, { target: document, enable: !nativeTouch });
  return { selection, setSelection, addToChat };
}

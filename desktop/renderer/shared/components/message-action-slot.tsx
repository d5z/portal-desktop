import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const MessageActionSlot = createContext<{
  actions: HTMLElement | null;
  menu: HTMLElement | null;
  registerExtraActions(): () => void;
} | null>(null);

export const MessageCaptionSlot = createContext<{
  mixedMedia: boolean;
  register(node: HTMLDivElement): () => void;
} | null>(null);

export function MessageCaptionAnchor() {
  const slot = useContext(MessageCaptionSlot);
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (node) return slot?.register(node);
  }, [slot]);
  return slot && <div className="message-caption-actions" ref={ref} />;
}

export function MessageAction({ children }: { children: ReactNode }) {
  const slot = useContext(MessageActionSlot);
  return slot ? slot.actions && createPortal(children, slot.actions) : children;
}

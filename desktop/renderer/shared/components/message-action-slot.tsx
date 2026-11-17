import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const MessageActionSlot = createContext<{
  actions: HTMLElement | null;
  menu: HTMLElement | null;
  registerExtraActions(): () => void;
} | null>(null);

export function MessageAction({ children }: { children: ReactNode }) {
  const slot = useContext(MessageActionSlot);
  return slot ? slot.actions && createPortal(children, slot.actions) : children;
}

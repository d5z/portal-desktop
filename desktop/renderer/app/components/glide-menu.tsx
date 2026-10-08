import { useEffect, useRef, useState, type ReactNode } from 'react';

// Adapted from docs/references/beautifului/glide-menu.json. One shared hover
// layer; keyboard focus and reduced motion are immediate, selection is separate.
export function GlideMenu({ children, disabled = false }: { children: ReactNode; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; height: number }>();
  const [visible, setVisible] = useState(false), [instant, setInstant] = useState(true);
  useEffect(() => {
    const hide = () => setVisible(false);
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, []);
  const moveTo = (target: EventTarget | null, keyboard: boolean) => {
    if (disabled || !(target instanceof Element) || !ref.current) return;
    const row = target.closest<HTMLElement>('.chat-session-row');
    if (!row || !ref.current.contains(row)) return;
    const container = ref.current.getBoundingClientRect(), rect = row.getBoundingClientRect();
    setBox({ top: rect.top - container.top, height: rect.height });
    setInstant(keyboard || !visible); setVisible(true);
  };
  return <div ref={ref} className="chat-session-glide" data-glide={visible && !disabled}
    onMouseMove={event => moveTo(event.target, false)} onMouseLeave={() => setVisible(false)}
    onFocusCapture={event => moveTo(event.target, true)} onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setVisible(false);
    }}>
    <span className="chat-session-glide-highlight" aria-hidden="true" data-instant={instant}
      style={{ top: box?.top ?? 0, height: box?.height ?? 0, opacity: visible && !disabled ? 1 : 0 }} />
    {children}
  </div>;
}

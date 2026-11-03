import { useLayoutEffect, useRef } from 'react';

/** Keep Town inert without putting settings in Chromium's top layer: plugin
 * previews and editors intentionally mount above this dialog in document.body. */
export function useManagerFocus(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useLayoutEffect(() => {
    if (!open) return;
    const dialog = document.getElementById('third-party-plugins')!;
    const active = document.activeElement as HTMLElement | null;
    // show() can focus a dialog child before this parent's layout effect runs.
    const previous = active && !dialog.contains(active)
      ? active : document.getElementById('options-trigger');
    const background = [...document.querySelectorAll<HTMLElement>('#client-main, #startup-screen')];
    const inert = background.map(element => element.inert);
    background.forEach(element => { element.inert = true; });
    const controls = () => [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, summary, a[href], [tabindex]')]
      .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
    const focus = requestAnimationFrame(() => controls()[0]?.focus());
    const keyboard = (event: KeyboardEvent) => {
      // A plugin's fullscreen preview/editor owns its own keyboard interaction.
      const bounds = dialog.getBoundingClientRect();
      const top = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      if (top && !dialog.contains(top)) return;
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault(); event.stopPropagation(); closeRef.current();
      }
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      const items = controls(), first = items[0], last = items.at(-1);
      if (!items.length) { event.preventDefault(); dialog.focus(); return; }
      if (!dialog.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => {
      cancelAnimationFrame(focus);
      document.removeEventListener('keydown', keyboard);
      background.forEach((element, index) => { element.inert = inert[index]; });
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus();
    };
  }, [open]);
}

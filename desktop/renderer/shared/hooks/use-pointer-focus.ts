import { useLayoutEffect } from 'react';

const navigationKeys = new Set(['Enter', ' ', 'Home', 'End', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function usePointerFocus(enabled = true) {
  useLayoutEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const markPointer = () => { root.setAttribute('data-pointer-focus', ''); };
    const clearPointer = () => { root.removeAttribute('data-pointer-focus'); };
    const markKeyboard = (event: KeyboardEvent) => {
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      const editing = event.target instanceof HTMLElement && (event.target.isContentEditable ||
        event.target.matches("textarea, input:not([type='checkbox'], [type='radio'], [type='range'])"));
      if (event.key === 'Tab' || (!editing && navigationKeys.has(event.key))) clearPointer();
    };

    document.addEventListener('pointerdown', markPointer, true);
    document.addEventListener('keydown', markKeyboard, true);
    // The shell and chat iframe receive their own input events. A Tab from
    // another document must be able to show a ring on the first focused control.
    window.addEventListener('blur', clearPointer);
    return () => {
      document.removeEventListener('pointerdown', markPointer, true);
      document.removeEventListener('keydown', markKeyboard, true);
      window.removeEventListener('blur', clearPointer);
      clearPointer();
    };
  }, [enabled]);
}

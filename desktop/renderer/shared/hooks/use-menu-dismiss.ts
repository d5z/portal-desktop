import type { RefObject } from 'react';
import useEventListener from 'ahooks/es/useEventListener';

const windowDismissEvents = ['resize', 'blur'];

/** Closed menus own no dismissal listeners. Callback changes do not rebind them. */
export function useMenuDismiss(open: boolean, menu: RefObject<HTMLElement | null>, close: () => void, onScroll: (event: Event) => void) {
  useEventListener('pointerdown', event => {
    if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) close();
  }, { target: document, capture: true, enable: open });
  useEventListener('scroll', onScroll, { target: document, capture: true, passive: true, enable: open });
  useEventListener(windowDismissEvents, () => close(), { enable: open });
}

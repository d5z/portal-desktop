import { useLayoutEffect, useRef } from 'react';
import styles from './toast.module.scss';

export function Toast({ message }: { message: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const toast = ref.current;
    if (!toast) return;
    if (message) {
      if (!toast.matches(':popover-open')) toast.showPopover();
    } else if (toast.matches(':popover-open')) toast.hidePopover();
  }, [message]);
  return <div ref={ref} id="toast" className={styles.root} popover="manual" role="status" aria-live="polite" aria-atomic="true">{message}</div>;
}

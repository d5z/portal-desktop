import { CopySuccessText } from './copy-feedback';
import { useLayoutEffect, useRef } from 'react';
import styles from './toast.module.scss';

export function Toast({ message, copied, tone }: { message: string; copied?: boolean; tone?: 'error' }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const toast = ref.current;
    if (!toast) return;
    if (message) {
      if (!toast.matches(':popover-open')) toast.showPopover();
    } else if (toast.matches(':popover-open')) toast.hidePopover();
  }, [message]);
  return <div ref={ref} id="toast" className={styles.root} popover="manual" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'} aria-atomic="true">{copied && message ? <CopySuccessText>{message}</CopySuccessText> : message}</div>;
}

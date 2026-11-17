import { Icon } from '../icons/icon';
import { CopyFeedbackIcon } from './copy-feedback';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import styles from './copy-message.module.scss';

export function CopyMessage({ text, copy, appearance = 'compact' }: {
  text: string;
  copy: (text: string) => Promise<void>;
  appearance?: 'compact' | 'chat';
}) {
  const [status, setStatus] = useState('复制正文');
  const chat = appearance === 'chat';
  const failed = status.startsWith('复制失败');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <button type="button" className={clsx(styles.button, chat && styles.chat)} aria-label={status}
    title={chat ? undefined : status}
    data-warm-tooltip={chat && status !== '已复制' ? status : undefined}
    data-copy-failed={chat && failed || undefined}
    onClick={async event => {
      event.stopPropagation();
      clearTimeout(timer.current);
      try { await copy(text); setStatus('已复制'); }
      catch { setStatus('复制失败，请重试'); }
      timer.current = setTimeout(() => setStatus('复制正文'), 2000);
    }}>
    <CopyFeedbackIcon copied={status === '已复制'}>
      <Icon name={status === '已复制' ? 'check-16' : chat ? (failed ? 'chat-retry' : 'chat-copy') : 'copy-16'}
        width="12" height="12" fill="none" stroke="currentColor" strokeWidth={chat ? 2 : 1.3} />
    </CopyFeedbackIcon>
    <span className={styles.status} role="status">{status === '复制正文' ? '' : status}</span>
  </button>;
}

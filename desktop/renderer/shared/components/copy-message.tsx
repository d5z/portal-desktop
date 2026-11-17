import { CopyFeedbackIcon } from './copy-feedback';
import { ChatActionTooltip } from './chat-action-tooltip';
import { Icon } from '../icons/icon';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import styles from './copy-message.module.scss';

export function CopyMessage({ text, copy, appearance = 'compact', label = '复制正文' }: {
  text: string;
  copy: (text: string) => Promise<void>;
  appearance?: 'compact' | 'chat';
  label?: string;
}) {
  const [status, setStatus] = useState('');
  const failed = status.startsWith('复制失败');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const button = <button type="button" className={clsx(styles.button, appearance === 'chat' && styles.chat)} data-copy-failed={failed || undefined} aria-label={status || label}
    title={appearance === 'chat' ? undefined : status || label}
    onClick={async event => {
      event.stopPropagation();
      clearTimeout(timer.current);
      try { await copy(text); setStatus('已复制'); }
      catch { setStatus('复制失败，请重试'); }
      timer.current = setTimeout(() => setStatus(''), 2000);
    }}>
    <CopyFeedbackIcon copied={status === '已复制'}>
      <Icon name={appearance === 'chat' ? (failed ? 'chat-retry' : status === '已复制' ? 'chat-check' : 'chat-copy') : (failed ? 'refresh' : status === '已复制' ? 'check-16' : 'copy-16')} width="12" height="12" fill="none" stroke="currentColor" strokeWidth={appearance === 'chat' ? 2 : 1.3} />
    </CopyFeedbackIcon>
    <span className={styles.status} role="status">{status}</span>
  </button>;
  return appearance === 'chat' ? <ChatActionTooltip content={status || label} disabled={status === '已复制'}>{button}</ChatActionTooltip> : button;
}

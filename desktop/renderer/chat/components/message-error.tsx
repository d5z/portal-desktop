import { useId, useRef, type CSSProperties } from 'react';
import { Icon } from '../../shared/icons/icon';

export function MessageError({ reason, retry, retryLabel = '重试', onRemove }: {
  reason?: string;
  retry: () => void;
  retryLabel?: string;
  onRemove?: () => void;
}) {
  const id = useId();
  const tip = useRef<HTMLSpanElement>(null);
  const anchor = `--message-error-${id.replace(/[^\w-]/g, '')}`;
  const show = () => { if (tip.current && !tip.current.matches(':popover-open')) tip.current.showPopover(); };

  return <div className="message-feedback" style={{ '--message-error-anchor': anchor } as CSSProperties}>
    {reason && <>
      <span className="message-feedback-announcement" role="alert">{reason}</span>
      <button type="button" className="message-feedback-reason" aria-label="查看错误原因" aria-describedby={id}
        popoverTarget={id} onPointerEnter={event => { if (event.pointerType === 'mouse') show(); }}
        onPointerLeave={event => { if (event.pointerType === 'mouse' && !event.currentTarget.matches(':focus-visible')) tip.current?.hidePopover(); }}
        onFocus={event => { if (event.currentTarget.matches(':focus-visible')) show(); }} onBlur={() => tip.current?.hidePopover()}>
        <Icon name="activity-error" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </button>
      <span ref={tip} id={id} className="message-feedback-tooltip" role="tooltip" popover="auto">{reason}</span>
    </>}
    <button type="button" aria-label={retryLabel} title={retryLabel} onClick={retry}>
      <Icon name="refresh-20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </button>
    {onRemove && <button type="button" aria-label="移除失败附件" onClick={onRemove}>移除</button>}
  </div>;
}

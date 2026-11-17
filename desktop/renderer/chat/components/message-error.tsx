import { useEffect, useId, useRef, type CSSProperties } from 'react';
import { Icon } from '../../shared/icons/icon';

export function MessageError({ reason, retry, retryLabel = '重试', disabled }: {
  reason?: string;
  retry?: () => void;
  retryLabel?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const tip = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keepOpen = () => clearTimeout(closeTimer.current);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const anchor = `--message-error-${id.replace(/[^\w-]/g, '')}`;
  function show() {
    keepOpen();
    const popover = tip.current;
    if (!popover || popover.matches(':popover-open')) return;
    popover.showPopover();
    popover.toggleAttribute('data-below', trigger.current!.getBoundingClientRect().top < popover.offsetHeight + 14);
  }
  function hide() {
    keepOpen();
    tip.current?.hidePopover();
  }
  function hideAfterPointerLeave() {
    keepOpen();
    closeTimer.current = setTimeout(hide, 80);
  }

  return <div className="message-feedback" style={{ '--message-error-anchor': anchor } as CSSProperties}>
    {reason && <>
      <span className="message-feedback-announcement" role="alert">{reason}</span>
      <button ref={trigger} type="button" className="message-feedback-reason" aria-label="查看错误原因" aria-describedby={id}
        onPointerEnter={event => { if (event.pointerType !== 'touch') show(); }}
        onPointerLeave={event => {
          if (event.pointerType !== 'touch' && event.relatedTarget !== tip.current && !event.currentTarget.matches(':focus-visible')) hideAfterPointerLeave();
        }}
        onFocus={event => { if (event.currentTarget.matches(':focus-visible')) show(); }} onBlur={hide}
        onClick={event => {
          if (event.nativeEvent instanceof PointerEvent && event.nativeEvent.pointerType === 'touch' && tip.current?.matches(':popover-open')) hide();
          else show();
        }}>
        <Icon name="chat-error" width="16" height="16" />
      </button>
      <span ref={tip} id={id} className="message-feedback-tooltip" role="tooltip" popover="auto" onPointerEnter={keepOpen} onPointerLeave={event => {
        if (event.pointerType !== 'touch' && event.relatedTarget !== trigger.current && !trigger.current?.matches(':focus-visible')) hideAfterPointerLeave();
      }}>{reason}</span>
    </>}
    {retry && <button type="button" aria-label={retryLabel} title={retryLabel} disabled={disabled} onClick={retry}>
      <Icon name="chat-retry" width="16" height="16" />
    </button>}
  </div>;
}

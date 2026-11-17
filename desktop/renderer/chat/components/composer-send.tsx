import { AnimatePresence } from 'motion/react';
import { DropdownMenuMotion } from '../../shared/components/animate-ui/dropdown-menu-motion';
import { useEffect, useId, useRef, useState } from 'react';
import { ChatActionTooltip } from '../../shared/components/chat-action-tooltip';
import { Icon } from '../../shared/icons/icon';

export function ComposerSend({ label, action, stopping, disabled, alternate, mobileWeb, onSubmit }: {
  label: string;
  action: 'send' | 'stop' | 'steer' | 'queue';
  stopping: boolean;
  disabled: boolean;
  mobileWeb: boolean;
  alternate?: { label: string; shortcut: string; key: string; run(): void };
  onSubmit(): void;
}) {
  const [openedBy, setOpenedBy] = useState<'mouse' | 'keyboard' | 'touch'>();
  const surface = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pointerType = useRef('');
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const popupId = useId();
  const hasChoices = !!alternate && !disabled;
  const visible = hasChoices && !!openedBy;
  const submitIcon = mobileWeb ? 'chat-arrow-up' : 'chat-send';
  const stopIcon = mobileWeb ? 'chat-composer-stop' : 'chat-composer-stop-compact';
  if (!hasChoices && openedBy) setOpenedBy(undefined);
  useEffect(() => {
    if (hasChoices && matchMedia('(hover: hover)').matches && trigger.current?.matches(':hover')) {
      setOpenedBy('mouse');
    }
  }, [hasChoices]);
  useEffect(() => {
    if (!visible) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !surface.current?.contains(event.target)) setOpenedBy(undefined);
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.target !== trigger.current && event.target instanceof Node && surface.current?.contains(event.target)) {
        trigger.current?.focus({ preventScroll: true });
      }
      setOpenedBy(undefined);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', dismiss, true);
    return () => {
      clearTimeout(closeTimer.current);
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', dismiss, true);
    };
  }, [visible]);

  function act(action: () => void) {
    setOpenedBy(undefined);
    action();
  }

  return <div className="composer-submit" ref={surface}
    onPointerEnter={() => clearTimeout(closeTimer.current)}
    onPointerLeave={event => {
      if (event.pointerType !== 'mouse') return;
      const focused = event.currentTarget.ownerDocument.activeElement;
      if (openedBy === 'mouse' && !(event.currentTarget.contains(focused) && focused?.matches(':focus-visible'))) {
        closeTimer.current = setTimeout(() => setOpenedBy(undefined), 180);
      }
    }}
    onFocus={() => clearTimeout(closeTimer.current)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpenedBy(undefined); }}>
    <ChatActionTooltip content={label} shortcut={!disabled && action !== 'stop' ? '↵' : undefined} disabled={hasChoices || stopping}>
      <button ref={trigger} className={`btn-icon${action === 'stop' ? ' stop' : ''}`} id="send-btn" type="button"
        data-action={action}
        aria-label={label} aria-busy={stopping} disabled={disabled}
        aria-expanded={hasChoices ? visible : undefined}
        aria-controls={visible ? popupId : undefined}
        onPointerEnter={event => {
          if (hasChoices && event.pointerType === 'mouse') setOpenedBy(current => current ?? 'mouse');
        }}
        onPointerDown={event => { pointerType.current = event.pointerType; }}
        onPointerCancel={() => { pointerType.current = ''; }}
        onFocus={event => {
          if (hasChoices && event.currentTarget.matches(':focus-visible')) setOpenedBy('keyboard');
        }}
        onKeyDown={event => {
          pointerType.current = '';
          if (hasChoices && event.key === 'ArrowUp') {
            event.preventDefault();
            setOpenedBy('keyboard');
          }
        }}
        onClick={() => {
          const wasTouch = pointerType.current === 'touch';
          pointerType.current = '';
          if (wasTouch && hasChoices) setOpenedBy('touch');
          else act(onSubmit);
        }}>
        <Icon name={stopping ? 'chat-busy' : action === 'stop' ? stopIcon : submitIcon} />
      </button>
    </ChatActionTooltip>
    <AnimatePresence>{visible && alternate && <DropdownMenuMotion className="composer-queue-tip" id={popupId} role="group" aria-label="发送选项">
      <div className="composer-queue-tip-surface">
        <button type="button" aria-label={label} aria-keyshortcuts="Enter"
          onClick={() => act(onSubmit)}>{label}<kbd aria-hidden="true">↵</kbd></button>
        <button type="button" aria-label={alternate.label} aria-keyshortcuts={alternate.key}
          onClick={() => act(alternate.run)}>
          {alternate.label}<kbd aria-hidden="true">{alternate.shortcut}</kbd>
        </button>
      </div>
    </DropdownMenuMotion>}</AnimatePresence>
  </div>;
}

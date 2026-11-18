import { Children, useCallback, useContext, useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Icon } from '../icons/icon';
import Stack from './react-bits-stack/Stack';
import { MessageAction, MessageActionSlot } from './message-action-slot';

export function MessageImageGroup({ count, className, children, initiallyExpanded = false }: {
  count: number;
  className: string;
  children: ReactNode;
  initiallyExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [firstIndex, setFirstIndex] = useState(0);
  const imagesId = useId();
  const topIndex = useRef(0);
  const deck = useRef<HTMLDivElement>(null);
  const press = useRef<{ id: number; x: number; y: number; moved: boolean }>(null);
  const bindDeck = useCallback((node: HTMLDivElement | null) => {
    deck.current = node;
    node?.firstElementChild?.setAttribute('aria-label', '图片堆叠，方向键翻看');
    // Stack keeps rear cards mounted for motion. Nested preview buttons still need to leave the tab order.
    node?.querySelectorAll<HTMLElement>('.stack-card').forEach(card => { card.inert = !card.hasAttribute('data-top'); });
  }, []);
  const desktop = typeof document !== 'undefined' && document.documentElement.dataset.chatHost === 'desktop';
  useEffect(() => {
    if (!desktop || expanded) return;
    const stack = deck.current?.querySelector<HTMLElement>('.stack');
    if (!stack) return;
    const verticalWheel = navigator.platform.startsWith('Win');
    let lastWheel = -Infinity;
    let distance = 0;
    let advanced = false;
    const wheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey) return;
      const { deltaMode, deltaX, deltaY } = event;
      const horizontal = Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
      if (!horizontal && !(verticalWheel && Math.abs(deltaY) > Math.abs(deltaX) * 1.2)) return;
      const delta = horizontal ? deltaX : deltaY;
      event.preventDefault();
      event.stopPropagation();
      // Inertial events belong to the same gesture even after the card moves.
      if (event.timeStamp - lastWheel > 220) {
        distance = 0;
        advanced = false;
      }
      lastWheel = event.timeStamp;
      if (advanced) return;
      distance = Math.sign(distance) === Math.sign(delta) ? distance + delta : delta;
      if (Math.abs(distance) < (deltaMode === WheelEvent.DOM_DELTA_PIXEL ? 48 : 1)) return;
      advanced = true;
      // Use the vendor stack's existing keyboard action and card animation.
      stack.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    };
    stack.addEventListener('wheel', wheel, { passive: false });
    return () => stack.removeEventListener('wheel', wheel);
  }, [desktop, expanded]);
  const compact = !!useContext(MessageActionSlot) || desktop;
  const toggleLabel = expanded ? '收起图片' : `展开 ${count} 张图片`;
  const cards = Children.toArray(children);
  const trackPress = (event: PointerEvent) => {
    const start = press.current;
    if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= (event.pointerType === 'touch' ? 6 : 3)) {
      start.moved = true;
    }
  };
  return <div className={`message-image-group ${className}`} role="group" aria-label={`${count} 张图片`}
    data-count={count} data-expanded={expanded}>
    <MessageAction><button type="button" className="message-image-toggle" aria-controls={imagesId}
      aria-label={toggleLabel} title={compact ? toggleLabel : undefined}
      aria-expanded={expanded} onClick={() => {
        if (expanded) setFirstIndex(topIndex.current);
        setExpanded(!expanded);
      }}>
      {compact ? <Icon name="chat-chevron-down" width="14" height="14" /> : <>
        <Icon name="image-rounded" width="16" height="16" />
        <span>{toggleLabel}</span>
        <Icon name="chevron-down-20" width="16" height="16" />
      </>}
    </button></MessageAction>
    {desktop && !expanded
      ? <div ref={bindDeck} id={imagesId} className="message-image-deck"
        onPointerDownCapture={event => { if (event.isPrimary && event.button === 0) press.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }; }}
        onPointerMoveCapture={trackPress} onPointerUpCapture={trackPress}
        onClickCapture={event => {
          if (event.detail > 0 && press.current?.moved) {
            event.preventDefault(); event.stopPropagation();
          }
          press.current = null;
        }}>
        <Stack cards={[...cards.slice(firstIndex), ...cards.slice(0, firstIndex)]} shadow={false}
          onChange={index => {
            topIndex.current = (firstIndex + index) % cards.length;
            bindDeck(deck.current);
          }} />
      </div>
      : <div id={imagesId} className="message-image-stack" inert={!expanded} aria-hidden={!expanded || undefined}>{children}</div>}
  </div>;
}

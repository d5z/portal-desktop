import { Children, useCallback, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Icon } from '../icons/icon';
import Stack from './react-bits-stack/Stack';

export function MessageImageGroup({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [firstIndex, setFirstIndex] = useState(0);
  const imagesId = useId();
  const topIndex = useRef(0);
  const deck = useRef<HTMLDivElement>(null);
  const press = useRef<{ id: number; x: number; y: number; moved: boolean }>(null);
  const bindDeck = useCallback((node: HTMLDivElement | null) => {
    deck.current = node;
    node?.firstElementChild?.setAttribute('aria-label', '图片堆叠，方向键翻看');
    // Keep the rear cards out of the tab order while the deck animates.
    node?.querySelectorAll<HTMLElement>('[data-stack-card]').forEach(card => { card.inert = !card.hasAttribute('data-top'); });
  }, []);
  const cards = Children.toArray(children);
  const toggleLabel = expanded ? '收起图片' : `展开 ${cards.length} 张图片`;
  const trackPress = (event: PointerEvent) => {
    const start = press.current;
    if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= (event.pointerType === 'touch' ? 6 : 3)) {
      start.moved = true;
    }
  };
  return <div className="message-image-group" role="group" aria-label={`${cards.length} 张图片`}>
    {expanded ? <div id={imagesId} className="message-image-stack">{children}</div> :
      <div ref={bindDeck} id={imagesId} className="message-image-deck"
        onPointerDownCapture={event => { if (event.isPrimary && event.button === 0) press.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }; }}
        onPointerMoveCapture={trackPress} onPointerUpCapture={trackPress}
        onClickCapture={event => {
          if (event.detail > 0 && press.current?.moved) { event.preventDefault(); event.stopPropagation(); }
          press.current = null;
        }}>
        <Stack cards={[...cards.slice(firstIndex), ...cards.slice(0, firstIndex)]} shadow={false}
          onChange={index => {
            topIndex.current = (firstIndex + index) % cards.length;
            bindDeck(deck.current);
          }} />
      </div>}
    <button type="button" className="message-image-toggle" aria-controls={imagesId}
      aria-label={toggleLabel} title={toggleLabel} aria-expanded={expanded} onClick={() => {
        if (!expanded) setFirstIndex(topIndex.current);
        setExpanded(!expanded);
      }}>
      <Icon name={expanded ? 'chevron-down-12' : 'disclosure-down'} width="16" height="16" fill="none" stroke="currentColor"
        strokeWidth="1.6" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
    </button>
  </div>;
}

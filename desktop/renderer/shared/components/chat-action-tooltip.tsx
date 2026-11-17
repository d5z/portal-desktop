import { cloneElement, useEffect, useRef, type PointerEventHandler, type ReactNode, type RefObject } from 'react';
import { useReducedMotion } from 'motion/react';
import WarmTooltip, { WarmTooltipGroup, type WarmTooltipGroupHandle, type WarmTooltipProps } from './react-bits/WarmTooltip';

import { WarmTooltipAnchors } from './warm-tooltip-anchors';

const surfaceColor = 'var(--chat-menu-surface)';
const inkColor = 'var(--chat-ink)';

const anchorAppearance = {
  side: 'top' as const, gap: 6, radius: 8, font: 12.5, px: 10, py: 6, surfaceColor, inkColor,
};

export function ChatTooltipGroup({ children, anchorRoot }: {
  children: ReactNode;
  anchorRoot?: RefObject<HTMLElement | null>;
}) {
  const group = useRef<WarmTooltipGroupHandle>(null);
  useEffect(() => {
    if (anchorRoot) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') group.current?.reset(); };
    document.addEventListener('keydown', close, true);
    return () => document.removeEventListener('keydown', close, true);
  }, [anchorRoot]);
  return <WarmTooltipGroup ref={group} delay={300} warmWindow={350} travel={0}>
    {children}
    {anchorRoot && <WarmTooltipAnchors rootRef={anchorRoot} appearance={anchorAppearance} />}
  </WarmTooltipGroup>;
}

export function ChatActionTooltip({ content, shortcut, children, disabled, className }: Pick<WarmTooltipProps,
  'content' | 'shortcut' | 'children' | 'disabled' | 'className'>) {
  const reduce = useReducedMotion();
  const original = children.props.onPointerDown as PointerEventHandler<HTMLElement> | undefined;
  return <WarmTooltip content={content} shortcut={shortcut} disabled={disabled} className={className}
    gap={6} arrow={false} popDuration={reduce ? 0 : 120} popBlur={0} popScale={1}
    surfaceColor={surfaceColor} inkColor={inkColor}>
    {cloneElement(children, { onPointerDown: ((event) => {
      original?.(event);
      // Keep the initial touch/pen press on the action instead of letting the tooltip capture it.
      if (event.pointerType !== 'mouse') event.stopPropagation();
    }) satisfies PointerEventHandler<HTMLElement> })}
  </WarmTooltip>;
}

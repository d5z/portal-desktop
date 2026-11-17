import type { ReactNode, RefObject } from 'react';
import { WarmTooltipGroup } from './react-bits/WarmTooltip';
import { WarmTooltipAnchors } from './warm-tooltip-anchors';

const appearance = {
  side: 'top' as const, gap: 6, radius: 8, font: 12.5, px: 10, py: 6,
  surfaceColor: 'var(--bg)', inkColor: 'var(--text)',
};

export function ChatTooltipGroup({ children, anchorRoot }: {
  children: ReactNode;
  anchorRoot: RefObject<HTMLElement | null>;
}) {
  return <WarmTooltipGroup delay={300} warmWindow={350} travel={0}>
    {children}
    <WarmTooltipAnchors rootRef={anchorRoot} appearance={appearance} />
  </WarmTooltipGroup>;
}

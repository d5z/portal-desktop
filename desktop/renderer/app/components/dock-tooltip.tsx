import type { ReactNode, RefObject } from 'react';
import { WarmTooltipGroup } from '../../shared/components/react-bits/WarmTooltip';
import { WarmTooltipAnchors, shellTooltipAppearance } from '../../shared/components/warm-tooltip-anchors';

const triggerSelector = '[data-rail-tooltip], .dsh-rail-entries :is(button, a[href], [role="button"])';

export function DockTooltipGroup({ rail, children }: { rail: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  return <WarmTooltipGroup delay={300} warmWindow={350} travel={0} tooltipClassName="rail-tooltip">
    {children}
    <WarmTooltipAnchors rootRef={rail} appearance={shellTooltipAppearance} selector={triggerSelector} />
  </WarmTooltipGroup>;
}

import { useLayoutEffect, type ReactNode, type RefObject } from 'react';
import { DropdownMenuMotion } from '../../shared/components/animate-ui/dropdown-menu-motion';

export function DockMorePanel({ panel, children }: {
  panel: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    const anchor = document.getElementById('rail-more-trigger');
    const surface = panel.current;
    if (!surface) return;
    if (!anchor) return;
    const positionOrigin = () => {
      const { top, height } = anchor.getBoundingClientRect();
      // Use the panel's layout position even while its visual bounds are moving.
      const y = Math.max(0, Math.min(surface.offsetHeight, top + height / 2 - surface.offsetTop));
      surface.style.transformOrigin = `left ${y}px`;
    };
    positionOrigin();
    window.addEventListener('resize', positionOrigin);
    return () => window.removeEventListener('resize', positionOrigin);
  }, [panel]);

  return <DropdownMenuMotion ref={panel} className="rail-more-panel" role="dialog" aria-label="更多功能">
    {children}
  </DropdownMenuMotion>;
}

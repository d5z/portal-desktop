import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { motion, useIsPresent, useReducedMotion, type Transition } from 'motion/react';

// Animate UI Collapsible content and disclosure-panel motion.
// https://github.com/imskyleen/animate-ui/blob/9873c628afdcdb030e74dc2930774a2aa473bd39/packages/react/src/primitives/radix-ui/collapsible/collapsible.tsx#L61-L108
// https://github.com/imskyleen/animate-ui/blob/9873c628afdcdb030e74dc2930774a2aa473bd39/packages/react/src/internal/disclosure-panel.tsx#L13-L84
const collapsed = { height: 0, opacity: 0, filter: 'blur(2px)' };
const expanded = { height: 'auto', opacity: 1, filter: 'blur(0px)', transitionEnd: { filter: 'none' } };
const DISCLOSURE_TRANSITION = { duration: 0.35, ease: [0.215, 0.61, 0.355, 1] } satisfies Transition;
const CONTENT_VAR = '--animate-ui-panel-content';
const EDGE_MASK = `linear-gradient(to bottom, black max(100% - 16px, 200% - var(${CONTENT_VAR}, 100%)), transparent)`;

export function CollapsibleMotion({ children, className }: { children: ReactNode; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const present = useIsPresent();
  const reduce = useReducedMotion();
  const transition = reduce ? { ...DISCLOSURE_TRANSITION, height: { duration: 0 } } : DISCLOSURE_TRANSITION;
  useLayoutEffect(() => {
    const focused = ref.current?.ownerDocument.activeElement;
    if (!present && focused instanceof HTMLElement && ref.current?.contains(focused)) focused.blur();
  }, [present]);

  return <motion.div ref={ref} className={className} inert={!present} aria-hidden={!present || undefined}
    initial={collapsed}
    animate={{ ...expanded, transition }}
    exit={{ ...collapsed, transition }}
    style={{ overflow: 'hidden', maskImage: EDGE_MASK }}
    onAnimationStart={() => {
      const panel = ref.current;
      if (panel) panel.style.setProperty(CONTENT_VAR, `${panel.scrollHeight}px`);
    }}
    onAnimationComplete={() => {
      if (present) ref.current?.style.removeProperty(CONTENT_VAR);
    }}>
    {children}
  </motion.div>;
}

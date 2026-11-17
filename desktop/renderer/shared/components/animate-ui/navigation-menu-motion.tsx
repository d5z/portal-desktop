import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useReducedMotion, type Transition, type Variants } from 'motion/react';
import styles from './navigation-menu-motion.module.scss';

// Animate UI Navigation Menu's content swap and viewport morph. The existing
// click/back handlers supply the direction, and the menu width is fixed by Being.
// https://github.com/imskyleen/animate-ui/blob/9873c628afdcdb030e74dc2930774a2aa473bd39/packages/react/src/internal/content-swap.ts#L618-L721
// https://github.com/imskyleen/animate-ui/blob/9873c628afdcdb030e74dc2930774a2aa473bd39/packages/react/src/primitives/radix-ui/navigation-menu/navigation-menu.tsx#L539-L637
// https://github.com/imskyleen/animate-ui/blob/9873c628afdcdb030e74dc2930774a2aa473bd39/packages/react/src/utils/motion/index.tsx#L14-L126
const navigation = 24;
const handoffOut = { duration: 0.22, ease: [0.215, 0.61, 0.355, 1] } satisfies Transition;
const handoffIn = { duration: 0.26, ease: [0.11, 0, 0.5, 0] } satisfies Transition;
const handoff = { type: 'spring', stiffness: 450, damping: 43 } satisfies Transition;
const morph = { type: 'spring', stiffness: 660, damping: 52 } satisfies Transition;

const contentSwap = {
  enter: (shift: number) => ({ x: shift, opacity: 0 }),
  rest: { x: 0, opacity: 1, transition: { x: handoff, opacity: handoffIn } },
  leave: (shift: number) => ({ x: -shift, opacity: 0, transition: handoffOut }),
} satisfies Variants;

function NavigationMenuContent({ children, shift }: { children: ReactNode; shift: number }) {
  const present = useIsPresent();
  return <motion.div data-navigation-menu-content inert={!present} aria-hidden={!present || undefined}
    variants={contentSwap} custom={shift} initial="enter" animate="rest" exit="leave">
    {children}
  </motion.div>;
}

export function NavigationMenuMotion({ page, forward, className, children }: {
  page: string; forward: boolean; className: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const height = useMotionValue<number | 'auto'>('auto');
  const shift = reduce ? 0 : forward ? navigation : -navigation;

  useLayoutEffect(() => {
    const viewport = ref.current!;
    const content = viewport.querySelector<HTMLElement>(':scope > [data-navigation-menu-content]:not([inert])')!;
    let target: number | undefined;
    const measure = () => {
      // A native popover can mount its viewport while it is still hidden.
      if (!content.getClientRects().length) return;
      const next = content.offsetHeight;
      if (target === next) return;
      target = next;
      if (height.get() === 'auto' || reduce) height.jump(next);
      else animate(height, next, { ...morph, velocity: 0 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [height, page, reduce]);

  return <motion.div ref={ref} className={`${styles.viewport} ${className}`} style={{ height }}>
    <AnimatePresence initial={false} custom={shift}>
      <NavigationMenuContent key={page} shift={shift}>{children}</NavigationMenuContent>
    </AnimatePresence>
  </motion.div>;
}

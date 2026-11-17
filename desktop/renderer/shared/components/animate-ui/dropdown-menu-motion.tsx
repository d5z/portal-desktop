import { useLayoutEffect, useRef, type RefObject, type ToggleEvent } from 'react';
import { animate, motion, useIsPresent, useReducedMotion, type AnimationPlaybackControls, type HTMLMotionProps, type Transition } from 'motion/react';

// Animate UI v2 Dropdown and Context Menu surfaces share ContentMotion.
// https://github.com/imskyleen/animate-ui/blob/9873c628afdcdb030e74dc2930774a2aa473bd39/packages/react/src/primitives/radix-ui/dropdown-menu/dropdown-menu.tsx#L47-L66
// https://github.com/imskyleen/animate-ui/blob/9873c628afdcdb030e74dc2930774a2aa473bd39/packages/react/src/primitives/radix-ui/context-menu/context-menu.tsx#L44-L47
// https://github.com/imskyleen/animate-ui/blob/9873c628afdcdb030e74dc2930774a2aa473bd39/packages/react/src/primitives/radix-ui/_menu/menu.tsx#L215-L355
// https://github.com/imskyleen/animate-ui/blob/9873c628afdcdb030e74dc2930774a2aa473bd39/packages/react/src/utils/motion/index.tsx#L14-L109
const MENU_TRANSITION = { duration: 0.22, ease: [0.215, 0.61, 0.355, 1] } satisfies Transition;
const HIDDEN_SCALE = { menu: 0.9 } as const;

export function DropdownMenuMotion({ children, ref: suppliedRef, ...props }:
  HTMLMotionProps<'div'> & { ref?: RefObject<HTMLDivElement | null> }) {
  const fallbackRef = useRef<HTMLDivElement>(null);
  const ref = suppliedRef ?? fallbackRef;
  const present = useIsPresent();
  const reduce = useReducedMotion();
  const hidden = { opacity: 0, scale: reduce ? 1 : HIDDEN_SCALE.menu };

  useLayoutEffect(() => {
    const focused = ref.current?.ownerDocument.activeElement;
    if (!present && focused instanceof HTMLElement && ref.current?.contains(focused)) focused.blur();
  }, [present, ref]);

  return <motion.div {...props} ref={ref} inert={!present} aria-hidden={!present || undefined}
    initial={hidden} animate={{ opacity: 1, scale: 1, transition: MENU_TRANSITION }}
    exit={{ ...hidden, transition: MENU_TRANSITION }}>
    {children}
  </motion.div>;
}


// Native popovers already manage opening, dismissal and placement. Apply the
// same ContentMotion keyframes while Chromium retains the exiting top layer.
const popoverAnimations = new WeakMap<HTMLDivElement, AnimationPlaybackControls>();

export const dropdownMenuPopover = {
  'data-menu-popover-motion': '',
  onBeforeToggle(event: ToggleEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const node = event.currentTarget;
    const opening = event.newState === 'open';
    node.inert = !opening;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hidden = { opacity: 0, scale: reduced ? 1 : HIDDEN_SCALE.menu };
    const previous = popoverAnimations.get(node);
    const start = opening && previous?.state !== 'running' ? hidden : null;
    const target = opening ? { opacity: 1, scale: 1 } : hidden;
    previous?.stop();
    popoverAnimations.set(node, animate(node, {
      opacity: [start?.opacity ?? null, target.opacity],
      scale: [reduced ? 1 : start?.scale ?? null, target.scale],
    }, MENU_TRANSITION));
  },
};

export function hideMenuPopover(node: HTMLDivElement | null) {
  if (!node?.matches(':popover-open')) return;
  node.hidePopover();
  return node.getAnimations().find(animation => animation instanceof CSSTransition && animation.transitionProperty === 'display');
}

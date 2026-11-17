import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

// Animate UI Copy Button, Copyright (c) 2025 Elliot Sutton. MIT + Commons Clause.
// https://github.com/imskyleen/animate-ui/blob/9873c628afdcdb030e74dc2930774a2aa473bd39/apps/v1/apps/www/registry/components/buttons/copy/index.tsx
const copyFeedbackMotion = {
  initial: { scale: 0, opacity: 0.4, filter: 'blur(4px)' },
  animate: { scale: 1, opacity: 1, filter: 'blur(0px)' },
  exit: { scale: 0, opacity: 0.4, filter: 'blur(4px)' },
  transition: { duration: 0.25 },
};

export function CopyFeedbackIcon({ copied, children }: { copied: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  if (reduce) return children;
  return <AnimatePresence initial={false} mode="popLayout">
    <motion.span key={copied ? 'check' : 'copy'} aria-hidden="true" style={{ display: 'inline-flex' }} {...copyFeedbackMotion}>
      {children}
    </motion.span>
  </AnimatePresence>;
}

export function CopySuccessText({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return reduce ? children : <motion.span style={{ display: 'inline-block' }} {...copyFeedbackMotion}>{children}</motion.span>;
}

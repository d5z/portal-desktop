import { useState, type ComponentPropsWithRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { CollapsibleMotion } from './animate-ui/collapsible-motion';
import { DropdownMenuMotion } from './animate-ui/dropdown-menu-motion';
import styles from './small-menu-details.module.scss';

export function SmallMenuDetails({ children, className = '', summary, summaryProps, surfaceClassName, surfaceLabel, inline = false, ...props }:
  ComponentPropsWithRef<'details'> & {
    summary: ReactNode;
    summaryProps?: ComponentPropsWithoutRef<'summary'>;
    surfaceClassName: string;
    surfaceLabel?: string;
    inline?: boolean;
  }) {
  const [open, setOpen] = useState(Boolean(props.open));
  return <details {...props} className={className + ' ' + styles.details} onToggle={event => {
    if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
    props.onToggle?.(event);
  }}>
    <summary {...summaryProps}>{summary}</summary>
    <AnimatePresence initial={false}>
      {open && (inline
        ? <CollapsibleMotion className={styles.surface}><div className={surfaceClassName}>{children}</div></CollapsibleMotion>
        : <DropdownMenuMotion aria-label={surfaceLabel} className={surfaceClassName + ' ' + styles.surface}>
            {children}
          </DropdownMenuMotion>)}
    </AnimatePresence>
  </details>;
}

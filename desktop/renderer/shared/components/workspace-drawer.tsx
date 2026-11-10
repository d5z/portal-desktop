import {
  createContext,
  useContext,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type RefObject,
} from 'react';
import './workspace-drawer.scss';

const DrawerContext = createContext<{ open: boolean; onExited?: () => void }>({ open: true });
const duration = 340;

/** Retain one root drawer and its contents until the actual exit completes. */
export function DrawerPresence({
  open: requestedOpen,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const inherited = useContext(DrawerContext);
  const open = requestedOpen && inherited.open;
  const [retained, setRetained] = useState(open);
  const onExited = useCallback(() => setRetained(false), []);
  const context = useMemo(() => ({ open, onExited }), [open, onExited]);
  const last = useRef(children);
  useLayoutEffect(() => {
    if (open) {
      last.current = children;
      setRetained(true);
    }
  }, [open, children]);
  return (
    <DrawerContext.Provider value={context}>
      {open ? children : retained ? last.current : null}
    </DrawerContext.Provider>
  );
}

type DrawerRecord = {
  node: HTMLElement;
  open: boolean;
  size: number;
  gap: number;
  vertical: boolean;
  motion?: Animation;
  finish: () => void;
  fluid: boolean;
  edge: 'left' | 'right';
};
const drawers = new Set<DrawerRecord>();
const pending = new Set<DrawerRecord>();
// Measure all destination widths before starting any animation. Sibling drawers
// then trade the same space on the same clock, instead of jumping independently.
function schedule(record: DrawerRecord) {
  const queued = pending.size > 0;
  pending.add(record);
  if (queued) return;
  queueMicrotask(() => {
    if (!pending.size) return;
    const changed = new Set(pending);
    const changedParents = new Set([...pending].map((item) => item.node.parentElement));
    for (const item of drawers) {
      if (changedParents.has(item.node.parentElement) && (item.size > 0 || item.open))
        pending.add(item);
    }
    const moving = [...pending];
    pending.clear();
    const starts = moving.map((item) => {
      const css = getComputedStyle(item.node),
        animated = Boolean(item.motion);
      const size =
        item.motion && item.node.dataset.drawerMotion !== 'overlay'
          ? parseFloat(css.getPropertyValue('--drawer-size'))
          : item.size;
      const gap =
        item.motion && item.node.dataset.drawerMotion !== 'overlay'
          ? parseFloat(css.getPropertyValue('--drawer-gap'))
          : item.gap;
      const transform = item.motion ? css.transform : undefined;
      const fullSize = item.node.hasAttribute('data-drawer-surface')
        ? parseFloat(css.getPropertyValue('--drawer-full-size'))
        : size;
      const paddingStart = size ? css[item.vertical ? 'paddingTop' : 'paddingLeft'] : '0px';
      const paddingEnd = size ? css[item.vertical ? 'paddingBottom' : 'paddingRight'] : '0px';
      return { size, fullSize, gap, transform, paddingStart, paddingEnd, animated };
    });
    // Finish every read before changing layout. A reversal must sample all
    // siblings at the same instant, before cancelling any of their animations.
    for (const item of moving) {
      item.motion?.cancel();
      item.motion = undefined;
      delete item.node.dataset.drawerMotion;
      delete item.node.dataset.drawerSurface;
      item.node.hidden = !item.open;
    }
    const targets = moving.map((item) => {
      const node = item.node,
        css = getComputedStyle(node);
      const overlay = css.position === 'absolute' || css.position === 'fixed';
      item.vertical =
        !overlay && getComputedStyle(node.parentElement!).flexDirection.startsWith('column');
      const size = item.open ? node.getBoundingClientRect()[item.vertical ? 'height' : 'width'] : 0;
      const gap = item.open
        ? parseFloat(
            css[item.vertical ? 'marginTop' : item.edge === 'left' ? 'marginRight' : 'marginLeft'],
          )
        : 0;
      return {
        size,
        gap,
        overlay,
        paddingStart: item.open ? css[item.vertical ? 'paddingTop' : 'paddingLeft'] : '0px',
        paddingEnd: item.open ? css[item.vertical ? 'paddingBottom' : 'paddingRight'] : '0px',
      };
    });
    moving.forEach((item, index) => {
      const node = item.node,
        start = starts[index],
        target = targets[index];
      node.hidden = false;
      if (
        matchMedia('(prefers-reduced-motion: reduce)').matches ||
        (!start.size && !target.size) ||
        (!start.animated &&
          (item.fluid || !changed.has(item)) &&
          start.size === target.size &&
          start.gap === target.gap)
      ) {
        item.finish();
        return;
      }
      node.dataset.drawerMotion = target.overlay
        ? 'overlay'
        : item.vertical
          ? 'vertical'
          : 'horizontal';
      node.dataset.animating = 'true';
      // Keep the actual surface at its final measure so container queries and
      // text wrapping stay stable. Only its occupied slot and translation change.
      if (!item.fluid && !target.overlay) {
        node.dataset.drawerSurface = 'true';
        node.style.setProperty(
          '--drawer-full-size',
          `${item.open ? target.size : start.fullSize}px`,
        );
      }
      const frames = target.overlay
        ? [
            {
              transform:
                start.transform ||
                (item.open
                  ? `translateX(${item.edge === 'left' ? '-' : ''}100%)`
                  : 'translateX(0)'),
            },
            {
              transform: item.open
                ? 'translateX(0)'
                : `translateX(${item.edge === 'left' ? '-' : ''}100%)`,
            },
          ]
        : [
            {
              '--drawer-size': `${start.size}px`,
              '--drawer-gap': `${start.size ? start.gap : 0}px`,
              ...(item.fluid
                ? {
                    [item.vertical ? 'paddingTop' : 'paddingLeft']: start.paddingStart,
                    [item.vertical ? 'paddingBottom' : 'paddingRight']: start.paddingEnd,
                  }
                : {}),
            },
            {
              '--drawer-size': `${target.size}px`,
              '--drawer-gap': `${target.gap}px`,
              ...(item.fluid
                ? {
                    [item.vertical ? 'paddingTop' : 'paddingLeft']: target.paddingStart,
                    [item.vertical ? 'paddingBottom' : 'paddingRight']: target.paddingEnd,
                  }
                : {}),
            },
          ];
      item.motion = node.animate(frames, {
        duration,
        easing: 'cubic-bezier(.22, .75, .2, 1)',
        fill: 'both',
      });
      item.motion.onfinish = item.finish;
    });
    window.dispatchEvent(new Event('beings:drawer-motion'));
  });
}

/** Shared docked/overlay drawer: presence, coordinated space, reversal and resize. */
export function WorkspaceDrawer({
  open: requestedOpen,
  as: Element = 'aside',
  ref: providedRef,
  fluid = false,
  edge = 'right',
  children,
  onPointerDownCapture,
  onKeyDownCapture,
  ...props
}: Omit<ComponentPropsWithoutRef<'aside'>, 'hidden' | 'ref'> & {
  open?: boolean;
  as?: 'aside' | 'section' | 'div';
  ref?: RefObject<HTMLElement | null>;
  fluid?: boolean;
  edge?: 'left' | 'right';
}) {
  const context = useContext(DrawerContext);
  const open = (requestedOpen ?? true) && context.open;
  const ownRef = useRef<HTMLElement>(null),
    ref = providedRef || ownRef;
  const attach = useCallback(
    (node: HTMLElement | null) => {
      ref.current = node;
    },
    [ref],
  );
  const [retained, setRetained] = useState(open);
  const record = useRef<DrawerRecord | null>(null);
  useLayoutEffect(() => {
    const node = ref.current!;
    const css = getComputedStyle(node);
    const vertical =
      css.position !== 'absolute' &&
      css.position !== 'fixed' &&
      getComputedStyle(node.parentElement!).flexDirection.startsWith('column');
    const item: DrawerRecord = {
      node,
      open,
      size: fluid && open ? node.getBoundingClientRect()[vertical ? 'height' : 'width'] : 0,
      gap: 0,
      vertical,
      fluid,
      edge,
      finish: () => {
        if (!item.open) {
          setRetained(false);
          return;
        }
        item.motion?.cancel();
        item.motion = undefined;
        delete node.dataset.drawerMotion;
        delete node.dataset.drawerSurface;
        delete node.dataset.animating;
        node.style.removeProperty('--drawer-full-size');
        item.size = node.getBoundingClientRect()[item.vertical ? 'height' : 'width'];
        item.gap = parseFloat(
          getComputedStyle(node)[
            item.vertical ? 'marginTop' : item.edge === 'left' ? 'marginRight' : 'marginLeft'
          ],
        );
        window.dispatchEvent(new Event('beings:drawer-motion'));
      },
    };
    record.current = item;
    drawers.add(item);
    const observer = new ResizeObserver(() => {
      if (item.motion) return;
      const css = getComputedStyle(node);
      item.vertical =
        css.position !== 'absolute' &&
        css.position !== 'fixed' &&
        getComputedStyle(node.parentElement!).flexDirection.startsWith('column');
      item.size = node.getBoundingClientRect()[item.vertical ? 'height' : 'width'];
      item.gap = item.size
        ? parseFloat(
            css[item.vertical ? 'marginTop' : item.edge === 'left' ? 'marginRight' : 'marginLeft'],
          )
        : 0;
    });
    observer.observe(node);
    // Idle drawers are already measured by ResizeObserver. Resize events only
    // need to interrupt a running transition, not remeasure every panel.
    const settle = () => {
      if (item.motion) item.finish();
    };
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    window.addEventListener('resize', settle);
    reduced.addEventListener('change', settle);
    return () => {
      drawers.delete(item);
      pending.delete(item);
      observer.disconnect();
      item.motion?.cancel();
      window.removeEventListener('resize', settle);
      reduced.removeEventListener('change', settle);
    };
  }, [ref]);
  useLayoutEffect(() => {
    const item = record.current!;
    item.open = open;
    item.fluid = fluid;
    if (open) setRetained(true);
    if (open || retained) {
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
        item.node.dataset.animating = 'true';
      schedule(item);
    }
  }, [open]);
  useLayoutEffect(() => {
    if (open || retained) return;
    const item = record.current!;
    item.motion?.cancel();
    item.motion = undefined;
    delete item.node.dataset.drawerMotion;
    delete item.node.dataset.drawerSurface;
    delete item.node.dataset.animating;
    item.node.style.removeProperty('--drawer-full-size');
    window.dispatchEvent(new Event('beings:drawer-motion'));
    context.onExited?.();
  }, [open, retained, context.onExited]);
  return (
    <Element
      {...props}
      ref={attach}
      hidden={!open && !retained}
      inert={!open || props.inert}
      aria-hidden={!open || props['aria-hidden']}
      data-workspace-drawer=""
      data-drawer-edge={edge}
      data-open={open}
      onPointerDownCapture={(event) => {
        if ((event.target as Element).closest('[role="separator"]')) record.current?.finish();
        onPointerDownCapture?.(event);
      }}
      onKeyDownCapture={(event) => {
        if ((event.target as Element).closest('[role="separator"]')) record.current?.finish();
        onKeyDownCapture?.(event);
      }}
    >
      {children}
    </Element>
  );
}

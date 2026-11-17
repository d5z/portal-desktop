import { safePolygon, useFloating, useHover, useInteractions } from '@floating-ui/react';
import { useCallback, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { MessageActionSlot } from '../../shared/components/message-action-slot';

export function MessageHoverRow({ sent, bodyProps, children, actions, menu, feedback }: {
  sent: boolean;
  bodyProps: (hasExtraActions: boolean) => ComponentProps<'div'>;
  children: ReactNode;
  actions: (mediaActions: ReactNode, hasExtraActions: boolean) => ReactNode;
  menu: HTMLElement | null;
  feedback: ReactNode;
}) {
  const desktop = document.documentElement.dataset.chatHost === 'desktop';
  const [hovered, setHovered] = useState(false);
  const [actionTarget, setActionTarget] = useState<HTMLDivElement | null>(null);
  const [extraActionGroups, setExtraActionGroups] = useState(0);
  const registerExtraActions = useCallback(() => {
    setExtraActionGroups(count => count + 1);
    return () => setExtraActionGroups(count => count - 1);
  }, []);
  const slot = useMemo(() => ({ actions: actionTarget, menu, registerExtraActions }), [actionTarget, menu, registerExtraActions]);
  const hasExtraActions = extraActionGroups > 0;
  const { context, refs } = useFloating({ open: hovered, onOpenChange: setHovered });
  const hover = useHover(context, {
    enabled: desktop,
    mouseOnly: true,
    delay: { close: 80 },
    handleClose: args => {
      const body = args.elements.domReference!.getBoundingClientRect();
      const bar = args.elements.floating!.getBoundingClientRect();
      // The action bar stays in the row's flow. When it wraps, the
      // safe polygon must point down at the bar's actual placement.
      const placement = bar.top >= body.bottom - 1 ? 'bottom' : sent ? 'left' : 'right';
      return safePolygon({ requireIntent: false, buffer: 4 })({ ...args, placement });
    },
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover]);
  return <MessageActionSlot.Provider value={slot}><div className="message-bubble-row" data-message-hover data-actions-hovered={hovered || undefined}>
    <div ref={refs.setReference} {...getReferenceProps(bodyProps(hasExtraActions))}>{children}</div>
    <div ref={refs.setFloating} {...getFloatingProps({ className: 'message-action-space' })}>
      {actions(<div className="message-media-actions" ref={setActionTarget} />, hasExtraActions)}
    </div>
  </div>{feedback}</MessageActionSlot.Provider>;
}

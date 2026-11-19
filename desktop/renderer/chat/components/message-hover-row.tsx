import { safePolygon, useFloating, useHover, useInteractions } from '@floating-ui/react';
import { useCallback, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MessageActionSlot, MessageCaptionSlot } from '../../shared/components/message-action-slot';

export function MessageHoverRow({ sent, bodyProps, children, actions, time, copy, mixedMedia, menu, feedback }: {
  sent: boolean;
  bodyProps: (hasExtraActions: boolean) => ComponentProps<'div'>;
  children: ReactNode;
  actions: (mediaActions: ReactNode, hasExtraActions: boolean) => ReactNode;
  time: ReactNode;
  copy: ReactNode;
  mixedMedia: boolean;
  menu: HTMLElement | null;
  feedback: ReactNode;
}) {
  const desktop = document.documentElement.dataset.chatHost === 'desktop';
  const [hovered, setHovered] = useState(false);
  const [actionTarget, setActionTarget] = useState<HTMLDivElement | null>(null);
  const captionTargets = useRef(new Set<HTMLDivElement>());
  const [captionTarget, setCaptionTarget] = useState<HTMLDivElement | null>(null);
  const registerCaption = useCallback((node: HTMLDivElement) => {
    const targets = captionTargets.current;
    const update = () => {
      // A mixed message can contain several prose blocks but has one time and copy control.
      let last: HTMLDivElement | null = null;
      for (const target of targets) {
        if (!last || (last.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING)) last = target;
      }
      setCaptionTarget(last);
    };
    targets.add(node);
    update();
    return () => {
      targets.delete(node);
      update();
    };
  }, []);
  const hasCopy = Boolean(copy);
  const captionSlot = useMemo(() => desktop && hasCopy ? { mixedMedia, register: registerCaption } : null, [desktop, hasCopy, mixedMedia, registerCaption]);
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
      if (!bar.width) return () => args.onClose();
      // The action bar stays in the row's flow. When it wraps, the
      // safe polygon must point down at the bar's actual placement.
      const placement = bar.top >= body.bottom - 1 ? 'bottom' : sent ? 'left' : 'right';
      return safePolygon({ requireIntent: false, buffer: 4 })({ ...args, placement });
    },
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover]);
  return <MessageActionSlot.Provider value={slot}><div className="message-bubble-row" data-message-hover data-actions-hovered={hovered || undefined}>
    <div ref={refs.setReference} {...getReferenceProps(bodyProps(hasExtraActions))}>
      <MessageCaptionSlot.Provider value={captionSlot}>{children}</MessageCaptionSlot.Provider>
    </div>
    {captionTarget && createPortal(<div className="message-hover-actions" data-message-actions>
      {time}<div className="message-hover-buttons">{copy}</div>
    </div>, captionTarget)}
    <div ref={refs.setFloating} {...getFloatingProps({ className: 'message-action-space' })}>
      <div className="message-hover-actions" data-message-actions={captionTarget ? undefined : true}>
        {!captionTarget && time}
        <div className="message-hover-buttons">
          {!captionTarget && copy}
          {actions(<div className="message-media-actions" ref={setActionTarget} />, hasExtraActions)}
        </div>
      </div>
    </div>
  </div>{feedback}</MessageActionSlot.Provider>;
}

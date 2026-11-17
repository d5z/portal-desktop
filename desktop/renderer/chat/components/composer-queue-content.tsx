import {
  autoUpdate, flip, FloatingFocusManager, FloatingPortal, offset, shift, size,
  useClick, useDismiss, useFloating, useInteractions, useRole,
} from '@floating-ui/react';
import { useEffect, useState, type ReactNode } from 'react';

export function ComposerQueueContent({ text, summary, names, image, position, dragging, status }: {
  text: string;
  summary: string;
  names: string[];
  image?: { src?: string; blob?: Blob };
  position: number;
  dragging: boolean;
  status: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [objectUrl, setObjectUrl] = useState('');
  const blob = image?.blob;
  useEffect(() => {
    const url = blob ? URL.createObjectURL(blob) : '';
    setObjectUrl(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [blob]);
  useEffect(() => { if (dragging) setOpen(false); }, [dragging]);
  const { context, refs, floatingStyles } = useFloating({
    open: open && !dragging, onOpenChange(next) {
      if (next && dragging) return;
      setOpen(next);
    }, placement: 'top-start', strategy: 'fixed', whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 }), size({ padding: 8, apply({ availableHeight, elements }) {
      elements.floating.style.setProperty('--queue-preview-available-height', `${availableHeight}px`);
    } })],
  });
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);
  const src = blob ? objectUrl : image?.src;
  return <div className="composer-queue-copy">
    {status}
    {src && <img className="composer-queue-thumbnail" src={src} alt="图片附件" draggable={false} />}
    <button type="button" className="composer-queue-preview-trigger" ref={refs.setReference} {...getReferenceProps({
      'aria-label': `预览第 ${position} 条待发消息：${summary.replace(/\s+/g, ' ').slice(0, 80)}`,
    })}><span className="composer-queue-content">{text || summary}</span></button>
    {open && !dragging && <FloatingPortal><FloatingFocusManager context={context} modal={false} initialFocus={-1}>
      <div ref={refs.setFloating} style={floatingStyles} className="composer-queue-preview" {...getFloatingProps({
        'aria-label': '待发消息预览', tabIndex: 0,
      })}>
        {(text || !names.length) && <div>{text || summary}</div>}
        {!!names.length && <ul aria-label="待发附件">{names.map((name, index) => <li key={index}>{name}</li>)}</ul>}
      </div>
    </FloatingFocusManager></FloatingPortal>}
  </div>;
}

import { useEffect, useRef, useState, type DragEvent } from 'react';
import useEventListener from 'ahooks/es/useEventListener';
import useMemoizedFn from 'ahooks/es/useMemoizedFn';

const dragEndEvents = ['dragend', 'drop', 'pointerup'];

/** File-drop ownership stays on the chat root; global recovery exists only during a drag. */
export function useFileDrop(scope: string, onFiles: (files: FileList) => void) {
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const reset = useMemoizedFn(() => { depth.current = 0; setDragging(false); });
  useEffect(reset, [scope, reset]);
  useEventListener('blur', reset, { enable: dragging });
  useEventListener(dragEndEvents, reset, { enable: dragging, capture: true });
  useEventListener('pointermove', event => {
    if (event.buttons === 0 && depth.current) reset();
  }, { enable: dragging, capture: true });
  useEventListener('keydown', event => {
    if (event.key === 'Escape') reset();
  }, { enable: dragging, capture: true });
  useEventListener('visibilitychange', () => {
    if (document.hidden) reset();
  }, { target: document, enable: dragging });

  return {
    dragging,
    dropHandlers: {
      onDragEnter(event: DragEvent) {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        depth.current++;
        setDragging(true);
      },
      onDragLeave(event: DragEvent) {
        if (!depth.current) return;
        event.preventDefault();
        if (--depth.current <= 0) reset();
      },
      onDragOver(event: DragEvent) { event.preventDefault(); },
      onDrop(event: DragEvent) {
        event.preventDefault();
        reset();
        onFiles(event.dataTransfer.files);
      },
    },
  };
}

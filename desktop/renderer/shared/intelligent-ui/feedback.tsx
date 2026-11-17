import { CopySuccessText } from '../components/copy-feedback';
import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

type Notice = { owner: string; text: string; copied: boolean };
let notice: Notice | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => notice;
const serverSnapshot = () => null;
function replace(next: Notice | null) {
  clearTimeout(timer);
  notice = next;
  for (const listener of listeners) listener();
  if (next) timer = setTimeout(() => replace(null), 2200);
}

/** A page-wide notice: the latest action replaces feedback from every other artifact. */
export function useUIToast() {
  const owner = useId(), alive = useRef(true);
  const current = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (notice?.owner === owner) replace(null); };
  }, [owner]);
  const notify = useCallback((text: string, copied = false) => { if (alive.current) replace({ owner, text, copied }); }, [owner]);
  return {
    notify,
    toast: current?.owner === owner && typeof document !== 'undefined' ? createPortal(
      <div className="iui-toast" role="status" aria-live="polite" aria-atomic="true">{current.copied ? <CopySuccessText>{current.text}</CopySuccessText> : current.text}</div>,
      document.body,
    ) : null,
  };
}

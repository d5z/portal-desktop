import { CopySuccessText } from '../components/copy-feedback';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';

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
  const toastRef = useRef<HTMLDivElement>(null);
  const current = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useLayoutEffect(() => {
    const toast = toastRef.current;
    if (!toast) return;
    // A newer notification must also rise above any modal opened since the last one.
    if (toast.matches(':popover-open')) toast.hidePopover();
    toast.showPopover();
  }, [current]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (notice?.owner === owner) replace(null); };
  }, [owner]);
  const notify = useCallback((text: string, copied = false) => { if (alive.current) replace({ owner, text, copied }); }, [owner]);
  // Stay inside the owning modal for accessibility, but paint above its content.
  return {
    notify,
    toast: current?.owner === owner ? <div ref={toastRef} className="iui-toast" popover="manual" role="status" aria-live="polite" aria-atomic="true">
      {current.copied ? <CopySuccessText>{current.text}</CopySuccessText> : current.text}
    </div> : null,
  };
}

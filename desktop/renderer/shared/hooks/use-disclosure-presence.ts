import { useEffect, useState } from 'react';

/** Keep a dismissed surface only long enough to finish its CSS exit transition. */
export function useDisclosurePresence(open: boolean, duration = 160) {
  const [retained, setRetained] = useState(open);
  useEffect(() => {
    if (open) { setRetained(true); return; }
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    if (preference.matches) { setRetained(false); return; }
    const dismiss = () => setRetained(false);
    const timer = window.setTimeout(dismiss, duration);
    preference.addEventListener('change', dismiss);
    return () => { clearTimeout(timer); preference.removeEventListener('change', dismiss); };
  }, [open, duration]);
  return open || retained;
}

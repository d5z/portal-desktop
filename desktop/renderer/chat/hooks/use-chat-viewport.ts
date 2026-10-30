import { useEffect, useState } from 'react';
import useRafState from 'ahooks/es/useRafState';

const touchQuery = '(max-width: 760px), (hover: none) and (pointer: coarse)';
const readViewport = () => ({
  height: window.visualViewport?.height || innerHeight,
  width: innerWidth,
  offset: window.visualViewport?.offsetTop || 0,
});

/** Merge visual/window viewport events into one update per frame, skipping unchanged geometry. */
export function useChatViewport(mobileWeb: boolean) {
  const [viewport, setViewport] = useRafState(readViewport);
  const [touch, setTouch] = useState(() => matchMedia(touchQuery).matches);
  useEffect(() => {
    const visual = window.visualViewport;
    const resize = () => {
      const next = readViewport();
      setViewport(previous => previous.height === next.height && previous.width === next.width && previous.offset === next.offset ? previous : next);
    };
    resize();
    window.addEventListener('resize', resize);
    visual?.addEventListener('resize', resize);
    visual?.addEventListener('scroll', resize, { passive: true });
    return () => {
      window.removeEventListener('resize', resize);
      visual?.removeEventListener('resize', resize);
      visual?.removeEventListener('scroll', resize);
    };
  }, [setViewport]);
  useEffect(() => {
    if (!mobileWeb) return;
    const media = matchMedia(touchQuery);
    const change = () => setTouch(media.matches);
    change();
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, [mobileWeb]);
  return { viewport, nativeTouch: mobileWeb && touch };
}

import { useEffect, useRef } from "react";

const gestureThreshold = 72;
const gestureReleaseDelay = 240;

function canScrollHorizontally(
  target: EventTarget | null,
  boundary: HTMLElement,
  delta: number,
) {
  let element = target instanceof HTMLElement ? target : null;
  while (element && element !== boundary) {
    const style = getComputedStyle(element);
    if (
      /auto|scroll/.test(style.overflowX) &&
      element.scrollWidth > element.clientWidth + 1 &&
      (delta < 0
        ? element.scrollLeft > 0
        : element.scrollLeft + element.clientWidth < element.scrollWidth - 1)
    )
      return true;
    element = element.parentElement;
  }
  return false;
}

export function NavigationControls({
  back,
  forward,
}: {
  back?: () => void;
  forward?: () => void;
}) {
  const controls = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = controls.current;
    const surface = element?.closest<HTMLElement>("dialog, #settings-panel");
    const mac =
      document.documentElement.dataset.platform === "darwin" ||
      /^Mac/.test(navigator.platform);
    if (!surface || !mac) return;
    let distance = 0;
    let locked = false;
    let release: ReturnType<typeof setTimeout> | undefined;
    const resetLater = () => {
      clearTimeout(release);
      release = setTimeout(() => {
        distance = 0;
        locked = false;
      }, gestureReleaseDelay);
    };
    const wheel = (event: WheelEvent) => {
      if (
        event.ctrlKey ||
        event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
        Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.2
      ) {
        distance = 0;
        return;
      }
      if (canScrollHorizontally(event.target, surface, event.deltaX)) {
        distance = 0;
        return;
      }
      const action = event.deltaX < 0 ? back : forward;
      if (!action) {
        distance = 0;
        return;
      }
      event.preventDefault();
      resetLater();
      if (locked) return;
      if (distance && Math.sign(distance) !== Math.sign(event.deltaX))
        distance = 0;
      distance += event.deltaX;
      if (Math.abs(distance) < gestureThreshold) return;
      locked = true;
      distance = 0;
      action();
    };
    surface.addEventListener("wheel", wheel, { passive: false });
    return () => {
      clearTimeout(release);
      surface.removeEventListener("wheel", wheel);
    };
  }, [back, forward]);
  return (
    <div
      ref={controls}
      className="navigation-controls"
      role="group"
      aria-label="页面历史"
    >
      <button
        type="button"
        aria-label="回退"
        title="回退"
        disabled={!back}
        onClick={back}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="m12.5 4.5-5.5 5.5 5.5 5.5" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="前进"
        title="前进"
        disabled={!forward}
        onClick={forward}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="m7.5 4.5 5.5 5.5-5.5 5.5" />
        </svg>
      </button>
    </div>
  );
}

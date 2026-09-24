/** The shell owns keyboard geometry; embedded chat fills the remaining space. */
export function installWebViewport(win: Window = window) {
  const root = win.document.documentElement;
  const viewport = win.visualViewport;
  let width = win.innerWidth;
  let restingHeight = Math.max(win.innerHeight, root.clientHeight);

  function editing() {
    let active = win.document.activeElement;
    // Focus inside the same-origin chat iframe is not a focus event on the shell.
    while (active?.tagName === "IFRAME") {
      try {
        active = (active as HTMLIFrameElement).contentDocument?.activeElement ?? null;
      } catch { return false; }
    }
    return !!active && (active.matches("textarea, input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file])") ||
      (active as HTMLElement).isContentEditable);
  }

  function resize() {
    // Pinch zoom must not reflow the app or masquerade as a keyboard.
    if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
    const height = viewport?.height || win.innerHeight;
    const layoutHeight = Math.max(win.innerHeight, root.clientHeight, height);
    if (width !== win.innerWidth) {
      width = win.innerWidth;
      restingHeight = layoutHeight;
    }
    if (!editing()) restingHeight = layoutHeight;
    else restingHeight = Math.max(restingHeight, layoutHeight);
    root.style.setProperty("--web-viewport-height", `${height}px`);
    root.style.setProperty("--web-viewport-offset", `${viewport?.offsetTop || 0}px`);
    root.dataset.keyboard = String(Math.max(layoutHeight, restingHeight) - height > 120);
  }

  resize();
  viewport?.addEventListener("resize", resize);
  viewport?.addEventListener("scroll", resize);
  win.addEventListener("resize", resize);
  return () => {
    viewport?.removeEventListener("resize", resize);
    viewport?.removeEventListener("scroll", resize);
    win.removeEventListener("resize", resize);
    root.style.removeProperty("--web-viewport-height");
    root.style.removeProperty("--web-viewport-offset");
    delete root.dataset.keyboard;
  };
}

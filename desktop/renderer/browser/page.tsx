import { WorkspaceDrawer } from "../shared/components/workspace-drawer";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { BrowserAction, BrowserState, BrowserBounds } from "../../shared/types";
import type { AppModel } from "../app/models/app";
import { PanelResizeHandle, usePanelWidth } from "../shared/components/panel-resize";
export function Browser({ model: app }: { model: AppModel }) {
  const [state, setState] = useState<BrowserState>({
    open: false,
    title: "浏览器",
    address: "",
    loading: false,
    canGoBack: false,
    canGoForward: false,
  });
  const [address, setAddress] = useState("");
  const panel = useRef<HTMLElement>(null),
    viewport = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null),
    dragging = useRef(false);
  const [width, setWidth] = usePanelWidth('browser', 640);
  const lastBounds = useRef<BrowserBounds | null>(null);
  const sendBounds = useCallback(() => {
    if (!viewport.current || !app.api) return;
    const rect = viewport.current.getBoundingClientRect();
    const visible = state.open && !dragging.current && !panel.current?.dataset.animating && !panel.current?.hidden && rect.width > 0 && rect.height > 0 && app.startup === "ready" && !document.querySelector("dialog[open]");
    const { x, y, width, height } = visible ? rect : { x:0, y:0, width:0, height:0 };
    const bounds = { x, y, width, height, visible };
    const previous = lastBounds.current;
    if (previous && previous.x === x && previous.y === y && previous.width === width && previous.height === height && previous.visible === visible) return;
    lastBounds.current = bounds;
    void app.api
      .browserBounds(bounds)
      .catch(error => { if (lastBounds.current === bounds) lastBounds.current = null; app.toast(error); });
  }, [app, state.open]);
  const setDragging = useCallback(
    (active: boolean) => {
      dragging.current = active;
      sendBounds();
    },
    [sendBounds],
  );
  useLayoutEffect(() => {
    if (!state.open) return;
    const current = panel.current;
    window.dispatchEvent(new CustomEvent('beings:side-panel-open', { detail: current }));
    const replace = (event: Event) => {
      if ((event as CustomEvent).detail !== current) void app.run(() => app.api.browserAction('close'));
    };
    window.addEventListener('beings:side-panel-open', replace);
    return () => window.removeEventListener('beings:side-panel-open', replace);
  }, [app, state.open]);
  useEffect(() => {
    if (!app.api) return;
    let active = true,
      received = false;
    const render = (next: BrowserState) => {
      if (!active) return;
      setState(next);
      if (document.activeElement !== input.current) setAddress(next.address);
    };
    const stop = app.api.onBrowser((next) => {
      received = true;
      render(next);
    });
    void app.api
      .browserState()
      .then((next) => {
        if (!received) render(next);
      })
      .catch(app.toast);
    return () => {
      active = false;
      stop();
    };
  }, [app]);
  useLayoutEffect(sendBounds, [sendBounds, state.open, width, app.startup]);
  useEffect(() => {
    if (!state.open) return;
    let scheduled = 0;
    const layout = () => {
      if (!scheduled)
        scheduled = requestAnimationFrame(() => {
          scheduled = 0;
          sendBounds();
        });
    };
    const resize = new ResizeObserver(layout);
    if (viewport.current) resize.observe(viewport.current);
    const mutation = new MutationObserver(records => {
      if (records.some(record => record.target instanceof HTMLDialogElement ||
        [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches('dialog') || node.querySelector('dialog'))))) layout();
    });
    // Dynamic Kit dialogs must also hide the native WebContentsView.
    mutation.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    window.addEventListener("resize", layout);
    window.addEventListener("beings:drawer-motion", layout);
    return () => {
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", layout);
      window.removeEventListener("beings:drawer-motion", layout);
      cancelAnimationFrame(scheduled);
    };
  }, [sendBounds, state.open]);
  const act = (action: BrowserAction) =>
    void app.run(() => app.api.browserAction(action));
  return (
    <WorkspaceDrawer
      id="browser-panel"
      ref={panel}
      aria-label="内置浏览器"
      open={state.open}
      style={{ width }}
    >
      <PanelResizeHandle panel={panel} label="调整浏览器宽度" width={width} onResize={setWidth} initial={640} min={280} max={1200} reserve={280} disabled={!state.open} onDraggingChange={setDragging} />
      <div className="browser-heading">
        <strong id="browser-title">{state.title}</strong>
        <button
          id="browser-external"
          title="在系统浏览器打开"
          aria-label="在系统浏览器打开"
          disabled={!state.address}
          onClick={() => act("external")}
        >
          ↗
        </button>
        <button
          id="browser-close"
          aria-label="关闭浏览器"
          onClick={() => act("close")}
        >
          ×
        </button>
      </div>
      <form
        id="browser-address-form"
        onSubmit={(event) => {
          event.preventDefault();
          input.current?.blur();
          if (address === state.address) act("reload");
          else void app.run(() => app.api.openBrowser(address));
        }}
      >
        <button
          type="button"
          id="browser-back"
          aria-label="后退"
          disabled={!state.canGoBack}
          onClick={() => act("back")}
        >
          ←
        </button>
        <button
          type="button"
          id="browser-forward"
          aria-label="前进"
          disabled={!state.canGoForward}
          onClick={() => act("forward")}
        >
          →
        </button>
        <button
          type="button"
          id="browser-reload"
          aria-label={state.loading ? "停止加载" : "刷新网页"}
          onClick={() => act(state.loading ? "stop" : "reload")}
        >
          {state.loading ? "×" : "↻"}
        </button>
        <input
          id="browser-address"
          ref={input}
          aria-label="网页地址"
          placeholder="输入网址"
          autoComplete="off"
          spellCheck={false}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
        <button type="submit">前往</button>
      </form>
      <div id="browser-viewport" ref={viewport}>
        <p id="browser-message" role="status">
          {state.error ||
            (state.loading
              ? "正在加载网页…"
              : state.address
                ? ""
                : "输入网址，或从更多选项打开原版 Loom、小镇说明。")}
        </p>
      </div>
    </WorkspaceDrawer>
  );
}

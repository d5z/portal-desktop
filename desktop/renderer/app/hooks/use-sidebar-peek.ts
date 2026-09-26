import { useCallback, useEffect, useRef, useState } from "react";

// Rationale and evidence: docs/SIDEBAR-INTERACTION-2026-09-25.md.
export const SIDEBAR_PEEK = { hotzoneWidth: 8, openDelay: 300, closeDelay: 300 } as const;

/** Hover is transient. Only the titlebar button changes the pinned state. */
export function useSidebarPeek(enabled: boolean, engaged: boolean) {
  const [pinned, setPinned] = useState(true);
  const [peek, setPeek] = useState(false);
  const [instant, setInstant] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const edge = useRef<HTMLDivElement>(null);
  const peeking = useRef(false);
  const nativeDrag = useRef(false);
  const suppressed = useRef(false);
  const keyboard = useRef(false);
  const pointer = useRef({ x: -1, y: -1 });
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelOpen = useCallback(() => { clearTimeout(openTimer.current); openTimer.current = undefined; }, []);
  const cancelClose = useCallback(() => { clearTimeout(closeTimer.current); closeTimer.current = undefined; }, []);
  const dismiss = useCallback((immediate = false, restoreFocus = true) => {
    cancelOpen(); cancelClose();
    if (restoreFocus && panel.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
    nativeDrag.current = false;
    peeking.current = false;
    setInstant(immediate);
    setPeek(false);
  }, [cancelOpen, cancelClose]);

  const toggle = (fromKeyboard: boolean) => {
    suppressed.current = true;
    dismiss(fromKeyboard);
    setPinned(value => !value);
  };
  useEffect(() => {
    if (enabled && !pinned && peek) window.dispatchEvent(new Event("beings:sidebar-peek"));
  }, [enabled, pinned, peek]);

  useEffect(() => {
    if (!enabled) {
      dismiss(true);
      return;
    }
    if (pinned) return;
    let pressed = false;
    const containsPointer = (element: HTMLElement | null) => {
      const rect = element?.getBoundingClientRect();
      return !!rect && pointer.current.x >= rect.left && pointer.current.x < rect.right
        && pointer.current.y >= rect.top && pointer.current.y < rect.bottom;
    };
    const inEdge = () => containsPointer(edge.current);
    const contains = (node: EventTarget | null) => node instanceof Node
      && (!!panel.current?.contains(node) || !!trigger.current?.contains(node));
    const insidePanel = () => containsPointer(panel.current);
    const hasKeyboardFocus = () => keyboard.current && panel.current?.contains(document.activeElement);
    const blocked = () => !document.hasFocus() || document.hidden || pressed || engaged
      || !!document.querySelector("dialog[open]") || document.getSelection()?.isCollapsed === false;
    const scheduleClose = () => {
      cancelOpen();
      if (!peeking.current || nativeDrag.current || engaged || hasKeyboardFocus() || closeTimer.current !== undefined) return;
      closeTimer.current = setTimeout(() => {
        closeTimer.current = undefined;
        // The panel can finish sliding under a stationary pointer without a
        // fresh pointermove or :hover update. Recheck its actual geometry.
        if (!nativeDrag.current && !engaged && !hasKeyboardFocus() && !insidePanel() && !inEdge() && !containsPointer(trigger.current)) dismiss();
      }, SIDEBAR_PEEK.closeDelay);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
      pointer.current = { x: event.clientX, y: event.clientY };
      pressed = event.buttons !== 0;
      const atEdge = inEdge();
      if (!atEdge) {
        suppressed.current = false;
        cancelOpen();
      }
      if (peeking.current) {
        if (atEdge || contains(event.target)) cancelClose();
        else scheduleClose();
        return;
      }
      if (!atEdge || suppressed.current || blocked()) { cancelOpen(); return; }
      if (openTimer.current !== undefined) return;
      openTimer.current = setTimeout(() => {
        openTimer.current = undefined;
        if (!inEdge() || suppressed.current || blocked()) return;
        peeking.current = true;
        setInstant(false);
        setPeek(true);
      }, SIDEBAR_PEEK.openDelay);
    };
    const leave = (event: PointerEvent) => {
      // Pointer events stop at iframe boundaries and outside the window.
      pointer.current = event.relatedTarget ? { x: event.clientX, y: event.clientY } : { x: -1, y: -1 };
      if (!inEdge()) { suppressed.current = false; cancelOpen(); }
      if (!event.relatedTarget || (!contains(event.relatedTarget) && event.relatedTarget !== edge.current)) scheduleClose();
    };
    const down = (event: PointerEvent) => {
      pressed = true;
      keyboard.current = false;
      cancelOpen();
      if (!peeking.current && inEdge()) suppressed.current = true;
      if (peeking.current && !engaged && !contains(event.target)) {
        suppressed.current = inEdge();
        dismiss(true, false);
      }
    };
    const up = () => { pressed = false; };
    // HTML drag-and-drop takes over from pointer events and emits pointercancel.
    // Keep a synchronous ref: React's engaged state may update after that handoff.
    const dragStart = (event: DragEvent) => {
      if (!panel.current?.contains(event.target as Node)) return;
      nativeDrag.current = true;
      cancelOpen(); cancelClose();
    };
    const dragOver = (event: DragEvent) => {
      if (nativeDrag.current) pointer.current = { x: event.clientX, y: event.clientY };
    };
    const dragEnd = (event: DragEvent) => {
      if (!nativeDrag.current) return;
      nativeDrag.current = false;
      pressed = false;
      pointer.current = { x: event.clientX, y: event.clientY };
      scheduleClose();
    };
    const pointerCancel = () => { if (!nativeDrag.current) deactivate(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Tab" || event.key.startsWith("Arrow")) keyboard.current = true;
      if (event.key !== "Escape" || event.defaultPrevented || engaged || document.querySelector("dialog[open]")) return;
      cancelOpen();
      if (peeking.current) {
        event.preventDefault();
        suppressed.current = true;
        dismiss(true);
      }
    };
    const focus = (event: FocusEvent) => {
      if (contains(event.target)) cancelClose();
      else scheduleClose();
    };
    const deactivate = () => {
      suppressed.current = true;
      dismiss(true, false);
    };
    const blur = () => {
      // Focusing the chat iframe also blurs the parent window, while the
      // containing document still has focus. This is not app deactivation.
      if (document.hasFocus() && document.activeElement?.tagName === "IFRAME") {
        if (!inEdge()) suppressed.current = false;
        dismiss(true, false);
      } else deactivate();
    };
    const visibility = () => { if (document.hidden) deactivate(); };
    const frameDismiss = () => {
      if (engaged || document.querySelector("dialog[open]")) return;
      cancelOpen();
      if (peeking.current) { suppressed.current = true; dismiss(true); }
    };
    const frameAway = () => {
      // Cross-origin frames do not reliably deliver the parent's pointerout.
      pointer.current = { x: -1, y: -1 };
      suppressed.current = false;
      cancelOpen();
      scheduleClose();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerout", leave);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", pointerCancel, true);
    document.addEventListener("dragstart", dragStart, true);
    document.addEventListener("dragover", dragOver, true);
    document.addEventListener("drop", dragEnd, true);
    document.addEventListener("dragend", dragEnd, true);
    document.addEventListener("keydown", key);
    document.addEventListener("focusin", focus);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", blur);
    window.addEventListener("beings:sidebar-dismiss", frameDismiss);
    window.addEventListener("beings:sidebar-pointer-away", frameAway);
    // Menus and dialogs extend the interaction region until dismissed.
    if (engaged) cancelClose();
    else if (peeking.current && !insidePanel() && !containsPointer(trigger.current) && !inEdge()) scheduleClose();
    return () => {
      cancelOpen(); cancelClose();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", pointerCancel, true);
      document.removeEventListener("dragstart", dragStart, true);
      document.removeEventListener("dragover", dragOver, true);
      document.removeEventListener("drop", dragEnd, true);
      document.removeEventListener("dragend", dragEnd, true);
      document.removeEventListener("keydown", key);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      window.removeEventListener("beings:sidebar-dismiss", frameDismiss);
      window.removeEventListener("beings:sidebar-pointer-away", frameAway);
    };
  }, [enabled, pinned, engaged, cancelOpen, cancelClose, dismiss]);

  return { pinned, shown: enabled && (pinned || peek), peek: enabled && !pinned && peek,
    instant, trigger, panel, edge, toggle,
    collapse: () => { suppressed.current = true; dismiss(true); setPinned(false); } };
}

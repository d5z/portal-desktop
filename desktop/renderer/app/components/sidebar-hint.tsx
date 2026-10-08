import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Radix Tooltip defaults; these are unrelated to sidebar peek timing.
const HOVER_DELAY = 700;
const SKIP_DELAY_WINDOW = 300;

export function useSidebarHint(enabled: boolean, singleSelection = true) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [label, setLabel] = useState("");
  const popup = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLElement | null>(null);
  const keyboardHint = useRef(false);
  const warmUntil = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clear = () => { clearTimeout(pending.current); pending.current = undefined; };
  const dismiss = () => {
    if (active.current) warmUntil.current = performance.now() + SKIP_DELAY_WINDOW;
    clear(); active.current = null; setAnchor(null);
  };
  useEffect(() => {
    if (!enabled) { dismiss(); warmUntil.current = 0; return; }
    if (!singleSelection && keyboardHint.current && active.current?.hasAttribute('data-sidebar-focus-hint')) dismiss();
    let candidate: HTMLElement | null = null;
    const hintTarget = (target: EventTarget | null, keyboard = false) => {
      if (!(target instanceof Element)) return null;
      const element = target.closest<HTMLElement>(keyboard ? "[data-sidebar-focus-hint],[data-sidebar-hint]" : "[data-sidebar-hint]");
      if (keyboard && !singleSelection && element?.hasAttribute('data-sidebar-focus-hint')) return null;
      if (!keyboard && element?.hasAttribute('data-sidebar-hint-overflow')) {
        const text = element.matches('[data-scene-id]') ? element.querySelector('span:first-of-type') : element;
        if (!text || text.scrollWidth <= text.clientWidth) return null;
      }
      return element;
    };
    const inside = (target: EventTarget | null) => target instanceof Node &&
      (!!popup.current?.contains(target) || !!candidate?.contains(target));
    const show = (element: HTMLElement | null, immediate: boolean) => {
      if (!element || document.querySelector("dialog[open]")) return;
      const reveal = () => {
        if (element.isConnected && !element.closest('[inert]') && document.hasFocus()) {
          active.current = element;
          keyboardHint.current = immediate;
          setLabel(immediate ? element.dataset.sidebarFocusHint || element.dataset.sidebarHint || "" : element.dataset.sidebarHint || "");
          setAnchor(element);
        }
      };
      if (candidate === element) {
        if (immediate && (!active.current || !keyboardHint.current)) { clear(); reveal(); }
        return;
      }
      const skipDelay = !!active.current || performance.now() < warmUntil.current;
      dismiss(); candidate = element;
      if (immediate || skipDelay) reveal(); else pending.current = setTimeout(reveal, HOVER_DELAY);
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || popup.current?.contains(event.target as Node)) return;
      show(hintTarget(event.target), false);
    };
    const out = (event: PointerEvent) => {
      if (inside(event.relatedTarget)) return;
      candidate = null; dismiss();
    };
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.matches(":focus-visible")) show(hintTarget(event.target, true), true);
    };
    const reset = () => { candidate = null; dismiss(); warmUntil.current = 0; };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") reset();
      if (event.key === "Escape" && active.current) {
        // Keep candidate until leave/re-enter: Escape cannot immediately reopen it.
        if (singleSelection) { event.preventDefault(); event.stopPropagation(); }
        dismiss(); warmUntil.current = 0;
      }
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", reset);
    document.addEventListener("pointerdown", reset, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("scroll", reset, true);
    window.addEventListener("resize", reset);
    window.addEventListener("blur", reset);
    return () => {
      clear();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", reset);
      document.removeEventListener("pointerdown", reset, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("scroll", reset, true);
      window.removeEventListener("resize", reset);
      window.removeEventListener("blur", reset);
    };
  }, [enabled, singleSelection]);
  useLayoutEffect(() => {
    if (!anchor || !popup.current) return;
    const box = anchor.getBoundingClientRect();
    const tip = popup.current;
    tip.style.left = `${Math.max(8, Math.min(box.left, innerWidth - tip.offsetWidth - 8))}px`;
    const below = box.bottom + tip.offsetHeight <= innerHeight - 8;
    tip.dataset.side = below ? "bottom" : "top";
    tip.style.top = `${below ? box.bottom : Math.max(8, box.top - tip.offsetHeight)}px`;
    const previous = anchor.getAttribute("aria-describedby");
    anchor.setAttribute("aria-describedby", [previous, id].filter(Boolean).join(" "));
    const observer = new MutationObserver(() => {
      const next = (keyboardHint.current && anchor.dataset.sidebarFocusHint) || anchor.dataset.sidebarHint || "";
      if (!anchor.isConnected || !next) dismiss();
      else setLabel(next);
    });
    observer.observe(anchor, { attributes: true, attributeFilter: ["data-sidebar-hint", "data-sidebar-focus-hint"] });
    const region = anchor.closest('.chat-scene-control') || anchor.parentElement;
    if (region) observer.observe(region, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      const remaining = (anchor.getAttribute("aria-describedby") || "").split(" ").filter(value => value !== id).join(" ");
      if (remaining) anchor.setAttribute("aria-describedby", remaining); else anchor.removeAttribute("aria-describedby");
    };
  }, [anchor, id, label]);
  return {
    active: !!anchor,
    node: anchor && createPortal(<div ref={popup} id={id} className="sidebar-hint" role="tooltip">
      <span>{label}</span>
    </div>, document.body),
  };
}

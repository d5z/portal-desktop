import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChatEditCommand } from "../../../shared/types";

type TextField = HTMLInputElement | HTMLTextAreaElement;
type Context = {
  x: number; y: number; editable: boolean; selected: boolean; canSelect: boolean;
  field: TextField | null; container: HTMLElement; portal: HTMLElement; restore(): void;
};

export function EditContextMenu({ edit, onOpenChange, rootSelector = ".chat-root",
  selectionSelector = "#messages, .panel" }: {
  edit(command: ChatEditCommand): Promise<boolean>;
  onOpenChange?(open: boolean): void;
  rootSelector?: string;
  selectionSelector?: string;
}) {
  const [context, setContext] = useState<Context | null>(null);
  const [error, setError] = useState<{ message: string; portal: HTMLElement } | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

  useEffect(() => {
    const open = (event: MouseEvent) => {
      // A component-specific menu owns events it has already handled.
      if (event.defaultPrevented) return;
      if (!(event.target instanceof HTMLElement) || !event.target.closest(rootSelector)) return;
      event.preventDefault();
      if (menu.current?.contains(event.target)) return;
      const element = event.target.closest<HTMLElement>("input, textarea, [contenteditable=true]");
      const field = element instanceof HTMLTextAreaElement ||
        (element instanceof HTMLInputElement && element.selectionStart !== null) ? element : null;
      const editable = field ? !field.readOnly && !field.disabled : !!element?.isContentEditable;
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      const start = field?.selectionStart ?? 0, end = field?.selectionEnd ?? 0;
      const direction = field?.selectionDirection ?? "none";
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const container = field || element || event.target.closest<HTMLElement>(selectionSelector) || event.target;
      const portal = event.target.closest<HTMLElement>("dialog[open]") || document.body;
      const restore = () => {
        const focus = field || element || active;
        if (focus?.isConnected) focus.focus({ preventScroll: true });
        if (field?.isConnected) field.setSelectionRange(start, end, direction);
        else if (range?.commonAncestorContainer.isConnected) {
          const current = window.getSelection();
          current?.removeAllRanges();
          current?.addRange(range);
        }
      };
      setError(null);
      setContext({ x: event.clientX, y: event.clientY, editable,
        selected: field ? end > start : !!selection?.toString(),
        canSelect: !!(field ? field.value : container.textContent), field, container, portal, restore });
    };
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      setContext(null);
    };
    document.addEventListener("contextmenu", open);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("contextmenu", open);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [rootSelector, selectionSelector]);

  useLayoutEffect(() => {
    onOpenChange?.(!!context);
    if (!context || !menu.current) return;
    // A popover inside the originating modal stays above it and escapes clipping.
    if (!menu.current.matches(":popover-open")) menu.current.showPopover();
    const node = menu.current, bounds = node.getBoundingClientRect();
    node.style.left = `${Math.max(8, Math.min(context.x, innerWidth - bounds.width - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(context.y, innerHeight - bounds.height - 8))}px`;
    // Keep Escape/arrow keys available without highlighting an item on right-click.
    node.focus({ preventScroll: true });
  }, [context, onOpenChange]);

  useEffect(() => {
    if (!error) return;
    notice.current?.showPopover();
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  const run = async (command: ChatEditCommand | "selectAll") => {
    if (!context) return;
    context.restore();
    setContext(null);
    if (command === "selectAll") {
      if (context.field) context.field.select();
      else {
        const range = document.createRange();
        range.selectNodeContents(context.container);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      return;
    }
    try {
      if (await edit(command)) return;
    } catch { /* Surface failures without discarding the draft or selection. */ }
    setError({ message: `操作未完成，请使用 ${modifier}${{ cut: "X", copy: "C", paste: "V" }[command]} 重试`, portal: context.portal });
  };

  return <>
    {context && createPortal(<div ref={menu} popover="manual" className="chat-context-menu" role="menu" aria-label="编辑菜单" tabIndex={-1}
      style={{ left: context.x, top: context.y }}
      onMouseDown={event => event.preventDefault()}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault(); context.restore(); setContext(null); return;
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const items = [...menu.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 :
            current < 0 ? (event.key === "ArrowDown" ? 0 : items.length - 1) :
            (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}>
      {context.editable && <button role="menuitem" type="button" disabled={!context.selected} onClick={() => void run("cut")}>
        <span>剪切</span><kbd>{modifier}X</kbd>
      </button>}
      <button role="menuitem" type="button" disabled={!context.selected} onClick={() => void run("copy")}>
        <span>复制</span><kbd>{modifier}C</kbd>
      </button>
      {context.editable && <button role="menuitem" type="button" onClick={() => void run("paste")}>
        <span>粘贴</span><kbd>{modifier}V</kbd>
      </button>}
      <div role="separator" />
      <button role="menuitem" type="button" disabled={!context.canSelect} onClick={() => void run("selectAll")}>
        <span>全选</span><kbd>{modifier}A</kbd>
      </button>
    </div>, context.portal)}
    {error && createPortal(<div ref={notice} popover="manual" className="chat-context-notice" role="status">{error.message}</div>, error.portal)}
  </>;
}

import useEventListener from 'ahooks/es/useEventListener';
import { useMenuDismiss } from '../hooks/use-menu-dismiss';
import { LocalFileAction } from './local-file-link';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChatEditCommand } from "../../../shared/types";

type TextField = HTMLInputElement | HTMLTextAreaElement;
type Context = {
  file?: string; x: number; y: number; editable: boolean; selected: boolean; canSelect: boolean;
  field: TextField | null; container: HTMLElement; portal: HTMLElement; target: Element; restore(): void;
};

export function EditContextMenu({ edit, onOpenChange, rootSelector = ".chat-root",
  selectionSelector = ".content, .reading-text, .panel pre" }: {
  edit(command: ChatEditCommand): Promise<boolean>;
  onOpenChange?(open: boolean): void;
  rootSelector?: string;
  selectionSelector?: string;
}) {
  const previewLocalFile = useContext(LocalFileAction);
  const [context, setContext] = useState<Context | null>(null);
  const [error, setError] = useState<{ message: string; portal: HTMLElement } | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

  useEventListener("contextmenu", (event: MouseEvent) => {
      // A component-specific menu owns events it has already handled.
      if (event.defaultPrevented) return;
      if (!(event.target instanceof Element) || !event.target.closest(rootSelector)) return;
      if (menu.current?.contains(event.target)) return;
      const file = event.target.closest<HTMLElement>("[data-local-file]")?.dataset.localFile;
      const element = event.target.closest<HTMLElement>("input, textarea, [contenteditable=true]");
      const field = element instanceof HTMLTextAreaElement ||
        (element instanceof HTMLInputElement && element.selectionStart !== null) ? element : null;
      if(element && !field && !element.isContentEditable)return;
      if(field?.disabled)return;
      const editable = field ? !field.readOnly && !field.disabled : !!element?.isContentEditable;
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      const reading=event.target.closest<HTMLElement>(selectionSelector);
      const selectedText=!!selection?.toString().trim()&&!!range&&!!reading&&
        reading.contains(range.commonAncestorContainer)&&
        !event.target.closest('button, a, summary, select, [role="button"]')&&
        [...range.getClientRects()].some(rect=>event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom);
      // One delegated listener serves dynamic fields and dialogs; blank space is never a menu target.
      if(!element && !(file&&previewLocalFile) && !selectedText){setContext(null);return;}
      event.preventDefault();
      const start = field?.selectionStart ?? 0, end = field?.selectionEnd ?? 0;
      const direction = field?.selectionDirection ?? "none";
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const container = field || element || reading || event.target as HTMLElement;
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
      setContext({ target:event.target, file, x: event.clientX, y: event.clientY, editable,
        selected: field ? end > start : element ? !!range && element.contains(range.commonAncestorContainer) && !!selection?.toString() : selectedText,
        canSelect: !!(field ? field.value : container.textContent), field, container, portal, restore });
  }, { target: document });

  useMenuDismiss(!!context, menu, () => setContext(null), event => {
    // Editor/other-panel scrolling must not dismiss a stationary menu.
    if (context && event.target instanceof Node && event.target !== context.target && event.target.contains(context.target)) setContext(null);
  });

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
    return () => { if (node.matches(":popover-open")) node.hidePopover(); };
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
      {context.file && previewLocalFile && <><button role="menuitem" type="button" onClick={() => { previewLocalFile(context.file!); setContext(null); }}>预览文件</button></>}
      {context.editable && <button role="menuitem" type="button" disabled={!context.selected} onClick={() => void run("cut")}>
        <span>剪切</span><kbd>{modifier}X</kbd>
      </button>}
      {(context.field||context.editable||context.selected)&&<button role="menuitem" type="button" disabled={!context.selected} onClick={() => void run("copy")}>
        <span>复制</span><kbd>{modifier}C</kbd>
      </button>}
      {context.editable && <button role="menuitem" type="button" onClick={() => void run("paste")}>
        <span>粘贴</span><kbd>{modifier}V</kbd>
      </button>}
      {(context.field||context.editable)&&<><div role="separator" />
      <button role="menuitem" type="button" disabled={!context.canSelect} onClick={() => void run("selectAll")}>
        <span>全选</span><kbd>{modifier}A</kbd>
      </button></>}
    </div>, context.portal)}
    {error && createPortal(<div ref={notice} popover="manual" className="chat-context-notice" role="status">{error.message}</div>, error.portal)}
  </>;
}

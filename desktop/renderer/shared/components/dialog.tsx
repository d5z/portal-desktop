import {
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
} from "react";

/** Keep the native modal stack, focus restoration, Escape and backdrop behavior. */
export function Dialog({
  open,
  onClose,
  busy = false,
  dismissOnBackdrop = false,
  children,
  ...props
}: Omit<ComponentProps<"dialog">, "open" | "onClose"> & {
  open: boolean;
  onClose: () => void;
  busy?: boolean;
  dismissOnBackdrop?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
    // Removing a still-open modal from the tree leaves Chromium's top-layer
    // backdrop painted until the next unrelated layout/paint.
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);
  return (
    <dialog
      {...props}
      ref={ref}
      data-ui-dialog
      aria-busy={busy || undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClose={() => {
        const dialog = ref.current;
        if (!open || !dialog || dialog.open) return;
        // Chromium may force a native close after repeated Escape requests.
        // Keep the controlled dialog visible until the owner accepts dismissal
        // (for example after resolving an unsaved draft or an in-flight save).
        dialog.showModal();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (!dismissOnBackdrop || busy || event.target !== event.currentTarget)
          return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      {children}
    </dialog>
  );
}

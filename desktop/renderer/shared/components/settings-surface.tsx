import type { ComponentProps } from "react";
import { Dialog } from "./dialog";

/** Reuse a settings page in the shared frame without adding another modal. */
export function SettingsSurface({ embedded = false, ...props }: ComponentProps<typeof Dialog> & { embedded?: boolean }) {
  if (!embedded) return <Dialog {...props} />;
  return <div id={props.id} className={`settings-surface ${props.className || ""}`} hidden={!props.open}>{props.children}</div>;
}

import type { ComponentProps, ReactNode } from "react";
import { Dialog } from "./dialog";

export interface SettingsDetail {
  id: string;
  title: string;
  back: () => void;
}

/** Reuse a settings page in the shared frame without adding another modal. */
export function SettingsSurface({ embedded = false, ...props }: ComponentProps<typeof Dialog> & { embedded?: boolean }) {
  if (!embedded) return <Dialog {...props} />;
  return <div id={props.id} className={`settings-surface ${props.className || ""}`} hidden={!props.open}>{props.children}</div>;
}

/** A label and its supporting copy share one column; the control owns the other. */
export function SettingsItem({ label, description, descriptionId, htmlFor, children }: {
  label: ReactNode; description?: ReactNode; descriptionId?: string; htmlFor?: string; children: ReactNode;
}) {
  const Root = htmlFor ? 'label' : 'div';
  return <Root className="settings-item" htmlFor={htmlFor}>
    <span className="settings-item-copy"><span className="settings-item-label">{label}</span>
      {description && <small id={descriptionId}>{description}</small>}
    </span>
    <span className="settings-item-control">{children}</span>
  </Root>;
}

export function SettingsField({ label, htmlFor, description, descriptionId, children }: {
  label: string; htmlFor: string; description?: ReactNode; descriptionId?: string; children: ReactNode;
}) {
  return <div className="settings-field">
    <label htmlFor={htmlFor}>{label}</label>
    {children}
    {description && <p className="field-help" id={descriptionId}>{description}</p>}
  </div>;
}

import { useState } from 'react';
import { Icon } from '../../shared/icons/icon';

/** Home owns Connector artwork; a failed or old Home icon falls back to the generic app glyph. */
export function ConnectorIcon({ name, iconURL }: { name: string; iconURL?: string | null }) {
  const [failedURL, setFailedURL] = useState<string>();
  return <span className="connector-card-icon" data-connector-name={name} aria-hidden="true">
    {iconURL && iconURL !== failedURL ? <img src={iconURL} alt="" onError={() => setFailedURL(iconURL)} /> : <Icon className="connector-line-icon" name="web-grid" />}
  </span>;
}

import type { PermissionMode } from '../../../shared/security';
import { Icon } from './icon';

export function PermissionIcon({ mode = 'auto-review' }: { mode?: PermissionMode }) {
  const name = mode === 'read-only' ? 'permission-read' : mode === 'full-access' ? 'permission-unlock' : 'permission-shield';
  return <Icon name={name} width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />;
}

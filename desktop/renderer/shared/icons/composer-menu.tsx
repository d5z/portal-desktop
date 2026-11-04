import { Icon } from './icon';

export type ComposerMenuIconKind = 'file' | 'ui' | 'image' | 'doc' | 'subagent' | 'example';
export function ComposerMenuIcon({ kind }: { kind: ComposerMenuIconKind }) {
  return <span className="composer-menu-icon" data-kind={kind} aria-hidden="true"><Icon name={`composer-${kind}`} width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></span>;
}

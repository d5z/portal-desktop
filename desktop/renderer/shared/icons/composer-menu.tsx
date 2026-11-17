import { Icon } from './icon';

export type ComposerMenuIconKind = 'file' | 'ui' | 'image' | 'doc' | 'computer' | 'subagent' | 'example';
const chatIcons = {
  file: 'chat-upload', ui: 'chat-spark', image: 'chat-image', doc: 'chat-file',
  computer: 'chat-screen', subagent: 'chat-agent', example: 'composer-example',
} as const;
export function ComposerMenuIcon({ kind, chat = false }: { kind: ComposerMenuIconKind; chat?: boolean }) {
  return <span className="composer-menu-icon" data-kind={kind} aria-hidden="true"><Icon name={chat ? chatIcons[kind] : `composer-${kind}`} width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></span>;
}

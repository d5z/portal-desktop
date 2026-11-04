import { Icon } from './icon';

export function ActivityIcon({ name }: { name: 'check' | 'think' | 'tool' | 'error' | 'stop' | 'wait' | 'chevron' }) {
  return <Icon name={`activity-${name}`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />;
}

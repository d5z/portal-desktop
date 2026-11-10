import { Icon, type IconName } from './icon';

export function NavigationIcon({ name }: { name: Extract<IconName, `rail-${string}`> | 'plugin-navigation' }) {
  return <Icon name={name} fill="none" stroke="currentColor" strokeWidth="1.6" data-navigation-icon={name} strokeLinecap="round" strokeLinejoin="round" />;
}

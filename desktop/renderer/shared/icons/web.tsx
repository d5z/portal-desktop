import type { CSSProperties } from 'react';
import { Icon as Glyph } from './icon';

const names = {
  refresh: 'web-refresh',
  install: 'web-install',
  more: 'more',
  chat: 'web-chat',
  town: 'web-town',
  discover: 'web-discover',
  settings: 'web-settings',
  fire: 'web-fire',
  people: 'web-people',
  mail: 'web-mail',
  leaf: 'web-leaf',
  book: 'web-book',
  scroll: 'web-scroll',
  grid: 'web-grid',
  arrow: 'web-arrow',
  back: 'back',
  chevron: 'web-chevron',
  sun: 'web-sun',
  moon: 'web-moon',
  search: 'web-search',
  sliders: 'web-sliders',
  link: 'web-link',
  type: 'web-type',
  info: 'web-info',
} as const;
export type IconName = keyof typeof names;

export function Icon({ name, size = 22, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <Glyph name={names[name]} width={size} height={size} style={style} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />;
}

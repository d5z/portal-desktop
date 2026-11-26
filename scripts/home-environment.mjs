import { readFileSync } from 'node:fs';

export function useDevHome(development) {
  if (!development) return false;
  try {
    const config = JSON.parse(readFileSync(new URL('../.portal-home.local.json', import.meta.url), 'utf8'));
    return config?.environment === 'dev';
  } catch {
    return false;
  }
}

import { existsSync } from 'node:fs';
import path from 'node:path';

/** Dev `npm start` with `PORTAL_DESKTOP_USER_DATA` must not auto-manage Portal alongside a packaged install. */
export function isIsolatedDevelopment(isPackaged: boolean, userDataOverride?: string) {
  return !isPackaged && Boolean(userDataOverride);
}

export function clientUserData(appData: string | (() => string), override?: string, exists = existsSync) {
  if (override) return path.resolve(override);
  const directory = typeof appData === 'function' ? appData() : appData;
  const current = path.join(directory, 'portal-desktop');
  const legacy = path.join(directory, 'Beings');
  // The product/executable rename must not turn an upgrade into a fresh setup.
  // Prefer an explicitly configured current profile, otherwise keep using the
  // legacy profile in place so encrypted credentials and recovery journals are
  // neither copied while live nor silently abandoned.
  if (!exists(path.join(current, 'connection.json')) && exists(path.join(legacy, 'connection.json'))) return legacy;
  return current;
}

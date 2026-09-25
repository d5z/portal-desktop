import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { clientUserData, isIsolatedDevelopment } from '../desktop/main/app/profile';

describe('client profile compatibility', () => {
  it('treats npm start with PORTAL_DESKTOP_USER_DATA as isolated development', () => {
    expect(isIsolatedDevelopment(false, '/tmp/dev-profile')).toBe(true);
    expect(isIsolatedDevelopment(true, '/tmp/test-profile')).toBe(false);
    expect(isIsolatedDevelopment(false, undefined)).toBe(false);
  });

  it('keeps an explicit isolated profile for tests and development', () => {
    const exists = vi.fn();
    expect(clientUserData('C:\\Users\\fixture\\AppData\\Roaming', '.\\profile', exists)).toBe(path.resolve('.\\profile'));
    const unavailable = vi.fn(() => { throw new Error("Failed to get 'appData' path"); });
    expect(clientUserData(unavailable, '.\\profile', exists)).toBe(path.resolve('.\\profile'));
    expect(unavailable).not.toHaveBeenCalled();
    expect(() => clientUserData(unavailable)).toThrow("Failed to get 'appData' path");
    expect(exists).not.toHaveBeenCalled();
  });

  it('uses the legacy Beings profile when the renamed client has no configured profile', () => {
    const appData = path.resolve('fixture-app-data');
    const exists = vi.fn((file: unknown) => String(file) === path.join(appData, 'Beings', 'connection.json'));
    expect(clientUserData(appData, undefined, exists)).toBe(path.join(appData, 'Beings'));
  });

  it('prefers the current profile once it has its own connection', () => {
    const appData = path.resolve('fixture-app-data');
    const exists = vi.fn(() => true);
    expect(clientUserData(appData, undefined, exists)).toBe(path.join(appData, 'portal-desktop'));
  });
});

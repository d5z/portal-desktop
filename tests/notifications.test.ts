import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DesktopNotifications } from '../desktop/main/app/notifications';
import { AppModel } from '../desktop/renderer/app/models/app';
import type { DesktopAPI, NotificationTarget } from '../desktop/shared/types';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'town-notifications-'));
  directories.push(directory);
  const created: (EventEmitter & { show: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> })[] = [];
  const options = { supported: vi.fn(() => true), focused: vi.fn(() => false), now: vi.fn(() => 10000), open: vi.fn(),
    create: vi.fn(() => {
      const item = Object.assign(new EventEmitter(), { show: vi.fn(), close: vi.fn() });
      created.push(item); return item;
    }) };
  const service = new DesktopNotifications(directory, options);
  await service.load(); service.reset(1);
  return { directory, service, options, created };
}
it('persists independent preferences before Being pairing, validates patches and preserves disabled categories', async () => {
  const { service, directory, options } = await fixture();
  expect(service.state.preferences).toEqual({ enabled: false, mail: false, firesides: false, bonfire: false });
  await service.save({ enabled: true, mail: true, firesides: false });
  await service.save({ enabled: false });
  const restored = new DesktopNotifications(directory, options); await restored.load();
  expect(restored.state.preferences).toMatchObject({ enabled: false, firesides: false, mail: true });
  for (const invalid of [null, [], { enabled: 'yes' }, { arbitrary: true }]) await expect(service.save(invalid)).rejects.toThrow();
  const saved = JSON.parse(await readFile(path.join(directory, 'notifications.json'), 'utf8'));
  expect(saved).toEqual(restored.state.preferences);
});
it('falls back to disabled notifications on a corrupt settings file', async () => {
  const { directory, options } = await fixture();
  await writeFile(path.join(directory, 'notifications.json'), '{broken');
  const restored = new DesktopNotifications(directory, options); await restored.load();
  expect(restored.state.preferences.enabled).toBe(false);
  expect(restored.state.message).toContain('读取失败');
  await restored.save({ enabled: true });
  expect(restored.state.message).not.toContain('读取失败');
});
it('respects master/category switches, foreground focus and system support', async () => {
  const { service, options, created } = await fixture();
  service.receive({ channel: 'mail' }); expect(created).toHaveLength(0);
  await service.save({ enabled: true });
  service.receive({ channel: 'mail' });
  service.receive({ channel: 'firesides', firesideId: '10' });
  service.receive({ channel: 'bonfire' }); expect(created).toHaveLength(0);
  await service.save({ mail: true });
  options.focused.mockReturnValue(true);
  service.receive({ channel: 'mail' }); expect(created).toHaveLength(0);
  options.focused.mockReturnValue(false); options.supported.mockReturnValue(false);
  service.receive({ channel: 'mail' }); expect(created).toHaveLength(0);
  options.supported.mockReturnValue(true);
  service.receive({ channel: 'mail' }); expect(created).toHaveLength(1);
});
it('bounds bursts, routes clicks to a fireside, and invalidates notifications on identity changes or disabling', async () => {
  const { service, options, created } = await fixture();
  await service.save({ enabled: true, mail: true, firesides: true });
  const target = { channel: 'firesides' as const, firesideId: '10' };
  service.receive(target); service.receive(target);
  expect(created).toHaveLength(1);
  created[0].emit('click'); expect(options.open).toHaveBeenCalledWith(target);
  options.open.mockClear(); options.now.mockReturnValue(16000);
  service.receive(target); service.reset(2); created[1].emit('click');
  expect(options.open).not.toHaveBeenCalled(); expect(created[1].close).toHaveBeenCalled();
  service.receive(target); await service.save({ firesides: false }); created[2].emit('click');
  expect(options.open).not.toHaveBeenCalled();
  for (let i = 0; i < 30; i++) { options.now.mockReturnValue(30000 + i * 6000); service.receive({ channel: 'mail' }); }
  expect(created.filter(item => !item.close.mock.calls.length)).toHaveLength(20);
});
it('allows foreground test notifications and handles native failures without throwing on live messages', async () => {
  const { service, options, created } = await fixture();
  expect(() => service.test()).toThrow('开启');
  await service.save({ enabled: true, mail: true }); options.focused.mockReturnValue(true);
  service.test(); expect(created[0].show).toHaveBeenCalled();
  created[0].emit('failed'); expect(service.state.message).toContain('系统未能显示');
  options.focused.mockReturnValue(false); options.create.mockImplementation(() => { throw new Error('OS failed'); });
  expect(() => service.receive({ channel: 'mail' })).not.toThrow();
});
it('opens pending notifications after initialization, choosing the inbox instead of the last sent-mail tab', async () => {
  let target: NotificationTarget | null = { channel: 'mail' };
  const model = new AppModel({ appearance: async () => 'light',
    snapshot: async () => ({ settings: { hasToken: false }, portal: {} }),
    takeNotificationTarget: async () => { const value = target; target = null; return value; },
  } as unknown as DesktopAPI);
  const show = vi.spyOn(model.town, 'show').mockImplementation(() => {});
  model.town.tabs.mail = 'sent'; model.clientSettingsOpen = true;
  await model.initialize();
  expect(model.view).toBe('mail'); expect(model.town.tabs.mail).toBe('inbox');
  expect(model.clientSettingsOpen).toBe(false);
  target = { channel: 'firesides', firesideId: '42' };
  model.town.ringSearch = 'another room';
  await model.initialize(); expect(show).toHaveBeenLastCalledWith('firesides', undefined);
  expect(model.town.selectedRing).toBe('42');
  expect(model.town.ringSearch).toBe('');
});

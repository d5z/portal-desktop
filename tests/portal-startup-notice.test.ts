import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { net, type BrowserWindow } from 'electron';
import { ClientErrorLog } from '../desktop/main/app/error-log';
import { MutationQueue } from '../desktop/main/app/mutations';
import { SettingsStore } from '../desktop/main/app/settings';
import { parseConnection } from '../desktop/main/chat/connection';
import type { ChatProxy } from '../desktop/main/chat/proxy';
import { BackgroundPortal } from '../desktop/main/portal/background';
import { createPortalController } from '../desktop/main/portal/controller';
import { PortalSupervisor } from '../desktop/main/portal/supervisor';
import type { PortalState } from '../desktop/shared/types';

vi.mock('electron', () => ({ app: { isPackaged: false }, net: { fetch: vi.fn() }, dialog: { showMessageBox: vi.fn() } }));

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture(startupNotice?: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'portal-startup-notice-'));
  const errorLog = new ClientErrorLog(directory);
  cleanups.push(async () => { await errorLog.flush(); await rm(directory, { recursive: true, force: true }); });
  const store = new SettingsStore(directory, {
    isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString(),
  }, '/unused/portal');
  store.connection = parseConnection('https://example.org/alice/?token=fixture');
  const portal = new PortalSupervisor(directory);
  const background = new BackgroundPortal(directory);
  const send = vi.fn();
  const controller = await createPortalController({
    directory, binary: '/unused/portal', store, portal, background, errorLog, startupNotice,
    mutations: new MutationQueue(), proxy: { portalStateChanged: vi.fn() } as unknown as ChatProxy,
    window: () => ({ isDestroyed: () => false, webContents: { send } }) as unknown as BrowserWindow,
    isQuitting: () => false, reusePreviousConfig: async () => {}, connectionChanged: () => {},
    cleanup: async () => {}, quit: () => {}, resumeAfterFailedShutdown: async () => {},
  });
  vi.mocked(net.fetch).mockRejectedValue(new TypeError('fetch failed'));
  await controller.restoreStartup();
  expect(controller.notice).toContain('无法验证 Being 连接');
  return { controller, store, portal, background, send };
}

it('clears the startup connection warning before a recovered background Portal notifies the renderer', async () => {
  const { controller, store, portal, background, send } = await fixture();
  const observe = vi.spyOn(background, 'observe').mockResolvedValue({
    portal: { phase: 'connected', beingEndpoint: store.connection!.endpoint, message: '已连接', logs: [] },
    background: background.state, stoppedSince: undefined,
  });
  send.mockImplementation(() => expect(controller.notice).toBeUndefined());
  vi.useFakeTimers();
  const stop = controller.startPolling();
  try {
    await vi.advanceTimersByTimeAsync(1000);
    expect(observe).toHaveBeenCalledOnce();
    expect(portal.state.phase).toBe('connected');
    expect(send).toHaveBeenCalledWith('beings:portal-state', expect.objectContaining({ phase: 'connected' }));
    portal.emit('state', { ...portal.state, phase: 'reconnecting' });
    expect(controller.notice).toBeUndefined();
  } finally { stop(); }
});

it('retains the warning until the same Being is connected and preserves unrelated startup notices', async () => {
  const { controller, store, portal } = await fixture('其他配置需要处理');
  const state: PortalState = { phase: 'running', beingEndpoint: store.connection!.endpoint, message: '运行中', logs: [] };
  portal.emit('state', state);
  expect(controller.notice).toContain('无法验证 Being 连接');
  portal.emit('state', { ...state, phase: 'connected', beingEndpoint: 'https://example.org/other' });
  expect(controller.notice).toContain('无法验证 Being 连接');
  portal.emit('state', { ...state, phase: 'connected' });
  expect(controller.notice).toBe('其他配置需要处理');
});

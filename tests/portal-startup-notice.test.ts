import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
  return { controller, store, portal, background, send, errorLog };
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

it('logs connection checks and real state changes without duplicating polling or engine output', async () => {
  const { portal, store, errorLog } = await fixture();
  const state: PortalState = { phase: 'reconnecting', beingEndpoint: store.connection!.endpoint,
    pid: 123, managed: true, message: 'Relay 正在重试', logs: ['private engine output'] };
  portal.emit('state', state);
  portal.emit('state', { ...state, logs: ['more engine output'] });
  portal.emit('state', { ...state, phase: 'connected', message: '已连接' });
  await errorLog.flush();
  const log = await readFile(errorLog.runtimeFile, 'utf8');
  expect(log).toContain('[portal-being-check]');
  expect(log).toContain('"stage":"request"');
  expect(log.match(/\[portal-state-change\]/g)).toHaveLength(2);
  expect(log).toContain('"pid":123');
  expect(log).not.toMatch(/private engine output|more engine output|\?token=/);
});

it('captures an error summary once per state change while engine logs keep arriving', async () => {
  const { portal, store, errorLog } = await fixture();
  const report = vi.spyOn(errorLog, 'report');
  const state: PortalState = { phase: 'error', beingEndpoint: store.connection!.endpoint,
    pid: 123, managed: true, message: 'Relay 拒绝了 Portal 握手，仍在自动重试。', logs: ['first rejection'] };
  portal.emit('state', state);
  portal.emit('state', { ...state, logs: ['first rejection', 'retry scheduled'] });
  portal.emit('state', { ...state, logs: ['first rejection', 'retry scheduled', 'more output'] });
  expect(report.mock.calls.filter(([context]) => context === 'portal-runtime')).toEqual([
    ['portal-runtime', 'first rejection'],
  ]);
  portal.emit('state', { ...state, pid: 456, logs: ['new process rejection'] });
  expect(report.mock.calls.filter(([context]) => context === 'portal-runtime')).toHaveLength(2);
});

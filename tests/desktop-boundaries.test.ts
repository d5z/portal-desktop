import { EventEmitter } from 'node:events';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientErrorLog } from '../desktop/main/app/error-log';
import { createTrustedHandler } from '../desktop/main/app/ipc';
import { DesktopLifecycle } from '../desktop/main/app/lifecycle';
import { MutationQueue } from '../desktop/main/app/mutations';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>(),
  app: undefined as unknown as EventEmitter & { whenReady: () => Promise<void>; quit: ReturnType<typeof vi.fn> },
  createWindow: vi.fn(),
  messageBox: vi.fn(async () => ({ response: 0 })),
}));
vi.mock('electron', () => ({
  get app() { return mocks.app; },
  ipcMain: { handle: (channel: string, callback: (event: IpcMainInvokeEvent) => Promise<unknown>) => mocks.handlers.set(channel, callback) },
  dialog: { showMessageBox: mocks.messageBox, showErrorBox: vi.fn() },
}));
vi.mock('../desktop/main/app/window', () => ({ createMainWindow: mocks.createWindow }));

const log = () => ({ info: vi.fn(), report: vi.fn(() => 'redacted error'), flush: vi.fn(async () => {}) }) as unknown as ClientErrorLog;
const eventFor = (sender: unknown, senderFrame: unknown) => ({ sender, senderFrame }) as IpcMainInvokeEvent;

beforeEach(() => {
  mocks.handlers.clear();
  mocks.app = Object.assign(new EventEmitter(), { whenReady: () => new Promise<void>(() => {}), quit: vi.fn() });
  mocks.createWindow.mockReset();
  mocks.messageBox.mockClear();
});

describe('desktop mutation serialization', () => {
  it('serializes failures and later work, retaining a revision while reads are in flight', async () => {
    const queue = new MutationQueue();
    const initialRevision = queue.revision;
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = queue.run(async () => { order.push('first'); await gate; throw new Error('failed'); });
    const rejection = expect(first).rejects.toThrow('failed');
    const second = queue.run(async () => { order.push('second'); return 42; });
    expect(queue.pending).toBe(2);
    expect(queue.revision).not.toBe(initialRevision);
    await Promise.resolve();
    expect(order).toEqual(['first']);
    release();
    await rejection;
    expect(await second).toBe(42);
    await queue.revision;
    expect(queue.pending).toBe(0);
    expect(order).toEqual(['first', 'second']);
  });
});

describe('trusted desktop IPC', () => {
  const setup = () => {
    const frame = { url: 'beings://desktop/' };
    const contents = { mainFrame: frame };
    let window = { webContents: contents } as unknown as BrowserWindow | null;
    const state = { quitting: false, blocked: false };
    const errorLog = log();
    const handle = createTrustedHandler({ window: () => window, shellURL: () => 'beings://desktop/',
      isQuitting: () => state.quitting, recoveryBlocked: () => state.blocked, errorLog });
    const callback = vi.fn(async () => 'allowed');
    for (const channel of ['beings:save', 'beings:portal-start', 'beings:portal-stop', 'beings:portal-force-start', 'beings:diagnostics', 'beings:browser-bounds']) handle(channel, callback);
    const invoke = (channel = 'beings:save', event = eventFor(contents, frame)) => mocks.handlers.get(channel)!(event);
    return { frame, contents, state, callback, handle, invoke, errorLog, close: () => { window = null; } };
  };

  it('rejects another window, child frames, navigated shells and closed windows before invoking capabilities', async () => {
    const fixture = setup();
    await expect(fixture.invoke('beings:save', eventFor({}, fixture.frame))).rejects.toThrow('Untrusted');
    await expect(fixture.invoke('beings:save', eventFor(fixture.contents, { url: fixture.frame.url }))).rejects.toThrow('Untrusted');
    fixture.frame.url = 'beings://desktop/?untrusted';
    await expect(fixture.invoke()).rejects.toThrow('Untrusted');
    fixture.frame.url = 'beings://desktop/';
    fixture.close();
    await expect(fixture.invoke()).rejects.toThrow('Untrusted');
    expect(fixture.callback).not.toHaveBeenCalled();
  });

  it('reads live shutdown and recovery flags while keeping manual recovery available', async () => {
    const fixture = setup();
    expect(await fixture.invoke()).toBe('allowed');
    fixture.state.blocked = true;
    for (const channel of ['beings:save', 'beings:portal-stop', 'beings:portal-force-start']) await expect(fixture.invoke(channel)).rejects.toThrow('升级恢复');
    expect(await fixture.invoke('beings:portal-start')).toBe('allowed');
    fixture.state.blocked = false;
    expect(await fixture.invoke()).toBe('allowed');
    fixture.state.quitting = true;
    await expect(fixture.invoke('beings:portal-start')).rejects.toThrow('正在退出');
    expect(await fixture.invoke('beings:diagnostics')).toBe('allowed');
    expect(await fixture.invoke('beings:browser-bounds')).toBe('allowed');
  });

  it('reports capability failures without leaking the original message', async () => {
    const fixture = setup();
    fixture.handle('beings:failure', () => { throw new Error('private credential'); });
    await expect(fixture.invoke('beings:failure')).rejects.toThrow('redacted error');
    expect(fixture.errorLog.report).toHaveBeenCalledWith('beings:failure', expect.any(Error));
  });
});

describe('desktop lifecycle', () => {
  const setup = () => {
    const queue = new MutationQueue();
    const options = {
      clientName: 'Test Desktop', shellURL: () => 'beings://desktop/', errorLog: log(), exclusive: queue.run,
      canCleanup: () => true, cleanup: vi.fn(async () => {}), finishServices: vi.fn(),
      resumeAfterFailedShutdown: vi.fn(async () => {}), cancelPairing: vi.fn(), closePluginSessions: vi.fn(),
      recoverPlugins: vi.fn(), matchesPlugin: () => false,
    };
    const lifecycle = new DesktopLifecycle(options);
    lifecycle.start(async () => {});
    return { queue, options, lifecycle };
  };

  it('defers second-launch visibility until the shell is ready and reuses its native window', () => {
    const { lifecycle } = setup();
    const window = Object.assign(new EventEmitter(), {
      webContents: new EventEmitter(), isDestroyed: () => false, isMinimized: () => false,
      show: vi.fn(), focus: vi.fn(),
    });
    mocks.createWindow.mockReturnValue({ window, browser: {} });
    mocks.app.emit('second-instance', {}, []);
    expect(mocks.createWindow).not.toHaveBeenCalled();
    lifecycle.openWhenReady();
    mocks.app.emit('second-instance', {}, []);
    expect(mocks.createWindow).toHaveBeenCalledTimes(1);
    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
  });

  it('retains an installer request arriving before startup registers its shutdown callback', async () => {
    const { lifecycle, queue } = setup();
    const shutdown = vi.fn(async () => {});
    mocks.app.emit('second-instance', {}, ['--prepare-installer=0.1.12']);
    lifecycle.setInstallerShutdown(shutdown);
    await queue.revision;
    expect(shutdown).toHaveBeenCalledExactlyOnceWith('0.1.12');
  });

  it('resumes after failed cleanup and permits an explicit retry', async () => {
    const { lifecycle, options, queue } = setup();
    options.cleanup.mockRejectedValueOnce(new Error('stop failed'));
    const event = { preventDefault: vi.fn() };
    mocks.app.emit('before-quit', event);
    await queue.revision;
    await vi.waitFor(() => expect(lifecycle.error).toContain('退出未完成'));
    expect(lifecycle.quitting).toBe(false);
    expect(options.resumeAfterFailedShutdown).toHaveBeenCalledOnce();
    expect(mocks.app.quit).not.toHaveBeenCalled();
    mocks.app.emit('before-quit', event);
    await vi.waitFor(() => expect(mocks.app.quit).toHaveBeenCalledOnce());
    expect(options.finishServices).toHaveBeenCalledOnce();
    expect(options.cleanup).toHaveBeenCalledTimes(2);
    expect(lifecycle.quitting).toBe(true);
    const finalEvent = { preventDefault: vi.fn() };
    mocks.app.emit('before-quit', finalEvent);
    expect(finalEvent.preventDefault).not.toHaveBeenCalled();
  });
});

describe('Portal save input boundary', () => {
  it('rejects invalid setup before cancelling current work and forwards valid input', async () => {
    const { registerPortalIpc } = await import('../desktop/main/portal/ipc');
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const order: string[] = [];
    const save = vi.fn(async () => { order.push('save'); });
    registerPortalIpc({
      handle: (channel, callback) => { handlers.set(channel, callback); },
      exclusive: new MutationQueue().run,
      controller: { save } as unknown as import('../desktop/main/portal/controller').PortalController,
      beforeSave: () => { order.push('before'); },
      afterSave: async () => { await new Promise(resolve => setTimeout(resolve, 0)); order.push('after'); },
      snapshot: () => { order.push('snapshot'); return {} as import('../desktop/shared/types').Snapshot; },
    });
    const invoke = handlers.get('beings:save')!;
    await expect(invoke({ subagentEnabled: 'yes' })).rejects.toThrow('开关状态');
    await expect(invoke({ subagentSetup: { provider: 'unknown' } })).rejects.toThrow('提供商');
    expect(order).toEqual([]);
    expect(save).not.toHaveBeenCalled();
    const input = { workspace: '', portalBinary: '', portalName: '', autoStart: false, allowExec: true, kitsEnabled: true,
      subagentEnabled: false, subagentSetup: { provider: 'openai', model: 'fixture', api_key: '', thinking: 'medium' } };
    await invoke(input);
    expect(save).toHaveBeenCalledExactlyOnceWith(input);
    expect(order).toEqual(['before', 'save', 'after', 'snapshot']);
  });
});

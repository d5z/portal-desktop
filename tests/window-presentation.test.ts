import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { windowPresentation } from '../desktop/main/app/window-presentation';

const fixture = (platform: NodeJS.Platform = 'darwin') => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn(() => false), isMinimized: vi.fn(() => false),
    isResizable: vi.fn(() => true),
    isFullScreen: vi.fn(() => false), isFullScreenable: vi.fn(() => true),
    setFullScreen: vi.fn(), setFullScreenable: vi.fn(),
    show: vi.fn(), hide: vi.fn(), focus: vi.fn(), restore: vi.fn(),
  });
  const presentation = windowPresentation(window as unknown as BrowserWindow);
  return { window, presentation };
};

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it.each(['darwin', 'win32', 'linux'] as const)('keeps ordinary %s close/show synchronous', async platform => {
  const { window, presentation } = fixture(platform);
  const hidden = presentation.hide();
  expect(window.hide).toHaveBeenCalledOnce();
  await hidden;
  window.isMinimized.mockReturnValue(true);
  presentation.show();
  expect(window.restore).toHaveBeenCalledOnce();
  expect(window.show).toHaveBeenCalledOnce();
  expect(window.setFullScreen).not.toHaveBeenCalled();
});

it('waits for native completion even after isFullScreen becomes false', async () => {
  const { window, presentation } = fixture();
  window.emit('enter-full-screen');
  const hidden = presentation.hide();
  await presentation.hide();
  expect(window.setFullScreen).toHaveBeenCalledExactlyOnceWith(false);
  expect(window.hide).not.toHaveBeenCalled();
  window.emit('leave-full-screen');
  await presentation.hide(); // Deferred native close in the same callback.
  expect(window.hide).not.toHaveBeenCalled();
  await hidden;
  expect(window.hide).toHaveBeenCalledOnce();
});

it('honors a show request during close instead of hiding the reopened window', async () => {
  const { window, presentation } = fixture();
  window.isFullScreen.mockReturnValue(true);
  const hidden = presentation.hide();
  presentation.show();
  expect(window.show).not.toHaveBeenCalled();
  window.isFullScreen.mockReturnValue(false);
  window.emit('leave-full-screen');
  await hidden;
  expect(window.hide).not.toHaveBeenCalled();
  expect(window.show).toHaveBeenCalledOnce();
});

it('waits through fullscreen entry before the native fullscreen flag changes', async () => {
  const { window, presentation } = fixture();
  window.isResizable.mockReturnValue(false);
  const quitting = presentation.prepareForQuit();
  expect(window.setFullScreen).toHaveBeenCalledWith(false);
  expect(window.setFullScreenable).not.toHaveBeenCalled();
  window.emit('enter-full-screen');
  window.emit('leave-full-screen');
  await quitting;
  expect(window.setFullScreenable).toHaveBeenCalledWith(false);
});

it('gives quit priority over pending hide and activation, sharing one exit', async () => {
  const { window, presentation } = fixture();
  window.isFullScreen.mockReturnValue(true);
  const hidden = presentation.hide();
  const quitting = presentation.prepareForQuit();
  presentation.show();
  expect(window.setFullScreen).toHaveBeenCalledOnce();
  window.emit('leave-full-screen');
  await Promise.all([hidden, quitting]);
  expect(window.hide).not.toHaveBeenCalled();
  expect(window.show).not.toHaveBeenCalled();
  expect(window.setFullScreenable).toHaveBeenCalledExactlyOnceWith(false);
  presentation.cancelQuit();
  expect(window.setFullScreenable).toHaveBeenLastCalledWith(true);
  expect(window.show).not.toHaveBeenCalled();
  presentation.show();
  expect(window.show).toHaveBeenCalledOnce();
});

it('preserves an originally disabled fullscreen button after failed shutdown', async () => {
  const { window, presentation } = fixture();
  window.isFullScreenable.mockReturnValue(false);
  await presentation.prepareForQuit();
  presentation.cancelQuit();
  expect(window.setFullScreenable).toHaveBeenLastCalledWith(false);
});

it('releases the pending operation when its window closes', async () => {
  const { window, presentation } = fixture();
  window.isFullScreen.mockReturnValue(true);
  const quitting = presentation.prepareForQuit();
  window.isDestroyed.mockReturnValue(true);
  window.emit('closed');
  await quitting;
  expect(window.setFullScreenable).not.toHaveBeenCalled();
  expect(window.listenerCount('leave-full-screen')).toBe(1); // Permanent state listener only.
});

it('fails an uncompleted native transition and permits a later retry', async () => {
  vi.useFakeTimers();
  const { window, presentation } = fixture();
  window.isFullScreen.mockReturnValue(true);
  const quitting = presentation.prepareForQuit();
  const rejection = expect(quitting).rejects.toThrow('退出 macOS 全屏未完成');
  await vi.advanceTimersByTimeAsync(10_001);
  await rejection;
  presentation.cancelQuit();
  expect(window.show).not.toHaveBeenCalled();
  const retry = presentation.prepareForQuit();
  window.emit('leave-full-screen');
  await vi.runAllTimersAsync();
  await retry;
  expect(window.setFullScreen).toHaveBeenCalledTimes(2);
});

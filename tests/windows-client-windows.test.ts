import { expect, it, vi } from 'vitest';
import { _electron as electron } from 'playwright';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertSingleClientWindow, clientWindowSnapshot, isClientMainWindow } from './support/windows-client-windows.mjs';

it.skipIf(process.platform !== 'win32')('ignores real Chromium tooltips but rejects duplicate or missing client windows', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portal-native-windows-'));
  let app;
  try {
    const entry = path.join(root, 'main.cjs');
    await writeFile(entry, `const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(root, 'profile'))});
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  globalThis.main = new BrowserWindow({ width: 600, height: 400 });
  await main.loadURL('data:text/html,<title>Client window fixture</title><button title="Native tooltip fixture" style="width:200px;height:100px">Hover</button>');
});`);
    app = await electron.launch({ args: [entry] });
    const page = await app.firstWindow();
    const pid = await app.evaluate(() => process.pid);
    await assertSingleClientWindow(pid);
    await page.getByRole('button', { name: 'Hover', exact: true }).hover();
    // Let Windows' hover delay elapse before launching the native inspector.
    await page.waitForTimeout(1500);
    await vi.waitFor(async () => {
      const windows = await clientWindowSnapshot(pid);
      const visible = windows.filter(window => window.visible && window.className === 'Chrome_WidgetWin_1');
      // The old class-name-only assertion counts the native tooltip as a second
      // client. Keep that window present while checking the new classification.
      expect(visible).toHaveLength(2);
      expect(visible.filter(isClientMainWindow)).toHaveLength(1);
    }, { timeout: 10_000, interval: 100 });
    await assertSingleClientWindow(pid);
    await page.mouse.move(400, 300);
    await app.evaluate(({ BrowserWindow }) => {
      const duplicate = new BrowserWindow({ width: 600, height: 400, title: 'Client window fixture' });
      // A background reader should not count until it becomes visible.
      new BrowserWindow({ show: false, title: 'Hidden reader' });
      return duplicate.id;
    });
    await expect(assertSingleClientWindow(pid)).rejects.toThrow('exactly one visible main window');
    const windows = await clientWindowSnapshot(pid);
    expect(windows.filter(isClientMainWindow)).toHaveLength(2);
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.hide();
    });
    await expect(assertSingleClientWindow(pid)).rejects.toThrow('exactly one visible main window');
  } finally {
    await app?.close();
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
}, 45_000);

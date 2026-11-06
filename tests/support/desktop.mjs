import path from 'node:path';
import { access, readFile } from 'node:fs/promises';

// A fixture's main.js is temporary; production Forge starts from the application root.
export const desktopFixtureBanner = { js: `require('electron').app.setAppPath(${JSON.stringify(path.resolve('.'))});` };

export async function desktopExecutable() {
  const { productName } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const executable = process.env.PORTAL_DESKTOP_EXECUTABLE || (process.platform === 'darwin'
    ? path.resolve(`out/${productName}-darwin-${process.arch}/${productName}.app/Contents/MacOS/${productName}`)
    : path.resolve(`out/${productName}-${process.platform}-${process.arch}`, process.platform === 'win32' ? 'portal-desktop.exe' : 'portal-desktop'));
  try { await access(executable); }
  catch { throw new Error(`客户端测试包不存在，请先运行 npm run package：${executable}`); }
  return executable;
}

export async function waitForChatReady(page) {
  await page.frameLocator('#chat-frame').locator('#input').waitFor();
  const frame = page.frames().find(candidate => candidate.url().startsWith('beings://chat/'));
  if (!frame) throw new Error('Chat frame did not load.');
  // DOM visibility precedes history/stream restoration and the final autofocus.
  // Wait for Loom's existing readiness mark before interacting with shell menus.
  await frame.waitForFunction(() => performance.getEntriesByName('loom:ready').length > 0);
}

export async function clickChatControl(page, selector) {
  await clickWhenPointerReady(page, page.frameLocator('#chat-frame').locator(selector));
}

export async function openNavigation(page, name) {
  const pinned = page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true });
  if (await pinned.isVisible()) return pinned.click();
  await page.locator('#rail-more-trigger').click();
  await page.getByRole('dialog', { name: '更多功能' }).getByRole('button', { name, exact: true }).click();
}

export async function clickWhenPointerReady(page, control) {
  // After a native dialog closes, DOM hit testing can become ready before
  // Electron presents the new surface (observed on Intel macOS CI). Move
  // the pointer until the control acknowledges hover, then click exactly once.
  // Retrying only pointer movement cannot open/close a place twice.
  const deadline = Date.now() + 15000;
  let moves = 0;
  while (Date.now() < deadline) {
    moves++;
    await control.hover({ timeout: Math.max(1, deadline - Date.now()) });
    if (await control.evaluate(element => element.matches(':hover'))) {
      if (moves > 1) console.log(`Pointer ready after ${moves} moves: ${control}`);
      await control.click();
      return;
    }
    await page.waitForTimeout(50);
  }
  throw new Error(`Control did not receive pointer input: ${control}`);
}

export function backgroundCoverage() {
  if (process.env.PORTAL_DESKTOP_TEST_BACKGROUND === '0') return { enabled: false, reason: 'PORTAL_DESKTOP_TEST_BACKGROUND=0：当前运行环境不执行真实系统登录服务测试' };
  if (process.platform !== 'darwin') return { enabled: false, reason: '本桌面 E2E 的系统登录服务分支仅支持 macOS；Windows 真实计划任务与 Portal 安装升级由 test:windows-upgrade 和 native upgrade tests 单独验证' };
  return { enabled: true };
}

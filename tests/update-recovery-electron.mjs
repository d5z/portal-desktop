// Exercise the production main process/preload and mutation queue. Only network,
// credentials, dialogs and the OS stop command are fixtures; native service
// replacement/rollback is covered by runtime-update-native.test.ts.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import electron from 'electron';
import { desktopFixtureBanner } from './support/desktop.mjs';
import { launchDesktop } from './support/electron-lifecycle.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'town-update-recovery-'));
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><title>Upgrade recovery IPC fixture</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const shell = `http://127.0.0.1:${server.address().port}/`;
let app;
const json = async file => JSON.parse(await readFile(file, 'utf8'));
try {
  await build({ entryPoints: ['desktop/preload/preload.ts'], bundle: true, platform: 'node', format: 'cjs',
    external: ['electron'], outfile: path.join(root, 'preload.js') });
  await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { app, dialog, net, safeStorage } from 'electron';
    import { BackgroundPortal } from './desktop/main/portal/background';
    safeStorage.isEncryptionAvailable = () => true;
    safeStorage.encryptString = text => Buffer.from(text);
    safeStorage.decryptString = bytes => bytes.toString();
    dialog.showMessageBox = async () => ({ response: 0 });
    dialog.showErrorBox = (title, message) => { console.error(title, message); app.exit(1); };
    const fetch = net.fetch.bind(net);
    net.fetch = async (url, options) => {
      const address = typeof url === 'string' ? url : url.url;
      if (address.startsWith(${JSON.stringify(shell)})) return fetch(url, options);
      if (address.startsWith('https://api.github.com/repos/fixture/releases/')) {
        globalThis.releaseChecks = (globalThis.releaseChecks || 0) + 1;
        await new Promise(resolve => { globalThis.releaseCheck = resolve; });
        return Response.json({ tag_name: 'v99.0.0', assets: [
          { name: process.platform === 'darwin' ? 'portal-desktop-99.0.0-macos-' + process.arch + '.zip' : 'portal-desktop-99.0.0-windows-x64-Setup.exe' },
          { name: 'SHA256SUMS.txt' },
        ] });
      }
      if (address.startsWith('https://fixture.invalid/') && process.env.RECOVERY_OFFLINE !== '1')
        return Response.json({ being_name: 'fixture' });
      return new Response('Fixture offline', { status: 503 });
    };
    globalThis.stoppedCandidates = [];
    BackgroundPortal.prototype.unload = async function(service) { globalThis.stoppedCandidates.push(service.root); };
    require('./desktop/main/main');
  ` }, bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'bufferutil', 'utf-8-validate'],
    banner: desktopFixtureBanner,
    define: { PORTAL_DESKTOP_DEV_ASSETS: JSON.stringify(path.resolve('desktop/generated')), MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify(shell), MAIN_WINDOW_VITE_NAME: '"main_window"',
      PORTAL_DESKTOP_BUILD: '"recovery-test"', PORTAL_DESKTOP_UPDATE_REPOSITORY: '"fixture/releases"' },
    plugins: [{ name: 'installer-boundary-fixture', setup(build) {
      // Replace only main's staging boundary. The production update checker,
      // IPC handlers, cancellation and shutdown orchestration remain intact.
      build.onResolve({ filter: /^\.\/manual-installer$/ }, args => /updates[\\/]desktop\.ts$/.test(args.importer) ? { path: 'installer', namespace: 'fixture' } : undefined);
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        export async function stageInstaller() {
          globalThis.stagedInstallers = (globalThis.stagedInstallers || 0) + 1;
          return Object.assign(async () => {
            globalThis.handoffAttempts = (globalThis.handoffAttempts || 0) + 1;
            if (globalThis.failHandoff) throw new Error('fixture handoff failed');
          }, { discard: async () => {} });
        }
      `, loader: 'ts' }));
    } }],
    loader: { '.py': 'text', '.ps1': 'text' }, outfile: path.join(root, 'main.cjs') });

  for (const scenario of ['paused-install', 'offline-rollback', 'retry-rollback', 'download-race']) {
    const profile = path.join(root, scenario);
    await mkdir(profile);
    await writeFile(path.join(profile, 'connection.json'), JSON.stringify({ version: 1,
      settings: { workspace: root, portalName: 'fixture', autoStart: false, backgroundEnabled: false, allowExec: false, kitsEnabled: false },
      credential: Buffer.from(JSON.stringify({ link: 'https://fixture.invalid/fixture/?token=fixture' })).toString('base64') }));
    const installFile = path.join(profile, 'client-install.json');
    await writeFile(installFile, JSON.stringify({ schema: 1, from: '0.1.10', target: '0.1.11', foreground: false, services: [] }));
    const hold = JSON.stringify({ schema: 1, identity: 'fixture.invalid/fixture', phase: 'blocked', replacing: false,
      message: 'subagent 安装或配置失败。请检查 npm、网络和模型配置；可取消勾选后先连接 Being。' });
    await writeFile(path.join(profile, 'portal-takeover.json'), hold);
    const journalFile = path.join(profile, 'runtime-update.json');
    const previous = { label: 'isolated-fixture', root: path.join(profile, 'external'), file: path.join(profile, 'launch.plist'), existing: true };
    const candidate = { ...previous, root: path.join(profile, 'portal-service/candidate'), existing: false };
    const journal = JSON.stringify({ schema: 1, previous, candidate, enabled: false });
    if (scenario === 'offline-rollback' || scenario === 'retry-rollback') await writeFile(journalFile, scenario === 'retry-rollback' ? '{"schema":9}' : journal);
    app = await launchDesktop({ executablePath: electron, args: [path.join(root, 'main.cjs')],
      env: { ...process.env, PORTAL_DESKTOP_USER_DATA: profile, RECOVERY_OFFLINE: scenario === 'paused-install' ? '0' : '1' } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean(window.beings));
    // snapshot queues behind startup, so all startup decisions are complete.
    const state = await page.evaluate(() => window.beings.snapshot());
    if (scenario === 'retry-rollback') {
      assert.equal(state.portal.phase, 'error');
      assert.deepEqual(await json(journalFile), { schema: 9 });
      await writeFile(journalFile, journal);
      // The trusted manual entry must retry local rollback before the offline
      // connection check, even though startup marked recovery as blocked.
      await assert.rejects(page.evaluate(() => window.beings.startPortal()), /连接|Being/);
    } else if (scenario === 'paused-install') {
      assert.equal(state.portal.phase, 'error');
      assert.equal((await json(installFile)).target, '0.1.11');
    }
    if (scenario === 'offline-rollback' || scenario === 'retry-rollback') {
      await assert.rejects(readFile(journalFile), { code: 'ENOENT' });
      assert.deepEqual(await app.evaluate(() => globalThis.stoppedCandidates), [candidate.root]);
    }
    if (scenario === 'download-race') {
      // Startup used development paths. Only enable the download gate after
      // initialization; this never stages or replaces a real application.
      await app.evaluate(({ app }) => { Object.defineProperty(app, 'isPackaged', { value: true }); });
      const cancelled = page.evaluate(() => Promise.all([window.beings.downloadUpdate(), window.beings.downloadUpdate()]));
      await page.waitForFunction(async () => (await window.beings.updateState()).phase === 'checking');
      await page.evaluate(() => window.beings.cancelUpdate());
      await app.evaluate(() => globalThis.releaseCheck());
      await cancelled;
      assert.equal(await app.evaluate(() => globalThis.stagedInstallers || 0), 0);
      const checking = page.evaluate(() => window.beings.checkUpdates());
      await page.waitForFunction(async () => (await window.beings.updateState()).phase === 'checking');
      const downloads = page.evaluate(() => Promise.all([window.beings.downloadUpdate(), window.beings.downloadUpdate()]));
      // Ensure both renderer IPC calls are delivered before resolving metadata.
      await page.evaluate(() => window.beings.snapshot());
      await app.evaluate(() => globalThis.releaseCheck());
      await checking; await downloads;
      assert.equal(await app.evaluate(() => globalThis.stagedInstallers), 1);
      assert.equal((await page.evaluate(() => window.beings.updateState())).activity.phase, 'ready');
      await app.evaluate(() => { globalThis.failHandoff = true; });
      await assert.rejects(page.evaluate(() => window.beings.installUpdate()), /handoff failed/);
      assert.equal((await page.evaluate(() => window.beings.updateState())).activity.phase, 'ready');
      await app.evaluate(() => { globalThis.failHandoff = false; });
      const closed = app.waitForEvent('close', { timeout: 15000 });
      const installing = page.evaluate(() => window.beings.installUpdate()).catch(error => {
        if (!/closed|destroyed/i.test(String(error))) throw error;
      });
      await closed; await installing; app = undefined;
      assert.equal((await json(installFile)).target, '99.0.0');
      console.log('PASS: concurrent downloads, cancellation during metadata, failed handoff and successful in-app retry');
      continue;
    }
    // The installer-control entry uses the same prepare/recovery/shutdown path
    // as the downloaded installer, without replacing any real application.
    const closed = app.waitForEvent('close', { timeout: 15000 });
    await app.evaluate(({ app }) => app.emit('second-instance', {}, ['fixture', '--prepare-installer=0.1.12']));
    await closed;
    app = undefined;
    assert.equal((await json(installFile)).target, '0.1.12');
    assert.equal(await readFile(path.join(profile, 'portal-takeover.json'), 'utf8'), hold);
    console.log(`PASS: production main/preload ${scenario}, safe installer shutdown and retained takeover decision`);
  }
} finally {
  if (app) await app.close();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}

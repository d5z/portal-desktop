// Real renderer, preload and IPC; log fixtures and file-manager calls stay isolated.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { build as buildRenderer } from 'vite';
import electron from 'electron';
import { strFromU8, unzipSync } from 'fflate';
import { launchDesktop } from './support/electron-lifecycle.mjs';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'client-logs-ui-'));
let app;
try {
  const assets = path.join(temporary, 'renderer'), buildDirectory = path.join(temporary, 'build');
  const profile = path.join(temporary, 'profile'), downloads = path.join(temporary, 'downloads');
  await mkdir(path.join(profile, 'logs'), { recursive: true });
  await mkdir(downloads);
  await writeFile(path.join(profile, 'logs/client-errors.log'), 'fixture client failure\n');
  await writeFile(path.join(profile, 'logs/client-runtime.log.previous'), 'first client startup\n' + 'normal client output\n'.repeat(220000) + 'last client event\n');
  await writeFile(path.join(profile, 'portal.log'), 'fixture Portal output\n'.repeat(12000) + 'Authorization: Bearer private-fixture\n');
  await writeFile(path.join(profile, 'connection.url'), 'private connection file');
  await buildRenderer({ configFile: path.resolve('vite.renderer.config.ts'), build: { outDir: assets } });
  await build({ entryPoints: ['desktop/main/main.ts'], outfile: path.join(buildDirectory, 'main.js'),
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'], loader: { '.py': 'text', '.ps1': 'text' },
    define: { MAIN_WINDOW_VITE_DEV_SERVER_URL: 'undefined', MAIN_WINDOW_VITE_NAME: '"main_window"',
      PORTAL_DESKTOP_BUILD: '"logs-test"', PORTAL_DESKTOP_UPDATE_REPOSITORY: '"fixture/repo"' },
    plugins: [{ name: 'local-assets', setup(build) {
      build.onLoad({ filter: /desktop[\\/]main[\\/]main\.ts$/ }, async args => ({
        contents: (await readFile(args.path, 'utf8')).replace("path.resolve('desktop/generated')", JSON.stringify(assets)), loader: 'ts',
      }));
    } }],
  });
  await build({ entryPoints: ['desktop/preload/preload.ts'], outfile: path.join(buildDirectory, 'preload.js'),
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  app = await launchDesktop({ executablePath: electron, args: [path.join(buildDirectory, 'main.js')],
    env: { ...process.env, PORTAL_DESKTOP_USER_DATA: profile } });
  await app.evaluate(({ app, shell }, downloads) => {
    app.setPath('downloads', downloads);
    shell.showItemInFolder = file => { globalThis.revealedArchive = file; };
  }, downloads);
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('#options-trigger').click();
  await page.getByRole('button', { name: '收集日志', exact: true }).click();
  await page.getByText('日志已打包，已在下载文件夹中显示。', { exact: true }).waitFor();
  const file = await app.evaluate(() => globalThis.revealedArchive);
  assert.equal(path.dirname(file), downloads);
  assert.match(file, /Portal-Desktop-logs-.*\.zip$/);
  const files = unzipSync(await readFile(file));
  assert.match(strFromU8(files['client/client-errors.log']), /fixture client failure/);
  assert.match(strFromU8(files['client/client-runtime.log']), /\[client-start\]/);
  const completeLog = strFromU8(files['client/client-runtime.log.previous']);
  assert(completeLog.startsWith('first client startup\n'));
  assert(completeLog.endsWith('last client event\n'));
  assert(completeLog.length > 4 * 1024 * 1024);
  assert.match(strFromU8(files['portal/runtime-1/portal.log']), /fixture Portal output/);
  assert(!strFromU8(files['portal/runtime-1/portal.log']).includes('private-fixture'));
  assert(files['portal/portal-runtime.log']); assert(files['portal/portal-status.json']);
  assert(!Object.keys(files).some(name => name.endsWith('connection.url')));
  assert.equal(await page.getByRole('button', { name: '收集日志', exact: true }).isEnabled(), true);
  assert.deepEqual(errors, []);
  console.log('PASS: More menu collects client and Portal logs into a redacted ZIP and reveals it through the native shell.');
} finally {
  if (app) await app.close();
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}

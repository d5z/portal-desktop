import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopExecutable } from './support/desktop.mjs';
import { launchDesktop } from './support/electron-lifecycle.mjs';

const executable = await desktopExecutable();
const source = process.platform === 'darwin' ? path.resolve(path.dirname(executable), '../..') : path.dirname(executable);
const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'town installed runtime ')));
let app;
try {
  // Relocate the full app to a path with spaces, away from checkout/node_modules.
  const destination = path.join(directory, path.basename(source));
  await cp(source, destination, { recursive: true, verbatimSymlinks: true });
  const installed = path.join(destination, path.relative(source, executable));
  const resources = process.platform === 'darwin' ? path.join(destination, 'Contents/Resources') : path.join(destination, 'resources');
  const fixture = path.join(directory, 'runtime.cjs');
  await cp(fileURLToPath(new URL('./fixtures/packaged-runtime.cjs', import.meta.url)), fixture);
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['PATH', 'NODE_PATH', 'NODE_OPTIONS'].includes(key.toUpperCase())));
  execFileSync(installed, [fixture, resources], { cwd: directory, stdio: 'inherit', timeout: 60000,
    env: { ...environment, ELECTRON_RUN_AS_NODE: '1', PATH: process.platform === 'win32'
      ? path.join(process.env.SystemRoot, 'System32') : '/usr/bin:/bin' } });

  // Reopen an existing profile with the old settings/plugin-record formats.
  const profile = path.join(directory, 'profile'), workspace = path.join(directory, '工作区');
  await mkdir(workspace);
  const launch = { executablePath: installed, cwd: directory,
    env: { ...environment, PORTAL_DESKTOP_USER_DATA: profile, PORTAL_DESKTOP_TEST_MOCK_KEYCHAIN: '1' } };
  app = await launchDesktop(launch);
  let page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.beings));
  const initial = await page.evaluate(() => window.beings.snapshot());
  const credential = await app.evaluate(({ safeStorage }) => safeStorage.encryptString(JSON.stringify({ link: 'http://127.0.0.1:1/retained/?token=fixture' })).toString('base64'));
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  await app.close(); app = undefined;
  const settings = { ...initial.settings, workspace, portalBinary: path.join(directory, 'removed-old-app/heart-portal'),
    portalName: 'retained-profile', autoStart: false, backgroundEnabled: false, allowExec: false, kitsEnabled: false };
  const saved = JSON.stringify({ version: 1, settings, credential });
  await writeFile(path.join(profile, 'connection.json'), saved);
  const plugins = path.join(profile, 'third-party-plugins'), root = path.join(plugins, 'packages/retained-plugin');
  await mkdir(root, { recursive: true });
  await mkdir(path.join(plugins, 'data'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'retained-plugin', version: '1.0.0', main: 'index.cjs', dsh: {} }));
  await writeFile(path.join(root, 'index.cjs'), 'exports.apply = () => {};');
  const records = JSON.stringify([{ root, plugin: { id: 'retained-plugin', version: '1.0.0', source: root,
    enabled: true, installedAt: '2026-01-01T00:00:00.000Z', status: 'active' }, config: { retained: '原配置' } }]);
  await writeFile(path.join(plugins, 'plugins.json'), records);
  await writeFile(path.join(plugins, 'data/retained.txt'), '插件原数据');
  app = await launchDesktop(launch);
  page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.beings));
  const restored = await page.evaluate(() => window.beings.snapshot());
  assert.equal(restored.settings.workspace, workspace);
  assert.equal(restored.settings.portalName, 'retained-profile');
  assert.equal(restored.settings.hasToken, true);
  assert.equal(restored.settings.allowExec, false);
  assert.equal(restored.settings.portalBinary, path.join(resources, process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal'));
  await page.waitForFunction(async () => (await window.beings.dshPlugins.state()).plugins[0]?.status === 'active');
  const state = await page.evaluate(() => window.beings.dshPlugins.state());
  assert.deepEqual(state.plugins[0].config, { retained: '原配置' });
  assert.equal(await readFile(path.join(profile, 'connection.json'), 'utf8'), saved);
  assert.equal(await readFile(path.join(plugins, 'plugins.json'), 'utf8'), records);
  assert.equal(await readFile(path.join(plugins, 'data/retained.txt'), 'utf8'), '插件原数据');
  console.log('PASS packaged profile reopen: current bundled Portal path, retained connection/workspace/settings/plugin records/data, existing plugin active.');
} finally {
  if (app) await app.close();
  await rm(directory, { recursive: true, force: true });
}

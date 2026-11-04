import { afterEach, expect, it, vi } from 'vitest';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import os from 'node:os';
import path from 'node:path';
import { command } from '../desktop/main/portal/background';
import { assetName, launchMacInstaller, macInstallerScript, stageInstaller } from '../desktop/main/updates/manual-installer';
import { macInstallLocation, validateMacApp } from '../desktop/main/updates/mac-package';
import { digest } from '../desktop/main/updates/runtime';

// Filesystem failure cases need no developer private key. Trust policy is
// exercised separately, and the actual release ZIP must pass the real verifier.
vi.mock('../desktop/main/updates/mac-signature', () => ({ verifyMacSignature: async (file: string) => {
  await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', file]);
} }));

const mac = it.skipIf(process.platform !== 'darwin');
// clang, codesign, ditto and lipo run real native processes. A cold Intel CI
// runner can exceed Vitest's 5s default while the other test files run in parallel.
const nativeTimeout = 30_000;
const directories: string[] = [];
afterEach(async () => { for (const root of directories.splice(0)) await rm(root, { recursive: true, force: true }); });
async function temporary() {
  const root = await mkdtemp(path.join(os.tmpdir(), "portal-mac-'安装-"));
  directories.push(root); return root;
}
async function appFixture(root: string, version: string) {
  const app = path.join(root, 'Portal Desktop.app'), contents = path.join(app, 'Contents');
  await mkdir(path.join(contents, 'MacOS'), { recursive: true });
  await mkdir(path.join(contents, 'Resources'));
  // System binaries can be arm64e; compile the same architecture as the client.
  const source = path.join(root, 'fixture.c');
  await writeFile(source, 'int main(void) { return 0; }\n');
  const executable = path.join(contents, 'MacOS/Portal Desktop');
  await command('/usr/bin/clang', ['-arch', process.arch === 'x64' ? 'x86_64' : process.arch, source, '-o', executable]);
  await rm(source);
  const engine = path.join(contents, 'Resources/heart-portal');
  await copyFile(executable, engine);
  await command('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', engine]);
  await writeFile(path.join(contents, 'Resources/runtime-bundle.json'), JSON.stringify({ schema: 1, id: 'a'.repeat(64),
    clientVersion: version, portalVersion: '0.8.2', platform: process.platform, arch: process.arch, sha256: digest(await readFile(engine)) }));
  await writeFile(path.join(contents, 'Resources/app.asar'), 'fixture UI');
  const plist = path.join(contents, 'Info.plist');
  await writeFile(plist, JSON.stringify({ CFBundleIdentifier: 'town.beings.portal-desktop', CFBundleExecutable: 'Portal Desktop',
    CFBundlePackageType: 'APPL', CFBundleShortVersionString: version, CFBundleVersion: version }));
  await command('/usr/bin/plutil', ['-convert', 'xml1', plist]);
  await command('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', app]);
  return app;
}
async function archiveFetcher(root: string, app: string, version: string, corruptDigest = false) {
  const zip = path.join(root, 'candidate.zip');
  await command('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip]);
  const data = await readFile(zip);
  const sum = `${corruptDigest ? '0'.repeat(64) : digest(data)}  ${assetName(version)}\n`;
  return (async (url: string | URL | Request) => new Response(String(url).endsWith('SHA256SUMS.txt') ? sum : data)) as typeof fetch;
}

mac('rejects an exited or unready installation worker without replacing the app', async () => {
  const root = await temporary();
  for (const scenario of ['exit', 'timeout']) {
    const dir = path.join(root, scenario); await mkdir(dir);
    const script = path.join(dir, 'install.sh');
    await writeFile(script, scenario === 'exit' ? 'echo worker-failed >&2\nexit 42\n' : 'sleep 2\n');
    await expect(launchMacInstaller(dir, script, 150)).rejects.toThrow(scenario === 'exit' ? '交接前退出' : '超时');
    expect((await readdir(dir)).some(name => name.endsWith('.cancel'))).toBe(true);
    if (scenario === 'exit') expect(await readFile(path.join(dir, 'install.log'), 'utf8')).toContain('worker-failed');
  }
}, nativeTimeout);

mac('acknowledges readiness and honours cancellation before touching either application', async () => {
  const root = await temporary();
  const current = path.join(root, 'Current.app'), candidate = path.join(root, 'Candidate.app');
  await mkdir(current); await mkdir(candidate);
  await writeFile(path.join(current, 'version'), 'old');
  await writeFile(path.join(candidate, 'version'), 'new');
  const script = path.join(root, 'install.sh');
  await writeFile(script, macInstallerScript(process.pid, current, candidate, path.join(root, 'Previous.app')));
  await launchMacInstaller(root, script);
  const ready = (await readdir(root)).find(name => name.endsWith('.ready'))!;
  const status = path.join(root, ready.replace('.ready', '.json'));
  const pid = Number(await readFile(path.join(root, ready), 'utf8'));
  try {
    expect(JSON.parse(await readFile(status, 'utf8')).stage).toBe('waiting-for-client');
    await writeFile(path.join(root, ready.replace('.ready', '.cancel')), 'cancelled');
    await vi.waitFor(async () => expect(JSON.parse(await readFile(status, 'utf8')).stage).toBe('cancelled'), { timeout: 3000 });
    expect(await readFile(path.join(current, 'version'), 'utf8')).toBe('old');
    expect(await readFile(path.join(candidate, 'version'), 'utf8')).toBe('new');
    await expect(readFile(path.join(root, 'Previous.app/version'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { try { process.kill(pid); } catch { /* Already exited. */ } }
}, nativeTimeout);

mac('hands off to a detached worker that replaces and relaunches after its client exits', async () => {
  const root = await temporary();
  const current = path.join(root, 'Current.app'), candidate = path.join(root, 'Candidate.app'), backup = path.join(root, 'Previous.app');
  await mkdir(current); await mkdir(candidate);
  await writeFile(path.join(current, 'version'), 'old'); await writeFile(path.join(candidate, 'version'), 'new');
  const launcher = path.join(root, 'open-fixture.sh'), calls = path.join(root, 'launches');
  await writeFile(launcher, '#!/bin/sh\n/bin/cat "$2/version" > "$LAUNCH_LOG"\n', { mode: 0o700 });
  const entry = path.join(root, 'parent.cjs');
  await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
    import { writeFile } from 'node:fs/promises';
    import path from 'node:path';
    import { launchMacInstaller, macInstallerScript } from './desktop/main/updates/manual-installer';
    (async () => {
      const [root, current, candidate, backup, launcher] = process.argv.slice(2);
      const script = path.join(root, 'install.sh');
      const quote = value => "'" + value.replaceAll("'", "'\\\\''") + "'";
      await writeFile(script, macInstallerScript(process.pid, current, candidate, backup).replaceAll('/usr/bin/open', quote(launcher)));
      await launchMacInstaller(root, script);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  ` }, outfile: entry, bundle: true, platform: 'node', format: 'cjs' });
  const child = spawn(process.execPath, [entry, root, current, candidate, backup, launcher], {
    env: { ...process.env, LAUNCH_LOG: calls }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errors = ''; child.stderr.on('data', chunk => { errors += String(chunk); });
  try {
    const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    expect(code, errors).toBe(0);
    await vi.waitFor(async () => expect(await readFile(path.join(root, 'install.log'), 'utf8')).toContain('completed'), { timeout: 10_000 });
    expect(await readFile(calls, 'utf8')).toBe('new');
    expect(await readFile(path.join(current, 'version'), 'utf8')).toBe('new');
    expect(await readFile(path.join(backup, 'version'), 'utf8')).toBe('old');
  } finally { child.kill(); }
}, nativeTimeout);

mac('stages a signed ZIP without touching the installed app or profile; cancellation cleans temporary downloads', async () => {
  const root = await temporary(), profile = path.join(root, 'profile');
  const current = await appFixture(path.join(root, 'installed'), '0.1.3');
  const candidate = await appFixture(path.join(root, 'download'), '0.1.4');
  await mkdir(profile); await writeFile(path.join(profile, 'connection.json'), 'unchanged encrypted fixture');
  const old = await readFile(path.join(current, 'Contents/Info.plist'));
  const handoff = await stageInstaller(profile, '0.1.4', 'd5z/portal-desktop', path.join(current, 'Contents/MacOS/Portal Desktop'), await archiveFetcher(root, candidate, '0.1.4'));
  expect((await readdir(path.dirname(current))).some(name => name.startsWith('.portal-desktop-update-'))).toBe(true);
  expect(await readFile(path.join(current, 'Contents/Info.plist'))).toEqual(old);
  await handoff.discard();
  expect(await readdir(path.dirname(current))).toEqual(['Portal Desktop.app']);
  expect(await readdir(path.join(profile, 'client-updates'))).toEqual([]);
  expect(await readFile(path.join(profile, 'connection.json'), 'utf8')).toBe('unchanged encrypted fixture');
}, nativeTimeout);

mac('rejects corrupt downloads, modified UI, wrong versions and missing executables before installation', async () => {
  const root = await temporary();
  const current = await appFixture(path.join(root, 'installed'), '0.1.3');
  for (const failure of ['digest', 'ui', 'version', 'executable', 'engine']) {
    const candidate = await appFixture(path.join(root, failure), failure === 'version' ? '0.1.5' : '0.1.4');
    if (failure === 'ui') await writeFile(path.join(candidate, 'Contents/Resources/app.asar'), 'modified UI');
    if (failure === 'executable') await rm(path.join(candidate, 'Contents/MacOS/Portal Desktop'));
    if (failure === 'engine') await writeFile(path.join(candidate, 'Contents/Resources/heart-portal'), 'corrupted engine');
    await expect(stageInstaller(path.join(root, 'profile'), '0.1.4', 'd5z/portal-desktop', path.join(current, 'Contents/MacOS/Portal Desktop'),
      await archiveFetcher(root, candidate, '0.1.4', failure === 'digest'))).rejects.toThrow();
    expect(await readdir(path.dirname(current))).toEqual(['Portal Desktop.app']);
    expect(await readdir(path.join(root, 'profile/client-updates'))).toEqual([]);
    await expect(validateMacApp(current, '0.1.3')).resolves.toMatchObject({ clientVersion: '0.1.3' });
  }
}, nativeTimeout);

mac('rejects translocated and read-only install locations before starting a download', async () => {
  const root = await temporary();
  const translocated = await appFixture(path.join(root, 'AppTranslocation/test'), '0.1.4');
  await expect(macInstallLocation(path.join(translocated, 'Contents/MacOS/Portal Desktop'))).rejects.toThrow('应用程序');
  const current = await appFixture(path.join(root, 'read-only'), '0.1.4');
  await chmod(path.dirname(current), 0o500);
  try { await expect(macInstallLocation(path.join(current, 'Contents/MacOS/Portal Desktop'))).rejects.toThrow('不可写'); }
  finally { await chmod(path.dirname(current), 0o700); }
}, nativeTimeout);

mac('waits for the old process, replaces once and restores the old app on move or launch failure', async () => {
  const root = await temporary();
  for (const scenario of ['success', 'missing-candidate', 'launch-failure', 'backup-failure']) {
    const dir = path.join(root, scenario); await mkdir(dir);
    const current = path.join(dir, "Current ' 客户端.app"), candidate = path.join(dir, 'Candidate.app');
    const backup = path.join(dir, scenario === 'backup-failure' ? 'missing/Previous.app' : 'Previous.app');
    await mkdir(current); await writeFile(path.join(current, 'version'), 'old');
    if (scenario !== 'missing-candidate') { await mkdir(candidate); await writeFile(path.join(candidate, 'version'), 'new'); }
    const launcher = path.join(dir, 'open-fixture.sh'), calls = path.join(dir, 'launches');
    await writeFile(launcher, '#!/bin/sh\nversion=$(/bin/cat "$2/version")\nprintf "%s\\n" "$version" >> "$LAUNCH_LOG"\n[ "$FAIL_NEW" != 1 ] || [ "$version" != new ]\n', { mode: 0o700 });
    const old = spawn('/bin/sleep', ['60'], { stdio: 'ignore' });
    const script = path.join(dir, 'install.sh');
    // Substitute only LaunchServices. The actual installer wait/move/rollback
    // commands operate on real files, without launching another Electron GUI.
    await writeFile(script, macInstallerScript(old.pid!, current, candidate, backup).replaceAll('/usr/bin/open', `'${launcher.replaceAll("'", "'\\''")}'`));
    const child = spawn('/bin/sh', [script], { env: { ...process.env, LAUNCH_LOG: calls, FAIL_NEW: scenario === 'launch-failure' ? '1' : '0' }, stdio: 'ignore' });
    const completion = new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(await readFile(path.join(current, 'version'), 'utf8')).toBe('old');
      old.kill();
      expect(await completion).toBe(scenario === 'success' ? 0 : 1);
      expect(await readFile(path.join(current, 'version'), 'utf8')).toBe(scenario === 'success' ? 'new' : 'old');
      expect((await readFile(calls, 'utf8')).trim().split('\n')).toEqual(scenario === 'success' ? ['new'] : scenario === 'launch-failure' ? ['new', 'old'] : ['old']);
      if (scenario === 'success') expect(await readFile(path.join(backup, 'version'), 'utf8')).toBe('old');
    } finally { old.kill(); child.kill(); }
  }
}, nativeTimeout);

import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { checksumFor } from '../desktop/main/updates/manual-installer';

const execute = promisify(execFile);
const directories: string[] = [];
afterEach(async () => { for (const root of directories.splice(0)) await rm(root, { recursive: true, force: true }); });
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
// Publication assembles the three native CI artifacts on Linux using Python ZIP
// inspection; no Windows setup or disk image is executed by these tests.
async function releaseFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portal-release-assets-'));
  directories.push(root);
  const input = path.join(root, 'artifacts');
  for (const [artifact, platform, arch] of [
    ['portal-desktop-macos-14', 'darwin', 'arm64'],
    ['portal-desktop-macos-15-intel', 'darwin', 'x64'],
    ['portal-desktop-windows-latest', 'win32', 'x64'],
  ]) {
    const directory = path.join(input, artifact); await mkdir(directory, { recursive: true });
    const engine = Buffer.from(`fixture ${platform} ${arch}`);
    const bundle = Buffer.from(JSON.stringify({ schema: 1, clientVersion: '0.1.4', platform, arch, sha256: sha(engine) }));
    await writeFile(path.join(directory, 'runtime-bundle.json'), bundle);
    await execute('python3', ['-c', 'import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n z.writestr("App/resources/runtime-bundle.json",sys.argv[2])\n z.writestr("App/resources/heart-portal"+sys.argv[3],sys.argv[4])',
      path.join(directory, 'app.zip'), bundle.toString(), platform === 'win32' ? '.exe' : '', engine.toString()]);
    if (platform === 'win32') await writeFile(path.join(directory, 'App Setup.exe'), 'fixture setup');
    else await writeFile(path.join(directory, 'App.dmg'), `fixture signed disk image ${arch}`);
  }
  const stage = (name: string) => execute(process.execPath, ['scripts/stage-release.mjs', input, path.join(root, name), '0.1.4']);
  return { root, input, stage };
}

// These cases launch native Python ZIP inspection and the publication process.
describe('release staging', { timeout: 30_000 }, () => {
it.skipIf(process.platform === 'win32')('publishes both Mac architectures and Windows with separate installers, ZIPs, manifests and checksums', async () => {
  const { root, stage } = await releaseFixture();
  await stage('release');
  const output = path.join(root, 'release');
  const files = await readdir(output);
  expect(files.sort()).toEqual(['SHA256SUMS.txt', 'portal-desktop-0.1.4-macos-arm64.dmg', 'portal-desktop-0.1.4-macos-arm64.zip',
    'portal-desktop-0.1.4-macos-x64.dmg', 'portal-desktop-0.1.4-macos-x64.zip',
    'portal-desktop-0.1.4-windows-x64-Setup.exe', 'portal-desktop-0.1.4-windows-x64.zip',
    'runtime-bundle-macos-arm64.json', 'runtime-bundle-macos-x64.json', 'runtime-bundle-windows-x64.json']);
  const sums = await readFile(path.join(output, 'SHA256SUMS.txt'), 'utf8');
  for (const name of files.filter(name => name !== 'SHA256SUMS.txt')) expect(checksumFor(sums, name)).toBe(sha(await readFile(path.join(output, name))));
  await expect(stage('release')).rejects.toThrow('must be empty');
});

it.skipIf(process.platform === 'win32').each(['portal-desktop-macos-14', 'portal-desktop-macos-15-intel'])(
  'requires exactly one DMG and ZIP for %s', async artifact => {
    const { input, stage } = await releaseFixture();
    const mac = path.join(input, artifact);
    await rm(path.join(mac, 'App.dmg'));
    await expect(stage('missing-dmg')).rejects.toThrow('macOS DMG');
    await writeFile(path.join(mac, 'App.dmg'), 'fixture signed disk image');
    await writeFile(path.join(mac, 'Duplicate.dmg'), 'duplicate');
    await expect(stage('duplicate-dmg')).rejects.toThrow('macOS DMG');
    await rm(path.join(mac, 'Duplicate.dmg'));
    await writeFile(path.join(mac, 'Duplicate.zip'), 'duplicate');
    await expect(stage('duplicate-zip')).rejects.toThrow('platform ZIP');
    await rm(path.join(mac, 'Duplicate.zip'));
    await rm(path.join(mac, 'app.zip'));
    await expect(stage('missing-zip')).rejects.toThrow('platform ZIP');
  });

it.skipIf(process.platform === 'win32')('refuses to publish an incomplete release without the Intel artifact', async () => {
  const { input, stage } = await releaseFixture();
  await rm(path.join(input, 'portal-desktop-macos-15-intel'), { recursive: true });
  await expect(stage('missing-intel')).rejects.toThrow('portal-desktop-macos-15-intel');
});

it.skipIf(process.platform === 'win32')('rejects Intel manifests for the wrong architecture and tampered packaged engines', async () => {
  const { input, stage } = await releaseFixture();
  const intel = path.join(input, 'portal-desktop-macos-15-intel');
  const manifest = path.join(intel, 'runtime-bundle.json');
  const original = await readFile(manifest);
  await writeFile(manifest, JSON.stringify({ ...JSON.parse(original.toString()), arch: 'arm64' }));
  await expect(stage('wrong-arch')).rejects.toThrow('Mismatched macos-x64 manifest');
  await writeFile(manifest, original);
  await execute('python3', ['-c', 'import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n z.writestr("App/resources/runtime-bundle.json",sys.argv[2])\n z.writestr("App/resources/heart-portal","wrong engine")',
    path.join(intel, 'app.zip'), original.toString()]);
  await expect(stage('wrong-engine')).rejects.toThrow('macos-x64 engine checksum mismatch');
});

});

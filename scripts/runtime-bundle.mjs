import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { checkPortalCapabilities } from './portal-capabilities.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function writeRuntimeBundle() {
  const binary = path.resolve('resources', process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal');
  checkPortalCapabilities(binary);
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const portalVersion = /\b(\d+\.\d+\.\d+)\b/.exec(execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 15000 }))?.[1];
  if (!portalVersion) throw new Error('Cannot identify bundled Portal');
  const sha256 = sha(await readFile(binary));
  const runner = sha(Buffer.concat(await Promise.all(['background.ts', 'windows.ts', 'windows-log-copy.ts', 'supervisor.ts']
    .map(file => readFile(path.join('desktop/main/portal', file))))));
  const id = sha(`${pkg.version}:${sha256}:${runner}`);
  await writeFile('resources/runtime-bundle.json', JSON.stringify({ schema: 1, id, clientVersion: pkg.version, portalVersion, sha256, platform: process.platform, arch: process.arch }, null, 2));
}

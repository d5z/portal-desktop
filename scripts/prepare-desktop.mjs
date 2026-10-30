import { writeRuntimeBundle } from './runtime-bundle.mjs';
import { mkdir, copyFile, access, chmod } from 'node:fs/promises';
import path from 'node:path';
import './build-chat.mjs';
import { portalSource } from './portal-source.mjs';
import { checkPortalCapabilities } from './portal-capabilities.mjs';

const binaryName = process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal';
const destination = path.resolve('resources', binaryName);
await mkdir('resources', { recursive: true });
try { await access(destination); }
catch {
  const source = path.join(portalSource, 'target/release', binaryName);
  try { await copyFile(source, destination); if (process.platform !== 'win32') await chmod(destination, 0o755); }
  catch { console.log('Portal binary not found. Chat is available; run npm run build:portal to bundle the local engine.'); }
}
const binaryExists = await access(destination).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
});
if (binaryExists) {
  try { checkPortalCapabilities(destination); }
  catch {
    console.log('Bundled Portal is incompatible with this client; rebuilding the local engine.');
    await import('./build-portal.mjs');
  }
  await writeRuntimeBundle();
}
console.log('Prepared local Loom assets (no CDN requests).');

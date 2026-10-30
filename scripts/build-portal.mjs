import { spawn } from 'node:child_process';
import { mkdir, copyFile, chmod, rename, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { requirePortalSource } from './portal-source.mjs';
const source = await requirePortalSource();
const child = spawn('cargo', ['build', '--release', '--locked', '-p', 'heart-portal'], { cwd: source, stdio: 'inherit', shell: false });
await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`cargo exited with ${code}`))); });
const name = process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal';
await mkdir('resources', { recursive: true });
const destination = path.resolve('resources', name);
const built = path.join(source, 'target/release', name);
const existing = await readFile(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
const temporary = `${destination}.${randomUUID()}.tmp`;
// Windows locks running executable images. An unchanged engine needs no write,
// so rebuilding the UI must not fail just because the client is open.
if (!existing?.equals(await readFile(built))) {
  try {
    await copyFile(built, temporary);
    if (process.platform !== 'win32') await chmod(temporary, 0o755);
    await rename(temporary, destination);
  } finally { await rm(temporary, { force: true }); }
}
console.log(`Bundled ${name} for ${process.platform}/${process.arch}.`);

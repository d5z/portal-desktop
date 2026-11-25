import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Loaded inside the native Harness host: only publishes its official authenticated URL. */
export async function installDeepSeekDiscovery(home: string) {
  const directory = path.join(home, 'town-bridge');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'discovery.mjs');
  const destination = path.join(directory, 'host.json');
  await writeFile(file, `import { writeFile, readFile, unlink } from 'node:fs/promises';
export const inject = ['webServer', 'connection'];
export function apply(ctx) {
  const file = ${JSON.stringify(destination)};
  let disposed = false;
  ctx.effect(() => async () => {
    disposed = true;
    const value = await readFile(file, 'utf8').then(JSON.parse).catch(() => null);
    if (value?.pid === process.pid) await unlink(file).catch(() => {});
  });
  const ready = () => {
    if (disposed) return;
    const url = ctx.connection.authenticatedUrl(ctx.webServer.getOrigin());
    return writeFile(file, JSON.stringify({ version: 1, pid: process.pid, url }), { mode: 0o600 });
  };
  const settled = ctx.get('loader')?.await();
  void (settled ? settled.then(ready) : ready());
}
`, { mode: 0o600 });
  const profile = path.join(home, 'profiles/desktop');
  await mkdir(profile, { recursive: true });
  const patch = path.join(profile, 'cordis.patch.yml');
  const previous = await readFile(patch, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  if (!previous.includes('id: town-work-discovery')) {
    await writeFile(patch, previous.replace(/^\s*\[\]\s*$/, '') + `\n- insert:\n    - id: town-work-discovery\n      name: ${JSON.stringify(pathToFileURL(file).href)}\n`, { mode: 0o600 });
  }
}

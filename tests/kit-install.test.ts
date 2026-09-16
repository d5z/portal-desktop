import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { c as archive } from 'tar';
import { KitInstaller, archivePath, dotenv, downloadKit, unpackKit } from '../desktop/main/kits/install';
import type { Settings } from '../desktop/shared/types';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); });
async function fixture(extra = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'beings-install-')); dirs.push(dir);
  const source = path.join(dir, 'source'); await mkdir(source);
  const manifest = { name: 'fixture-kit', version: '1', command: [process.execPath, '{{KIT_DIR}}/server.mjs'], tools: [{ name: 'ping', description: 'Ping' }], ...extra };
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(path.join(source, 'server.mjs'), `import readline from 'node:readline';
readline.createInterface({input:process.stdin}).on('line',line=>{ const r=JSON.parse(line); if(r.id==null)return;
if(r.method==='tools/call')throw Error('Installer must not invoke tools');
const result=r.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:{tools:[{name:'ping',description:'真实工具',inputSchema:{type:'object'}}]};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n'); });`);
  const file = path.join(dir, 'kit.tar.gz'); await archive({ gzip: true, cwd: source, file }, ['manifest.json', 'server.mjs']);
  const config = path.join(dir, 'portal.toml'); const kits = path.join(dir, 'kits');
  await writeFile(config, `kits_dir = ${JSON.stringify(kits)}\nkits_enabled = true\n`);
  const settings: Settings = { endpoint: '', being: '', hasToken: true, workspace: dir, portalBinary: process.execPath, portalName: 'test', autoStart: false, allowExec: false, kitsEnabled: true, portalConfigPath: config };
  const data = await readFile(file); const requests: any[] = [];
  const installer = new KitInstaller(dir, async (url, options) => { requests.push([url, options]); return String(url).endsWith('/download') ? new Response(data) : Response.json({ name: manifest.name, version: manifest.version, manifest }); });
  return { dir, source, data, kits, settings, installer, requests };
}
it('downloads and atomically activates a Kit for Portal without a manual import', async () => {
  const f = await fixture(); const plan = await f.installer.prepare('fixture-id', f.settings);
  expect(plan.tools).toBe(1); expect(plan.sha256).toHaveLength(64);
  await expect(stat(path.join(f.kits, plan.name))).rejects.toThrow();
  const result = await f.installer.install({ ticket: plan.ticket, environment: {} }, f.settings);
  expect(result.tools).toBe(1);
  const manifest = JSON.parse(await readFile(path.join(f.kits, plan.name, 'manifest.json'), 'utf8'));
  expect(manifest.tools[0].description).toBe('Ping');
  expect(manifest.tools[0].params.type).toBe('object');
  expect(manifest.command[1]).toBe(path.join(f.kits, plan.name) + '/server.mjs');
  expect(f.requests[0][1].headers.Authorization).toBeUndefined();
  await expect(f.installer.prepare('fixture-id', f.settings)).rejects.toThrow('同名');
});
it('honors provision.platforms from a downloaded Windows-only Kit', async () => {
  const f = await fixture({ provision: { platforms: ['win32'] } });
  if (process.platform === 'win32') {
    const plan = await f.installer.prepare('fixture-id', f.settings);
    expect(plan.name).toBe('fixture-kit');
    await f.installer.discard(plan.ticket);
  } else {
    await expect(f.installer.prepare('fixture-id', f.settings)).rejects.toThrow('不支持当前系统');
  }
});
it('persists scoped environment in Portal dotenv without wrapping the command', async () => {
  const f = await fixture({ provision: { env: [{ name: 'FIXTURE_KEY', required: true }] } });
  const plan = await f.installer.prepare('fixture-id', f.settings);
  await expect(f.installer.install({ ticket: plan.ticket, environment: { FIXTURE_KEY: '' } }, f.settings)).rejects.toThrow('请填写');
  const secret = "key'with $shell\nand a \\\"quote";
  await f.installer.install({ ticket: plan.ticket, environment: { FIXTURE_KEY: secret } }, f.settings);
  const target = path.join(f.kits, plan.name); const manifest = JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8'));
  expect(JSON.stringify(manifest)).not.toContain('key\'with');
  expect(await readFile(path.join(target, '.env'), 'utf8')).toBe(dotenv({ FIXTURE_KEY: secret }));
  expect(manifest.command[0]).toBe(process.execPath);
  await expect(stat(path.join(target, '.beings-launch.ps1'))).rejects.toThrow();
  await expect(stat(path.join(target, '.beings-launch.sh'))).rejects.toThrow();
});
it('rejects changed settings and cancels staging without exposing an installed manifest', async () => {
  const f = await fixture();
  const plan = await f.installer.prepare('fixture-id', f.settings);
  await expect(f.installer.install({ ticket: plan.ticket, environment: {} }, { ...f.settings, portalName: 'changed' })).rejects.toThrow('配置已改变');
  await expect(stat(path.join(f.kits, plan.name))).rejects.toThrow();
  await f.installer.discard(plan.ticket);
  await expect(f.installer.install({ ticket: plan.ticket, environment: {} }, f.settings)).rejects.toThrow('已过期');
});
it('refuses traversal, Windows special paths, malicious redirects, oversized downloads and non-archives', async () => {
  for (const p of ['../escape', '/absolute', 'C:/evil', 'a\\b', 'a/../b', 'a:stream', 'CON', 'foo./bar']) expect(() => archivePath(p)).toThrow();
  expect(archivePath('./safe/file.js')).toBe('safe/file.js');
  let calls = 0;
  await expect(downloadKit('safe', async () => { calls++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }); })).rejects.toThrow('下载源');
  expect(calls).toBe(1);
  await expect(downloadKit('safe', async () => new Response('x', { headers: { 'content-length': String(65 * 1024 * 1024) } }))).rejects.toThrow('64 MB');
  const f = await fixture(); await expect(unpackKit(Buffer.from('<html>error</html>'), path.join(f.dir, 'bad'))).rejects.toThrow('tar.gz');
});
it.skipIf(process.platform === 'win32')('rejects archive symlinks before exposing files to Portal', async () => {
  const f = await fixture(); await symlink('/tmp', path.join(f.source, 'evil'));
  const file = path.join(f.dir, 'bad.tar.gz'); await archive({ gzip: true, cwd: f.source, file }, ['evil']);
  await expect(unpackKit(await readFile(file), path.join(f.dir, 'extract'))).rejects.toThrow('链接');
});
it('uses Grove provision fields missing from the archive and refuses a mismatched bundle', async () => {
  const f = await fixture(); const manifest = JSON.parse(await readFile(path.join(f.source, 'manifest.json'), 'utf8'));
  let name = manifest.name;
  const installer = new KitInstaller(f.dir, async url => String(url).endsWith('/download') ? new Response(f.data) : Response.json({ name, version: manifest.version, manifest: { provision: { env: [{ name: 'CATALOG_KEY', description: 'From Grove', required: true }] } } }));
  const plan = await installer.prepare('fixture-id', f.settings);
  expect(plan.environment).toEqual([{ name: 'CATALOG_KEY', description: 'From Grove', required: true }]);
  await installer.discard(plan.ticket); name = 'different-kit';
  await expect(installer.prepare('fixture-id', f.settings)).rejects.toThrow('不一致');
});

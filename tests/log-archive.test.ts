import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { ClientErrorLog } from '../desktop/main/app/error-log';
import { createLogArchive, MAX_LOG_BYTES } from '../desktop/main/app/log-archive';

it('packages client, rotated and Portal logs without configs or credentials', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'log-archive-'));
  try {
    const log = new ClientErrorLog(root);
    await log.exportSnapshot(['foreground Portal output'], { phase: 'connected' });
    log.report('client', 'client failure'); await log.flush();
    await writeFile(log.file + '.previous', 'previous client failure');
    const runtime = path.join(root, 'runtime'), destination = path.join(root, 'downloads');
    await mkdir(runtime);
    await writeFile(path.join(runtime, 'portal.log'), 'background output known-private-token Authorization: Bearer bearer-value\napi_key=key-value');
    await writeFile(path.join(runtime, 'portal.err.log.previous'), 'previous Portal failure');
    await writeFile(path.join(runtime, 'supervisor.err.log'), 'runner failed');
    await writeFile(path.join(runtime, 'connection.url'), 'must-not-export');
    await writeFile(path.join(runtime, 'portal.toml'), 'must-not-export');
    const file = await createLogArchive({ logsDirectory: log.directory, runtimeDirectories: [runtime, runtime], destination, secrets: ['known-private-token'] });
    const files = unzipSync(await readFile(file));
    const text = Object.values(files).map(file => strFromU8(file)).join('\n');
    expect(Object.keys(files)).toContain('client/client-errors.log.previous');
    expect(Object.keys(files)).toContain('portal/runtime-1/portal.err.log.previous');
    expect(Object.keys(files).some(name => name.includes('runtime-2'))).toBe(false);
    expect(text).toContain('client failure'); expect(text).toContain('foreground Portal output');
    expect(text).toContain('background output'); expect(text).toContain('runner failed');
    expect(text).not.toMatch(/known-private-token|bearer-value|key-value|must-not-export/);
    expect((await readdir(destination))).toEqual([path.basename(file)]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('keeps recent lines of oversized logs and records missing sources in the archive', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'log-archive-tail-'));
  try {
    await writeFile(path.join(root, 'client-errors.log'), 'x'.repeat(MAX_LOG_BYTES + 5) + '\nlatest failure\n');
    const file = await createLogArchive({ logsDirectory: root, runtimeDirectories: [], destination: path.join(root, 'out'), secrets: [] });
    const files = unzipSync(await readFile(file));
    expect(strFromU8(files['client/client-errors.log'])).toContain('latest failure');
    expect(files['client/client-errors.log'].length).toBeLessThan(300);
    const report = JSON.parse(strFromU8(files['collection.json']));
    expect(report.entries).toContainEqual(expect.objectContaining({ file: 'client/client-errors.log', status: 'truncated' }));
    expect(report.entries).toContainEqual({ file: 'portal/portal-runtime.log', status: 'missing' });
    await expect(createLogArchive({ logsDirectory: path.join(root, 'absent'), runtimeDirectories: [], destination: root, secrets: [] })).rejects.toThrow('未能读取日志');
  } finally { await rm(root, { recursive: true, force: true }); }
});

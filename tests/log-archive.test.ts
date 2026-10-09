import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { ClientErrorLog } from '../desktop/main/app/error-log';
import { createLogArchive } from '../desktop/main/app/log-archive';

it('packages client, rotated and Portal logs without configs or credentials', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'log-archive-'));
  try {
    const log = new ClientErrorLog(root);
    await log.exportSnapshot(['foreground Portal output'], { phase: 'connected' });
    log.report('client', 'client failure'); await log.flush();
    log.info('client-start', 'client started successfully'); await log.flush();
    await mkdir(path.join(log.directory, 'renderer'));
    await writeFile(path.join(log.directory, 'renderer', 'activity.log.1'), 'previous renderer activity');
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
    expect(text).toContain('client started successfully');
    expect(Object.keys(files)).toContain('client/renderer/activity.log.1');
    expect(text).toContain('background output'); expect(text).toContain('runner failed');
    expect(text).not.toMatch(/known-private-token|bearer-value|key-value|must-not-export/);
    expect((await readdir(destination))).toEqual([path.basename(file)]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('exports complete logs larger than 4 MiB and records missing sources in the archive', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'log-archive-tail-'));
  try {
    const source = 'first startup\n' + 'normal runtime output\n'.repeat(220000) + 'latest activity\n';
    await writeFile(path.join(root, 'client-runtime.log'), source);
    const file = await createLogArchive({ logsDirectory: root, runtimeDirectories: [], destination: path.join(root, 'out'), secrets: [] });
    const files = unzipSync(await readFile(file));
    expect(strFromU8(files['client/client-runtime.log'])).toBe(source);
    const report = JSON.parse(strFromU8(files['collection.json']));
    expect(report.entries).toContainEqual(expect.objectContaining({ file: 'client/client-runtime.log', status: 'included', sourceBytes: Buffer.byteLength(source) }));
    expect(report.entries).toContainEqual({ file: 'portal/portal-runtime.log', status: 'missing' });
    await expect(createLogArchive({ logsDirectory: path.join(root, 'absent'), runtimeDirectories: [], destination: root, secrets: [] })).rejects.toThrow('未能读取日志');
  } finally { await rm(root, { recursive: true, force: true }); }
});

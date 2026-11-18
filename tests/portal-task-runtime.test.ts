import { expect, it } from 'vitest';
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ensurePortalRuntime, portalRuntimeId } from '../desktop/main/portal/task-runtime';

it('installs one shared runtime and preserves it after the application source is removed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portal-task-runtime-'));
  const source = path.join(root, 'application'), service = path.join(root, 'service');
  try {
    await mkdir(path.join(source, 'portal-runtime/python/bin'), { recursive: true });
    await writeFile(path.join(source, 'portal-runtime/runtime.json'), JSON.stringify({ schema: 1, id: 'a'.repeat(64), python: { version: '3', path: 'python/bin/python3' }, node: { version: '24', path: 'node/bin/node' } }));
    const interpreter = path.join(source, 'portal-runtime/python/bin/python3');
    await writeFile(interpreter, '#!/bin/sh\nexit 0\n'); await chmod(interpreter, 0o755);
    await mkdir(path.join(source, 'portal-runtime/node/bin'), { recursive: true });
    await writeFile(path.join(source, 'portal-runtime/node/bin/node'), '#!/bin/sh\nexit 0\n');
    if (process.platform !== 'win32') await symlink('python3', path.join(source, 'portal-runtime/python/bin/python'));
    const shared = await ensurePortalRuntime(path.join(source, 'heart-portal'), service, await portalRuntimeId(path.join(source, 'heart-portal')));
    expect(shared).toBe(path.join(service, 'portal-runtimes', 'a'.repeat(64)));
    await rm(source, { recursive: true });
    expect(await readFile(path.join(shared!, 'runtime.json'), 'utf8')).toContain('a'.repeat(64));
    expect(await readFile(path.join(shared!, 'python/bin/python3'), 'utf8')).toContain('exit 0');
    if (process.platform !== 'win32') expect(await readFile(path.join(shared!, 'python/bin/python'), 'utf8')).toContain('exit 0');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('allows standalone engines without a runtime and reports malformed sidecar metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portal-task-runtime-'));
  const binary = path.join(root, 'heart-portal');
  try {
    expect(await portalRuntimeId(binary)).toBeUndefined();
    await mkdir(path.join(root, 'portal-runtime'));
    await writeFile(path.join(root, 'portal-runtime/runtime.json'), '{"schema":1,"id":"invalid"}');
    await expect(portalRuntimeId(binary)).rejects.toThrow('清单无效');
  } finally { await rm(root, { recursive: true, force: true }); }
});

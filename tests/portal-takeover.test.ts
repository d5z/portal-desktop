import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PortalTakeover } from '../desktop/main/portal/takeover';
import { parseConnection } from '../desktop/main/chat/connection';
import type { PortalConflict } from '../desktop/main/portal/external';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const connection = parseConnection('https://example.org/alice/?token=private-fixture');
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portal-takeover-')); roots.push(root);
  const a: PortalConflict = { id: 'a', root: '/old-client', label: 'old-client', service: { label: 'old-client', root: '/old-client', file: '/old.plist', existing: false } };
  const b: PortalConflict = { id: 'b', root: '/independent', label: 'independent', service: { label: 'independent', root: '/independent', file: '', existing: true, kind: 'portable', binary: '/independent/heart-portal' } };
  let targets = [a, b];
  const events: string[] = [];
  const options = {
    discover: vi.fn(async () => [...targets]),
    stop: vi.fn(async (target: PortalConflict) => { events.push('stop:' + target.id); targets = targets.filter(item => item.id !== target.id); }),
    preflight: vi.fn(async () => { events.push('validate'); }),
  };
  const start = vi.fn(async (replacing: boolean) => { events.push(`start:${replacing}`); });
  return { root, a, b, options, start, events, takeover: new PortalTakeover(root, options), targets: (value: PortalConflict[]) => { targets = value; } };
}
it('validates the replacement and automatically stops every verified guardian before starting the client engine', async () => {
  const f = await fixture();
  expect(await f.takeover.run(connection, 'manual', f.start)).toBe(true);
  expect(f.events).toEqual(['validate', 'stop:a', 'stop:b', 'start:true']);
  await expect(readFile(f.takeover.file)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('ignores a legacy cancellation and automatically starts the client engine after restart', async () => {
  const f = await fixture();
  await writeFile(f.takeover.file, JSON.stringify({ schema: 1, identity: 'example.org/alice', phase: 'cancelled', message: 'old choice' }));
  expect(await f.takeover.run(connection, 'automatic', f.start)).toBe(true);
  expect(f.events).toEqual(['validate', 'stop:a', 'stop:b', 'start:true']);
  await expect(readFile(f.takeover.file)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('does not start or repeatedly retry when an old supervisor cannot stop', async () => {
  const f = await fixture(); f.options.stop.mockRejectedValue(new Error('old guardian still alive'));
  await expect(f.takeover.run(connection, 'manual', f.start)).rejects.toThrow('已暂停');
  expect(f.start).not.toHaveBeenCalled(); expect(f.options.stop).toHaveBeenCalledTimes(1);
  expect(await f.takeover.run(connection, 'automatic', f.start)).toBe(false);
  expect(f.options.stop).toHaveBeenCalledTimes(1);
});
it('rejects a changed or newly introduced service during preflight before making any mutation', async () => {
  const f = await fixture();
  f.options.preflight.mockImplementation(async () => { f.targets([{ ...f.a, id: 'changed-registration' }]); });
  await expect(f.takeover.run(connection, 'manual', f.start)).rejects.toThrow('启动检查期间发生变化');
  expect(f.options.stop).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled();
});
it('does not start when an old guardian reappears after stop', async () => {
  const f = await fixture(); f.options.stop.mockResolvedValue();
  await expect(f.takeover.run(connection, 'manual', f.start)).rejects.toThrow('尚未完全停止');
  expect(f.start).not.toHaveBeenCalled();
});
it('pauses an unidentified runtime instead of killing by process name or retrying the client', async () => {
  const f = await fixture(); f.targets([{ ...f.a, service: undefined, problem: 'unknown guardian' }]);
  await expect(f.takeover.run(connection, 'manual', f.start)).rejects.toThrow('unknown guardian');
  expect(f.options.stop).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled();
});
it('keeps failed replacement stopped and remembers client priority on a later manual retry', async () => {
  const f = await fixture(); f.start.mockRejectedValueOnce(new Error('replacement failed'));
  await expect(f.takeover.run(connection, 'manual', f.start)).rejects.toThrow('replacement failed');
  const reopened = new PortalTakeover(f.root, f.options);
  expect(await reopened.run(connection, 'automatic', f.start)).toBe(false);
  expect(await reopened.run(connection, 'manual', f.start)).toBe(true);
  expect(f.start).toHaveBeenLastCalledWith(true);
});
it('starts normally without a conflict but never retries an unidentified native conflict', async () => {
  const f = await fixture(); f.targets([]);
  expect(await f.takeover.run(connection, 'manual', f.start)).toBe(true);
  expect(f.start).toHaveBeenCalledWith(false); f.start.mockClear();
  await expect(f.takeover.run(connection, 'automatic', f.start, true)).rejects.toThrow('无法确认旧守护');
  expect(f.start).not.toHaveBeenCalled();
});
it('requires manual recovery after an interrupted stop transaction', async () => {
  const f = await fixture(); f.targets([]);
  await writeFile(f.takeover.file, JSON.stringify({ schema: 1, identity: 'example.org/alice', phase: 'stopping', replacing: true, message: 'interrupted' }));
  expect(await f.takeover.run(connection, 'automatic', f.start)).toBe(false);
  expect(await f.takeover.run(connection, 'manual', f.start)).toBe(true);
  expect(f.start).toHaveBeenCalledWith(true);
});
it('uses the force discovery and stop path only after a manual action and validates even without conflicts', async () => {
  const f = await fixture();
  await expect(f.takeover.run(connection, 'automatic', f.start, false, true)).rejects.toThrow('只能手动');
  expect(f.options.discover).not.toHaveBeenCalled();
  expect(await f.takeover.run(connection, 'manual', f.start, false, true)).toBe(true);
  expect(f.options.discover).toHaveBeenCalledWith(connection, true);
  expect(f.options.stop).toHaveBeenCalledWith(f.a, true);
  expect(f.start).toHaveBeenCalledWith(true);
  f.events.length = 0;
  expect(await f.takeover.run(connection, 'manual', f.start, false, true)).toBe(true);
  expect(f.events).toEqual(['validate', 'start:true']);
});

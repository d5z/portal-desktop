import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
vi.mock('electron', async () => ({ app: new (await import('node:events')).EventEmitter() }));
import { app } from 'electron';
import { registerChatIpc } from '../desktop/main/chat/ipc';
import { readSubagentState } from '../desktop/main/portal/status';

it('uses only the selected engine capability snapshot and rejects stale launches', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-ready-'));
  const readyFile = path.join(directory, '.portal-ready.json');
  const statusFile = path.join(directory, '.portal-subagent-status.json');
  const status = {pid: 42, nonce: 'launch', enabled: true, configured: true, ready: true, state_dir: path.join(directory, 'state')};
  try {
    expect(await readSubagentState(directory, 42)).toBeNull();
    await writeFile(readyFile, JSON.stringify({pid: 42, nonce: 'launch'}));
    await writeFile(statusFile, JSON.stringify(status));
    expect(await readSubagentState(directory, 42)).toEqual({enabled:true, configured:true, ready:true, state_dir:status.state_dir});
    expect(await readSubagentState(directory, 43)).toBeNull();
    for (const patch of [{nonce:'old'}, {ready:'true'}, {state_dir:'relative'}]) {
      await writeFile(statusFile, JSON.stringify({...status, ...patch}));
      expect(await readSubagentState(directory, 42)).toBeNull();
    }
    await writeFile(statusFile, JSON.stringify({...status, ready:false}));
    expect((await readSubagentState(directory, 42))?.ready).toBe(false);
    await writeFile(readyFile, JSON.stringify({pid:42, nonce:'new-launch'}));
    expect(await readSubagentState(directory, 42)).toBeNull();
  } finally { await rm(directory, {recursive:true, force:true}); }
});

it('publishes installation completion even when Portal stays connected and there are no tasks', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-install-status-'));
  const portal = Object.assign(new EventEmitter(), { state: {phase:'connected', pid:42, runtimePath:directory} });
  const send = vi.fn();
  const status = {pid:42, nonce:'launch', enabled:true, configured:true, ready:false, state_dir:path.join(directory,'state')};
  try {
    await writeFile(path.join(directory,'.portal-ready.json'), JSON.stringify({pid:42,nonce:'launch'}));
    await writeFile(path.join(directory,'.portal-subagent-status.json'), JSON.stringify(status));
    const ipc = registerChatIpc({directory, portal, handle:vi.fn(), proxy:{},
      store:{connection:{endpoint:'https://example.test/being'},settings:{}},
      window:()=>({isDestroyed:()=>false,webContents:{send}}), publishPluginEvent:vi.fn(),
    } as any);
    expect((await ipc.taskSnapshot()).subagentReady).toBe(false);
    await writeFile(path.join(directory,'.portal-subagent-status.json'), JSON.stringify({...status,ready:true}));
    portal.emit('state',portal.state);
    await vi.waitFor(()=>expect(send).toHaveBeenCalledWith('beings:scene-tasks',expect.objectContaining({subagentReady:true,tasks:[]})));
    app.emit('will-quit');
    expect(portal.listenerCount('state')).toBe(0);
  } finally { app.emit('will-quit'); await rm(directory,{recursive:true,force:true}); }
});

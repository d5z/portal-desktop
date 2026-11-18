import { createHash } from 'node:crypto';
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
  const configFile = path.join(directory, 'desktop-portal.toml');
  await writeFile(configFile, '[subagent]\nstate_dir="state"\n');
  const readyFile = path.join(directory, '.portal-ready.json');
  const statusFile = path.join(directory, '.portal-subagent-status.json');
  const status = {pid: 42, nonce: 'launch', enabled: true, configured: true, ready: true, state_dir: path.join(directory, 'state')};
  try {
    expect(await readSubagentState(directory, 42, configFile, 'https://example.test/being')).toBeNull();
    await writeFile(readyFile, JSON.stringify({pid: 42, nonce: 'launch'}));
    await writeFile(statusFile, JSON.stringify(status));
    expect(await readSubagentState(directory, 42, configFile, 'https://example.test/being')).toEqual({enabled:true, configured:true, ready:true, state_dir:status.state_dir});
    expect(await readSubagentState(directory, 43, configFile, 'https://example.test/being')).toBeNull();
    for (const patch of [{nonce:'old'}, {ready:'true'}, {state_dir:'relative'}, {state_dir:path.join(directory,'untrusted')}]) {
      await writeFile(statusFile, JSON.stringify({...status, ...patch}));
      expect(await readSubagentState(directory, 42, configFile, 'https://example.test/being')).toBeNull();
    }
    await writeFile(statusFile, JSON.stringify({...status, ready:false}));
    expect((await readSubagentState(directory, 42, configFile, 'https://example.test/being'))?.ready).toBe(false);
    await writeFile(readyFile, JSON.stringify({pid:42, nonce:'new-launch'}));
    expect(await readSubagentState(directory, 42, configFile, 'https://example.test/being')).toBeNull();
  } finally { await rm(directory, {recursive:true, force:true}); }
});

it('publishes installation completion even when Portal stays connected and there are no tasks', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-install-status-'));
  await writeFile(path.join(directory, 'desktop-portal.toml'), '[subagent]\nstate_dir="state"\n');
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

it('matches the default per-Being state directory and accepts only explicit external overrides', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-state-scope-'));
  const config = path.join(directory, 'desktop-portal.toml');
  const statusFile = path.join(directory, '.portal-subagent-status.json');
  const endpoint = 'https://example.test/being';
  const state = { pid:42, nonce:'launch', enabled:true, configured:true, ready:true };
  try {
    await writeFile(path.join(directory,'.portal-ready.json'), JSON.stringify({pid:42,nonce:'launch'}));
    await writeFile(config, '[subagent]\nenabled=true\n');
    const expected = path.join(process.env.HOME || process.env.USERPROFILE || os.homedir(), '.heart-portal/subagent', createHash('sha256').update('example.test/being').digest('hex').slice(0,16));
    await writeFile(statusFile, JSON.stringify({...state,state_dir:expected}));
    expect((await readSubagentState(directory,42,config,endpoint))?.ready).toBe(true);
    expect(await readSubagentState(directory,42,config,'https://example.test/other')).toBeNull();
    const external = path.join(os.tmpdir(), 'explicit-external-state-fixture');
    await writeFile(statusFile, JSON.stringify({...state,state_dir:external}));
    expect(await readSubagentState(directory,42,config,endpoint)).toBeNull();
    await writeFile(config, '[subagent]\nstate_dir='+JSON.stringify(external)+'\n');
    expect((await readSubagentState(directory,42,config,endpoint))?.state_dir).toBe(external);
  } finally { await rm(directory,{recursive:true,force:true}); }
});

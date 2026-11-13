import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopAPI } from '../desktop/shared/types';
import { HomeConnectors } from '../desktop/main/home/connectors';
import { registerHomeIpc } from '../desktop/main/home/ipc';
import { HomeError } from '../desktop/main/home/protocol';
import { ConnectorNetwork } from '../desktop/main/home/network';

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn() },
  webUtils: {},
}));
vi.mock('electron', () => electron);
afterEach(() => vi.unstubAllGlobals());

describe('Connector desktop Network contract', () => {
  it('preserves a lifecycle retry through preload, the local route and the HTTP transport', async () => {
    vi.stubGlobal('process', { ...process, isMainFrame: true });
    await import('../desktop/preload/preload');
    const desktop = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'beings')![1] as DesktopAPI;
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const request = vi.fn().mockRejectedValueOnce(new Error('Response lost')).mockResolvedValue({});
    const connectors = new HomeConnectors({ request } as never, vi.fn());
    const network = new ConnectorNetwork(() => 'beings://desktop/');
    registerHomeIpc((channel, callback) => handlers.set(channel, callback), {} as never, {} as never, {} as never, connectors, network);
    electron.ipcRenderer.invoke.mockImplementation((channel, ...args) => handlers.get(channel)!(...args));
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => network.handle(new Request(url, init)));
    const id = '00000000-0000-4000-8000-000000000001';
    await expect(desktop.home!.connectors!.lifecycle('installation', 'uninstall', 7, id)).rejects.toThrow('Response lost');
    await desktop.home!.connectors!.lifecycle('installation', 'uninstall', 7, id);
    expect(request.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([
      { action: 'uninstall', expected_revision: 7, request_id: id },
      { action: 'uninstall', expected_revision: 7, request_id: id },
    ]);
    await desktop.home!.connectors!.cancel('pending-intent');
    expect(request).toHaveBeenLastCalledWith('/v1/me/kit-connector-enables/pending-intent/cancel', { method: 'POST' });
    request.mockResolvedValueOnce(undefined);
    await expect(desktop.home!.connectors!.removeAccount('release/id', 'account/id')).resolves.toBeUndefined();
    expect(request).toHaveBeenLastCalledWith('/v1/me/kit-releases/release%2Fid/connector-accounts/account%2Fid/remove', { method: 'POST' });
    request.mockResolvedValueOnce({ id: 'installation', desired_state: 'removed' });
    await expect(desktop.home!.connectors!.installation('installation')).resolves.toMatchObject({ desired_state: 'removed' });
    expect(request).toHaveBeenLastCalledWith('/v1/me/kit-installations/installation');
    const access = { enabled: false, revision: 4, being_profile_id: 'being' };
    request.mockResolvedValueOnce(access);
    await expect(desktop.home!.connectors!.beingAccess('installation')).resolves.toEqual(access);
    expect(request).toHaveBeenLastCalledWith('/v1/me/kit-installations/installation/being-access');
    request.mockResolvedValueOnce({ ...access, enabled: true, revision: 5 });
    await expect(desktop.home!.connectors!.setBeingAccess('installation', true, 4)).resolves.toMatchObject({ enabled: true, revision: 5 });
    expect(request).toHaveBeenLastCalledWith('/v1/me/kit-installations/installation/being-access', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, expected_revision: 4 }) });
    request.mockRejectedValueOnce(new HomeError(409, 'kit_operation_changed'));
    await expect(desktop.home!.connectors!.lifecycle('installation', 'uninstall', 7, id)).resolves.toMatchObject({ accepted: false, message: expect.stringContaining('应用状态已变化') });
    await expect(desktop.home!.connectors!.lifecycle('installation', 'uninstall', 8, 'new-request')).resolves.toEqual({ accepted: true });
  });
});

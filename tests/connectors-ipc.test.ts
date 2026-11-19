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

function connectDesktop(desktop: DesktopAPI, forward: ReturnType<typeof vi.fn>) {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const network = new ConnectorNetwork(() => 'beings://desktop/');
  registerHomeIpc((channel, callback) => handlers.set(channel, callback),
    { contextChanged() {}, state: { authenticated: true, sessionVersion: 0 } } as never,
    {} as never, {} as never, new HomeConnectors({ forward } as never, vi.fn()), network);
  electron.ipcRenderer.invoke.mockImplementation((channel, ...args) => handlers.get(channel)!(...args));
  const visible: { url: string; status: number; body: string; type: string | null }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const response = await network.handle(new Request(url, init));
    visible.push({ url, status: response.status, body: await response.clone().text(), type: response.headers.get('Content-Type') });
    return response;
  });
  return { api: desktop.home!.connectors!, visible };
}

it('preserves lifecycle request IDs and HTTP results through the direct transport', async () => {
  vi.stubGlobal('process', { ...process, isMainFrame: true });
  await import('../desktop/preload/preload');
  const desktop = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'beings')![1] as DesktopAPI;
  const forward = vi.fn()
    .mockRejectedValueOnce(new HomeError(0, 'network'))
    .mockResolvedValueOnce(Response.json({ status: 'preparing' }, { status: 202 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(Response.json({ error: 'kit_operation_changed' }, { status: 409 }));
  const { api, visible } = connectDesktop(desktop, forward);
  const id = '00000000-0000-4000-8000-000000000001';
  await expect(api.lifecycle('installation', 'uninstall', 7, id)).rejects.toThrow('网络连接失败');
  await expect(api.lifecycle('installation', 'uninstall', 7, id)).resolves.toEqual({ accepted: true });
  expect(forward.mock.calls.slice(0, 2).map(([url, init, session]) => ({ url, body: JSON.parse(init.body), session }))).toEqual([0, 1].map(() => ({
    url: '/v1/me/kit-installations/installation/actions', body: { action: 'uninstall', expected_revision: 7, request_id: id }, session: 0,
  })));
  await expect(api.removeAccount('release/id', 'account/id')).resolves.toBeUndefined();
  expect(forward.mock.calls[2][0]).toBe('/v1/me/kit-releases/release%2Fid/connector-accounts/account%2Fid/remove');
  await expect(api.lifecycle('installation', 'uninstall', 7, id)).resolves.toMatchObject({ accepted: false, message: expect.stringContaining('应用状态已变化') });
  expect(visible.map(item => item.status)).toEqual([502, 202, 204, 409]);
});

it.each([404, 405])('makes catalog fallback a second visible request after HTTP %s', async status => {
  vi.stubGlobal('process', { ...process, isMainFrame: true });
  await import('../desktop/preload/preload');
  const desktop = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'beings')![1] as DesktopAPI;
  const originalBody = '<html>Legacy deployment: app catalog unavailable</html>';
  const forward = vi.fn().mockResolvedValueOnce(new Response(originalBody, {
    status, headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })).mockResolvedValueOnce(Response.json({ enabled: true, items: [{ name: 'Fixture', icon_url: '/assets/icon.svg' }, { name: 'Invalid icon', icon_url: 'https://[' }], next_after: null }));
  const { api, visible } = connectDesktop(desktop, forward);
  const catalog = await api.catalog({ q: 'fixture' });
  expect(catalog.items.map(item => item.icon_url)).toEqual(['https://home.beings.town/assets/icon.svg', null]);
  expect(visible.map(item => new URL(item.url).pathname)).toEqual(['/api/v1/me/app-catalog', '/api/v1/me/kit-catalog']);
  expect(visible[0]).toMatchObject({ status, body: originalBody, type: 'text/html; charset=utf-8' });
  expect(visible[1].status).toBe(200);
  expect(forward.mock.calls.map(([url]) => url)).toEqual(['/v1/me/app-catalog?limit=12&q=fixture', '/v1/me/kit-catalog?limit=12&q=fixture']);
});

it('does not hide catalog failures other than unsupported endpoints', async () => {
  vi.stubGlobal('process', { ...process, isMainFrame: true });
  await import('../desktop/preload/preload');
  const desktop = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'beings')![1] as DesktopAPI;
  const forward = vi.fn().mockResolvedValue(new Response('Upstream unavailable', { status: 503, headers: { 'Content-Type': 'text/plain' } }));
  const { api } = connectDesktop(desktop, forward);
  await expect(api.catalog()).rejects.toThrow();
  expect(forward).toHaveBeenCalledTimes(1);
});

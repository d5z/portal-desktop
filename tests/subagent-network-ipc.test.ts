import { afterEach, expect, it, vi } from 'vitest';
import type { DesktopAPI, Snapshot } from '../desktop/shared/types';
import { MutationQueue } from '../desktop/main/app/mutations';
import { registerPortalIpc } from '../desktop/main/portal/ipc';
import type { PortalController } from '../desktop/main/portal/controller';
import { SubagentModelNetwork } from '../desktop/main/portal/subagent-network';
import { probeSubagentModel } from '../desktop/main/portal/subagent-probe';

const electron = vi.hoisted(() => ({ contextBridge: { exposeInMainWorld: vi.fn() }, ipcRenderer: { invoke: vi.fn() }, webUtils: {} }));
vi.mock('electron', () => electron);
afterEach(() => vi.unstubAllGlobals());

it('routes model saves through renderer fetch and preserves failures without retrying over IPC', async () => {
  vi.stubGlobal('process', { ...process, isMainFrame: true });
  await import('../desktop/preload/preload');
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'beings')![1] as DesktopAPI;
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const upstream = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).endsWith('/messages')) return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'OK' }] });
    if (String(url).endsWith('/responses')) return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] });
    return new Response('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const network = new SubagentModelNetwork(() => 'beings://desktop/', error => (error as Error).message, upstream);
  const save = vi.fn(async (input: Parameters<DesktopAPI['save']>[0], request?: typeof fetch) => {
    if (!request) return;
    await probeSubagentModel(input.subagentSetup || { provider: 'portal-custom', model: 'glm5.3flash',
      api: 'openai-completions', base_url: 'https://101.132.86.87/llm/alice/v1', api_key: 'private-token',
    }, request);
  }), before = vi.fn(), after = vi.fn();
  let quitting = false;
  registerPortalIpc({ handle: (channel, fn) => handlers.set(channel, fn), exclusive: new MutationQueue().run,
    controller: { save } as unknown as PortalController, network, isQuitting: () => quitting,
    beforeSave: before, afterSave: after, snapshot: () => ({ settings: { being: 'alice' } } as Snapshot),
  });
  electron.ipcRenderer.invoke.mockReset().mockImplementation((channel, ...args) => handlers.get(channel)!(...args));
  const requests: Request[] = [];
  const statuses: number[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const request = new Request(url, init);
    requests.push(request.clone());
    const response = await network.handle(request);
    statuses.push(response.status);
    return response;
  });

  const input = { subagentInherit: true } as Parameters<DesktopAPI['save']>[0];
  expect(await api.save(input)).toMatchObject({ settings: { being: 'alice' } });
  expect(requests[0].url).toBe('beings://desktop/llm/alice/v1/chat/completions');
  expect(await requests[0].text()).toBe(upstream.mock.calls[0][1]?.body);
  expect(String(upstream.mock.calls[0][1]?.body)).not.toMatch(/subagentInherit|workspace|private-token/);
  expect(save).toHaveBeenCalledExactlyOnceWith(input, expect.any(Function));
  expect(after).toHaveBeenCalledOnce();
  expect(electron.ipcRenderer.invoke).not.toHaveBeenCalledWith('beings:save', input);

  upstream.mockResolvedValueOnce(new Response('<html>Internal Server Error</html>', { status: 500, headers: { 'Content-Type': 'text/html' } }));
  await expect(api.save(input)).rejects.toThrow('HTTP 500');
  expect(statuses).toEqual([200, 500]);
  expect(save).toHaveBeenCalledTimes(2);
  expect(after).toHaveBeenCalledOnce();

  quitting = true;
  await expect(api.save(input)).rejects.toThrow('正在退出');
  expect(save).toHaveBeenCalledTimes(2);
  expect(before).toHaveBeenCalledTimes(2);
  quitting = false;
  const ordinary = {} as Parameters<DesktopAPI['save']>[0];
  await api.save(ordinary);
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith('beings:save', ordinary);
  expect(requests).toHaveLength(3);

  for (const [provider, base_url, protocol, pathname] of [
    ['openrouter', undefined, undefined, '/api/v1/chat/completions'],
    ['anthropic', undefined, undefined, '/v1/messages'],
    ['portal-custom', 'https://models.example/custom/v1', 'openai-responses', '/custom/v1/responses'],
  ]) {
    await api.save({ ...ordinary, subagentInherit: false, subagentSetup: {
      provider: provider!, model: ' fixture ', api_key: '', thinking: 'off', base_url: base_url ? ` ${base_url} ` : undefined, api: protocol,
    } });
    expect(requests.at(-1)?.url).toBe(`beings://desktop${pathname}`);
    expect(JSON.parse(String(upstream.mock.calls.at(-1)?.[1]?.body)).model).toBe('fixture');
    expect(save.mock.calls.at(-1)?.[0].subagentSetup?.model).toBe('fixture');
  }
});

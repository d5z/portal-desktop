import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: {}, dialog: {}, protocol: { handle: vi.fn() }, session: {}, shell: {} }));
import { protocol } from 'electron';
import { registerLocalProtocol } from '../desktop/main/app/protocol';
import { ChatProxy } from '../desktop/main/chat/proxy';
import type { AttachmentDownloads } from '../desktop/main/chat/downloads';

beforeEach(() => vi.clearAllMocks());
it.each(['beings://desktop/', 'http://localhost:5173/'])('permits the shell %s preflight and preserves raw upstream responses', async shell => {
  const upstream = vi.fn(async () => new Response('original failure', {status:429,headers:{'Content-Type':'text/plain'}}));
  const proxy = new ChatProxy(() => ({endpoint:'https://fixture.test/being',being:'being',token:'private',relaySecret:'private',link:''}), upstream);
  registerLocalProtocol('/unused',proxy,undefined,{} as AttachmentDownloads,undefined,undefined,undefined,undefined,()=>shell);
  const handle = vi.mocked(protocol.handle).mock.calls[0][1];
  const url = new URL(shell), origin = `${url.protocol}//${url.host}`;
  const preflight = await handle(new Request('beings://chat/api/llm/config', {method:'OPTIONS',headers:{Origin:origin}}));
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
  expect(upstream).not.toHaveBeenCalled();
  const response = await handle(new Request('beings://chat/api/llm/config', {method:'PATCH',headers:{Origin:origin},body:'{"thinking":"high"}'}));
  expect(response.status).toBe(429);
  expect(response.headers.get('content-type')).toBe('text/plain');
  expect(await response.text()).toBe('original failure');
  expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  const forbidden = await handle(new Request('beings://chat/api/llm/config',{headers:{Origin:'https://untrusted.test'}}));
  expect(forbidden.status).toBe(403);
  expect(upstream).toHaveBeenCalledTimes(1);
});

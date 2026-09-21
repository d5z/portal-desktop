import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ClientCommandServer } from '../desktop/main/chat/client-server';
import { handleClientCommand, type ClientHistory } from '../desktop/renderer/chat/services/client-commands';

const history: ClientHistory = {
  context: async (id, limit) => {
    expect(limit).toBe(50);
    return id === 'empty' ? [] : [{ seq: 1, scene_id: id, role: 'user', content: '你好', at: '2026-09-21T00:00:00Z' }];
  },
  scenes: async () => [{ sceneId: 'a', messageCount: 2 }, { sceneId: 'b', label: '讨论', messageCount: 3, lastActive: '2026-09-21T00:00:00Z' }],
};
describe('client commands', () => {
  it('uses explicit or calling scene, gives actionable empty/missing errors', async () => {
    expect(await handleClientCommand(history, 'context', '', 'a')).toContain('Scene a');
    expect(await handleClientCommand(history, 'context', ' b ', 'a')).toContain('Scene b');
    expect(await handleClientCommand(history, 'context', 'empty')).toContain('no locally cached');
    await expect(handleClientCommand(history, 'context', '')).rejects.toThrow('No calling scene');
    await expect(handleClientCommand(history, 'context', 'a b')).rejects.toThrow('Usage');
    await expect(handleClientCommand(history, 'scenes', 'extra')).rejects.toThrow('Usage');
    await expect(handleClientCommand(history, 'shell', 'echo bad')).rejects.toThrow('unknown');
  });
  it('lists activity and counts and bounds large Unicode messages', async () => {
    const scenes = await handleClientCommand(history, 'scenes', '');
    expect(scenes.indexOf('b — 讨论')).toBeLessThan(scenes.indexOf('a |'));
    expect(scenes).toContain('messages: 3');
    const output = await handleClientCommand({ ...history, context: async () => Array.from({ length: 50 }, (_, seq) => ({ seq, role: 'being', content: '文'.repeat(50_000) })) }, 'context', 'a');
    expect(output.length).toBeLessThan(49_000);
    expect(output).toContain('[truncated]');
  });
  it('authenticates local requests and rejects Being changes before and during reads', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'client-commands-'));
    let endpoint = 'https://fixture.test/a';
    let switchDuringRead = false;
    const server = new ClientCommandServer(path.join(directory, 'client.json'), () => endpoint, async request => {
      if (switchDuringRead) endpoint = 'https://fixture.test/b';
      return handleClientCommand(history, request.verb, request.args, request.sceneId);
    });
    try {
      await server.start();
      const { port, token } = JSON.parse(await readFile(path.join(directory, 'client.json'), 'utf8'));
      const post = (authorization = `Bearer ${token}`, override = {}) => fetch(`http://127.0.0.1:${port}/command`, { method: 'POST', headers: { authorization }, body: JSON.stringify({ endpoint: 'https://fixture.test/a', verb: 'context', args: '', sceneId: 'a', ...override }) });
      expect((await post('bad')).status).toBe(403);
      expect((await post(undefined, { endpoint: 'https://fixture.test/b' })).status).toBe(409);
      expect((await (await post()).json()).text).toContain('你好');
      switchDuringRead = true;
      expect((await post()).status).toBe(409);
    } finally { await server.close(); await rm(directory, { recursive: true, force: true }); }
  });
});

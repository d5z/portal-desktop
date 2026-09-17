import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TownClient, TownCredentials, townRoute } from '../desktop/main/town/client';
import type { TownQuery } from '../desktop/shared/types';

describe('Town reads', () => {
  it('routes only fixed resources with constrained identifiers and pagination', () => {
    expect(townRoute({ kind: 'sent' }).route).toBe('/api/messages?with=sent');
    expect(townRoute({ kind: 'fireside-members', id: '10' }).route).toBe('/api/fireside/members?fireside_id=10');
    expect(townRoute({ kind: 'scrolls', offset: 24 }).route).toContain('visibility=public&limit=24&offset=24');
    expect(townRoute({ kind: 'grove', offset: 24, groveStatus: 'growing' })).toEqual({ route: '/api/grove?limit=24&offset=24&status=growing', private: false });
    expect(townRoute({ kind: 'grove' }).route).toBe('/api/grove?limit=24&offset=0');
    for (const query of [{ kind: 'kit', id: '../messages' }, { kind: 'kit', id: 'x?token=secret' }, { kind: 'grove', offset: -1 }, { kind: 'grove', groveStatus: 'rot&token=secret' }, { kind: 'exec' }]) expect(() => townRoute(query as TownQuery)).toThrow();
  });
  it('uses dedicated bearer only for restricted routes, never public requests', async () => {
    const fetcher = vi.fn(async () => Response.json({ messages: [] }));
    const client = new TownClient(() => 'town-credential', fetcher as typeof fetch);
    await client.query({ kind: 'home' }); await client.query({ kind: 'inbox' }); await client.query({ kind: 'grove', groveStatus: 'grown' });
    expect(fetcher.mock.calls[0]).toEqual(['https://beings.town/api', expect.objectContaining({ headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error', method: 'GET' })]);
    expect(fetcher.mock.calls[1]).toEqual(['https://beings.town/api/messages?with=received', expect.objectContaining({ headers: { Accept: 'application/json', Authorization: 'Bearer town-credential' } })]);
    expect(fetcher.mock.calls[2]).toEqual(['https://beings.town/api/grove?limit=24&offset=0&status=grown', expect.objectContaining({ headers: { Accept: 'application/json' }, credentials: 'omit' })]);
  });
  it('normalizes the fireside members array while keeping the route authenticated', async () => {
    const members = [{ town_id: 't_Willow', display_name: '柳树', joined_at: '2026-09-01T12:00:00+08:00' }];
    const fetcher = vi.fn(async () => Response.json(members));
    const client = new TownClient(() => 'town-credential', fetcher as typeof fetch);
    expect(await client.query({ kind: 'fireside-members', id: '10' })).toMatchObject({ ok: true, data: { members } });
    expect(fetcher).toHaveBeenCalledWith('https://beings.town/api/fireside/members?fireside_id=10', expect.objectContaining({ headers: { Accept: 'application/json', Authorization: 'Bearer town-credential' } }));
  });
  it('distinguishes authorization failure, offline, invalid HTML and upstream error', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('secret error text', { status: 401 })).mockRejectedValueOnce(new Error('URL with secret')).mockResolvedValueOnce(new Response('<html>loom</html>', { headers: { 'content-type': 'text/html' } })).mockResolvedValueOnce(new Response('', { status: 503 }));
    const client = new TownClient(() => '', fetcher);
    expect(await client.query({ kind: 'bonfire' })).toMatchObject({ ok: false, code: 'auth' });
    expect(await client.query({ kind: 'inbox' })).toMatchObject({ ok: false, code: 'network' });
    expect(await client.query({ kind: 'scrolls' })).toMatchObject({ ok: false, code: 'network' });
    expect(await client.query({ kind: 'home' })).toMatchObject({ ok: false, code: 'http' });
  });
  it('bounds body size and cancels an oversized stream', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(5 * 1024 * 1024)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } });
    const client = new TownClient(() => '', async () => response);
    expect(await client.query({ kind: 'home' })).toMatchObject({ ok: false }); expect(cancelled).toBe(true);
  });
  it('persists encrypted Town credentials independently and can clear them', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'town-test-'));
    const storage = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s.split('').reverse().join('')), decryptString: (b: Buffer) => b.toString().split('').reverse().join('') };
    try {
      const credentials = new TownCredentials(directory, storage); await credentials.load();
      await credentials.save('town-secret-fixture-123');
      expect(await readFile(path.join(directory, 'town-credential.json'), 'utf8')).not.toContain('town-secret-fixture-123');
      const reopened = new TownCredentials(directory, storage); await reopened.load(); expect(reopened.token).toBe('town-secret-fixture-123');
      await reopened.save(''); await credentials.load(); expect(credentials.token).toBe('');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe('Town SDK 2769e2f protocol', () => {
  it('preserves successful mention warnings without treating an accepted post as a failed send', async () => {
    const token = 'client-fixture-token';
    const fetcher = vi.fn(async () => Response.json({ ok: true, seq: 12, mention_warnings: [
      { token: 'Neo', reason: 'ambiguous', hint: '请用 Town ID ' + token, candidates: [{ town_id: 't_NeoA', display_name: 'Neo' }, { town_id: 't_NeoB', display: 'Neo (t_NeoB)' }] },
    ] }));
    const client = new TownClient(() => token, fetcher as typeof fetch);
    const result = await client.send({ kind: 'bonfire', content: '@Neo 你好' });
    expect(result).toMatchObject({ ok: true, warnings: [expect.stringContaining('Neo')] });
    if (!result.ok) throw new Error('post should succeed');
    expect(result.warnings?.join(' ')).toContain('t_NeoA');
    expect(result.warnings?.join(' ')).toContain('t_NeoB');
    expect(result.warnings?.join(' ')).not.toContain(token);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('shows structured recipient and pairing ambiguity details without selecting or retrying a candidate', async () => {
    const warning = { token: 'Neo', reason: 'ambiguous', hint: '请用完整 Town ID', candidates: [{ town_id: 't_NeoA', display_name: 'Neo' }, { town_id: 't_NeoB', display_name: 'Neo' }] };
    const fetcher = vi.fn(async () => Response.json({ error: 'ambiguous', recipient_warning: warning, candidates: warning.candidates }, { status: 400 }));
    const client = new TownClient(() => 'fixture-token', fetcher as typeof fetch);
    expect(await client.send({ kind: 'dm', recipient: 'Neo', content: '你好' })).toMatchObject({ ok: false, message: expect.stringContaining('t_NeoB') });
    await expect(client.pair({ beingId: 't_Neo', code: 'AB3XY9' })).rejects.toThrow('t_NeoA');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses native reply_to fields and rejects invalid reply references before posting', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    const client = new TownClient(() => 'fixture-token', fetcher as typeof fetch);
    await client.send({ kind: 'bonfire', content: 'reply', replyTo: 123 });
    await client.send({ kind: 'dm', recipient: 'river', content: 'reply', replyTo: 'mail-1' });
    await client.send({ kind: 'fireside', firesideId: '10', content: 'reply', replyTo: 8 });
    const bodies = (fetcher.mock.calls as unknown as [string, RequestInit][]).map(([, options]) => JSON.parse(String(options.body)));
    expect(bodies).toEqual([{ message: 'reply', reply_to: 123 }, { recipient: 'river', content: 'reply', reply_to: 'mail-1' }, { fireside_id: 10, message: 'reply', reply_to: 8 }]);
    for (const replyTo of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) await expect(client.send({ kind: 'bonfire', content: 'reply', replyTo })).rejects.toThrow('回复目标');
    await expect(client.send({ kind: 'dm', recipient: 'river', content: 'reply', replyTo: '../another-thread' })).rejects.toThrow('回复目标');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('pairs anonymously and immediately returns the one-time client token to secure storage', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, token: 'a'.repeat(64), being_id: 'willow' }));
    const client = new TownClient(() => 'must-not-send-existing-token', fetcher as typeof fetch);
    expect(await client.pair({ beingId: 'Willow', code: 'ab3xy9' })).toEqual({ token: 'a'.repeat(64), beingId: 'willow' });
    const request = (fetcher.mock.calls as unknown[][])[0][1] as RequestInit;
    expect(request.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json' });
    expect(JSON.parse(request.body as string)).toEqual({ being_id: 'willow', code: 'AB3XY9' });
  });
  it('sends the documented bodies for all three channels without inventing via or identity events', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, via: 'client:desktop', seq: 3 }));
    const client = new TownClient(() => 'client-fixture-token', fetcher as typeof fetch);
    for (const input of [{ kind: 'bonfire', content: '篝火' }, { kind: 'dm', recipient: 'River', content: '私信' }, { kind: 'fireside', firesideId: '10', content: '围炉' }] as const) {
      expect(await client.send(input)).toMatchObject({ ok: true, data: { via: 'client:desktop' } });
    }
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url, options]) => [url, JSON.parse(options.body as string)])).toEqual([
      ['https://beings.town/api/bonfire/speak', { message: '篝火' }],
      ['https://beings.town/api/messages', { recipient: 'River', content: '私信' }],
      ['https://beings.town/api/fireside/speak', { fireside_id: 10, message: '围炉' }],
    ]);
    expect(calls.every(([, options]) => (options.headers as Record<string, string>).Authorization === 'Bearer client-fixture-token')).toBe(true);
    expect(townRoute({ kind: 'fireside', id: '10' }).route).toBe('/api/fireside/hear?fireside_id=10&limit=50');
  });
  it('prevents silent bonfire truncation and oversized fireside sends using Unicode character counts', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    const client = new TownClient(() => 'client-fixture-token', fetcher as typeof fetch);
    expect(await client.send({ kind: 'bonfire', content: '🌱'.repeat(4000) })).toMatchObject({ ok: true });
    await expect(client.send({ kind: 'bonfire', content: '🌱'.repeat(4001) })).rejects.toThrow('4000');
    await expect(client.send({ kind: 'fireside', firesideId: '10', content: '中'.repeat(32001) })).rejects.toThrow('32000');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects self DM IDs locally, preserves server membership/recipient errors and never retries writes', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: 'cannot send message to yourself' }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ error: 'not a member', hint: 'join the ring first' }, { status: 403 }))
      .mockRejectedValueOnce(new Error('private connection failure'));
    const client = new TownClient(() => 'client-fixture-token', fetcher, 'https://beings.town', () => 'willow');
    await expect(client.send({ kind: 'dm', recipient: ' willow ', content: 'test' })).rejects.toThrow('自己');
    expect(fetcher).not.toHaveBeenCalled();
    expect(await client.send({ kind: 'dm', recipient: 'Willow display name', content: 'test' })).toMatchObject({ ok: false, code: 'http', message: expect.stringContaining('cannot send message to yourself') });
    expect(await client.send({ kind: 'fireside', firesideId: '10', content: 'test' })).toMatchObject({ ok: false, code: 'forbidden', message: expect.stringContaining('join the ring first') });
    expect(await client.send({ kind: 'bonfire', content: 'test' })).toMatchObject({ ok: false, code: 'network', message: expect.stringContaining('可能已送达') });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

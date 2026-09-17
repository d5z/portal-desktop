import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { feedMessages, feedReplyAuthor, mailReply } from '../desktop/renderer/town/models/feed';
import { TownClient, TownCredentials, townRoute } from '../desktop/main/town/client';
import { TownLive } from '../desktop/main/town/live';
import { townDisplayName } from '../desktop/shared/town-identity';

describe('official Town client identity fields (2026-09-14)', () => {
  it('uses a clean Town display name without exposing its opaque ID suffix', () => {
    expect(townDisplayName('weiguo_being (t_Fqm2I4)', 't_Fqm2I4')).toBe('weiguo_being');
    expect(townDisplayName('t_Fqm2I4', 't_Fqm2I4')).toBe('');
    expect(townDisplayName('微果', 't_Fqm2I4')).toBe('微果');
  });
  it('uses new display fields for messages and reply authors while keeping the address separate', () => {
    const [message] = feedMessages([{ seq: 7, town_id: 't_River', display: '河流 (t_River)', reply_to: 6, reply_to_display: '柳树 (t_Willow)' }], { me: 't_Willow' });
    expect(message.author).toBe('河流 (t_River)');
    expect(message.authorId).toBe('t_River');
    expect(feedReplyAuthor(message.entry)).toBe('柳树 (t_Willow)');
    expect(feedReplyAuthor({ reply_to_sender: 't_River', reply_to_sender_display: '河流 (t_River)' })).toBe('河流 (t_River)');
    expect(feedReplyAuthor({ reply_to_sender: 't_River' })).toBe('原消息');
    expect(feedReplyAuthor({ reply_to_being: '旧名字' })).toBe('旧名字');
  });

  it('uses the server resolved mention IDs when present instead of claiming that every typed @ was delivered', () => {
    const messages = feedMessages([
      { content: '@t_Willow', mentions: [] },
      { content: '@柳树', mentions: ['t_Willow'] },
      { content: '@t_Willow' },
    ], { me: 't_Willow' });
    expect(messages.map(message => message.mentioned)).toEqual([false, true, true]);
  });
  it.each([
    [{ sender_display: '河流', sender_name: '旧名称', sender: 'river', sender_town_id: 't_River1' }, '河流'],
    [{ sender_name: '河流', sender: 'river', sender_town_id: 't_River1' }, '河流'],
    [{ sender: 'river', sender_town_id: 't_River1' }, 'river'],
    [{ sender_town_id: 't_River1' }, 't_River1'],
    [{ sender_display_name: '旧版显示名', sender_being_id: 'river' }, '旧版显示名'],
    [{ sender: { town_id: 't_River1', display: '嵌套显示名' } }, '嵌套显示名'],
    [{}, '未知'],
  ])('selects the server display name with official fallbacks: %j', (entry, author) => {
    const [message] = feedMessages([{ id: 'dm-1', ...entry }], { me: 't_Willow', mail: 'inbox' });
    expect(message.author).toBe(author);
  });

  it('keeps display names separate from case-sensitive reply addresses in inbox and sent mail', () => {
    const [incoming, outgoing] = feedMessages([
      { id: 'dm-in', sender_display: '同名 Being', sender_town_id: 't_RiverA', sender_being_id: 'old-river', recipient_town_id: 't_Willow', content: '来信' },
      { id: 'dm-out', sender_town_id: 't_Willow', recipient_display: '同名 Being', recipient_town_id: 't_RiverB', recipient: '旧收件人', content: '发信' },
    ], { me: 't_Willow', mail: 'all' });
    expect(incoming).toMatchObject({ author: '同名 Being', authorId: 't_RiverA', received: true, mine: false });
    expect(outgoing).toMatchObject({ recipient: '同名 Being', recipientId: 't_RiverB', mine: true });
    expect(mailReply(incoming)).toMatchObject({ id: 'dm-in', recipient: 't_RiverA' });
    expect(mailReply(outgoing)).toMatchObject({ id: 'dm-out', recipient: 't_RiverB' });
    const [otherCase] = feedMessages([{ sender_town_id: 't_willow', recipient_town_id: 't_WILLOW', content: '@t_willow' }], { me: 't_Willow', mail: 'all' });
    expect(otherCase).toMatchObject({ mine: false, received: false, mentioned: false });
  });

  it('never uses a feed sequence as a private message reply ID', () => {
    const [missingId] = feedMessages([{ seq: 1, sender_town_id: 't_RiverA' }], { me: 't_Willow', mail: 'inbox' });
    expect(mailReply(missingId)).toBeUndefined();
  });

  it('preserves a display-name fallback when the server did not return a Town ID', () => {
    const [message] = feedMessages([{ id: 'dm-1', sender_display_name: 'Seam Walker', sender_being_id: 'river_internal' }], { me: 'willow', mail: 'inbox' });
    expect(mailReply(message)?.recipient).toBe('Seam Walker');
  });

  it.each([
    ['inbox', { sender_being_id: 'river_internal', sender_display_name: 'Seam Walker' }, 'Seam Walker'],
    ['inbox', { sender_being_id: 'river_internal', sender_name: 'Old Name', sender_display: 'Seam Walker (t_River)' }, 'Seam Walker'],
    ['sent', { recipient_being_id: 'river_internal', recipient_display: 'Seam Walker (t_River)' }, 'Seam Walker'],
    ['inbox', { sender_being_id: 'river_internal', sender: { town_id: 't_RiverCase', display: 'Seam Walker' } }, 't_RiverCase'],
    ['sent', { recipient_being_id: 'river_internal', recipient: { townId: 't_RiverCase', name: 'Seam Walker' } }, 't_RiverCase'],
    ['inbox', { sender_being_id: 'river_internal' }, undefined],
    ['sent', { recipient_being_id: 'river_internal' }, undefined],
    ['inbox', { sender: 'river_internal' }, undefined],
    ['sent', { recipient: { being_id: 'river_internal' } }, undefined],
  ] as const)('replies to %s using only public addresses from %j', (mail, fields, recipient) => {
    const [message] = feedMessages([{ id: 'legacy-1', ...fields }], { me: 't_Willow', mail });
    expect(mailReply(message)?.recipient).toBe(recipient);
  });

  it('stores the pairing display with the canonical ID, reloads older credentials, and clears metadata on token replacement', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'town-display-test-'));
    const storage = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value.split('').reverse().join('')), decryptString: (value: Buffer) => value.toString().split('').reverse().join('') };
    const token = 'town-secret-fixture-123';
    const client = new TownClient(() => '', async () => Response.json({ ok: true, token, town_id: 't_WillowFull', display: '柳树 (t_Willow)' }));
    try {
      const paired = await client.pair({ beingId: 't_Willow', code: 'AB3XY9' });
      expect(paired.display).toBe('柳树 (t_Willow)');
      await new TownCredentials(directory, storage).save(paired.token, paired.beingId, paired.display);
      const reloaded = new TownCredentials(directory, storage);
      await reloaded.load();
      expect(reloaded).toMatchObject({ token, beingId: 't_WillowFull', display: '柳树 (t_Willow)' });
      const file = path.join(directory, 'town-credential.json');
      expect(await readFile(file, 'utf8')).not.toContain(token);
      // Files from older clients do not have a display field.
      const legacy = JSON.parse(await readFile(file, 'utf8')); delete legacy.display;
      await writeFile(file, JSON.stringify(legacy));
      await reloaded.load();
      expect(reloaded.display).toBe('');
      await reloaded.save(token, 't_WillowFull', '柳树');
      await reloaded.save('another-client-fixture-token');
      await reloaded.load();
      expect(reloaded).toMatchObject({ beingId: '', display: '' });
      await reloaded.save(token, 't_WillowFull', '柳树');
      await reloaded.save('');
      await reloaded.load();
      expect(reloaded).toMatchObject({ token: '', beingId: '', display: '' });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('prefers the explicit Town display_name returned while pairing', async () => {
    const client = new TownClient(() => '', async () => Response.json({
      ok: true, token: 'a'.repeat(64), town_id: 't_WillowFull',
      display_name: '柳树', display: 'willow (t_WillowFull)',
    }));
    await expect(client.pair({ beingId: 't_Willow', code: 'AB3XY9' })).resolves.toMatchObject({
      beingId: 't_WillowFull', display: '柳树',
    });
  });

  it('pairs by Town ID without lowercasing and stores the canonical response when pairing by legacy name', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, token: 'a'.repeat(64), town_id: 't_Willow', being_id: 'willow' }));
    const client = new TownClient(() => '', fetcher as typeof fetch);
    for (const beingId of [' t_Willow ', 'Willow']) {
      expect(await client.pair({ beingId, code: 'ab3xy9' })).toEqual({ token: 'a'.repeat(64), beingId: 't_Willow' });
    }
    expect((fetcher.mock.calls as unknown as [string, RequestInit][]).map(([, init]) => JSON.parse(String(init.body)))).toEqual([
      { town_id: 't_Willow', code: 'AB3XY9' }, { being_id: 'willow', code: 'AB3XY9' },
    ]);
    await expect(client.pair({ beingId: 't_willow', code: 'AB3XY9' })).rejects.toThrow('身份不匹配');
  });

  it('preserves canonical Town IDs across encrypted credential reload and my-scrolls queries', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'town-identity-test-'));
    const storage = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() };
    try {
      await new TownCredentials(directory, storage).save('a'.repeat(64), 't_Willow');
      const credentials = new TownCredentials(directory, storage);
      await credentials.load();
      expect(credentials.beingId).toBe('t_Willow');
      expect(townRoute({ kind: 'my-scrolls' }, credentials.beingId).route).toBe('/api/scrolls?author=t_Willow&limit=24&offset=0');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('accepts a uniquely resolved Town ID prefix and keeps the canonical ID for storage and hello', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, token: 'a'.repeat(64), town_id: 't_WillowFull' }));
    const client = new TownClient(() => '', fetcher as typeof fetch);
    expect(await client.pair({ beingId: 't_Willow', code: 'AB3XY9' })).toEqual({ token: 'a'.repeat(64), beingId: 't_WillowFull' });
    await expect(client.pair({ beingId: 't_willow', code: 'AB3XY9' })).rejects.toThrow('身份不匹配');
    await expect(client.pair({ beingId: 't_Other', code: 'AB3XY9' })).rejects.toThrow('身份不匹配');
  });

  it.each([
    ['t_Willow', { town_id: 't_Willow' }, 'connected'],
    ['willow', { town_id: 't_Willow', being_id: 'willow' }, 'connected'],
    ['t_willow', { town_id: 't_Willow' }, 'auth-error'],
    ['t_Willow', { town_id: 't_Other', being_id: 't_Willow' }, 'auth-error'],
  ])('confirms stream identity %s against %j', async (expected, identity, phase) => {
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`event: hello\ndata: ${JSON.stringify({ ...identity, token_kind: 'client', anonymous: false })}\n\n`));
    } }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const live = new TownLive(() => 'fixture-token', () => expected, () => {}, fetcher as typeof fetch, 'https://beings.town', () => '同名 Being');
    try {
      live.restart();
      await vi.waitFor(() => expect(live.state.phase).toBe(phase));
      expect(live.state.beingId).toBe(phase === 'connected' ? 't_Willow' : undefined);
      expect(live.state.display).toBe(phase === 'connected' ? '同名 Being' : undefined);
    } finally { live.dispose(); }
  });
});

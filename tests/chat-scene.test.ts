import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadDesktopScene } from '../desktop/main/chat/scene';
import { ChatProxy } from '../desktop/main/chat/proxy';
import { parseConnection } from '../desktop/main/chat/connection';

const directories: string[] = [];
async function profile() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'portal-chat-scene-'));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const target = path.resolve(directory);
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('portal-chat-scene-')) throw new Error('Unexpected test directory');
    await rm(target, { recursive: true, force: true });
  }
});

describe('persistent desktop room', () => {
  it('keeps its ID across restart and upgrade, updates labels, and separates profiles', async () => {
    const directory = await profile();
    const first = await loadDesktopScene(directory, '0.1.2', '广春泽PC');
    expect(first.scene_id).toMatch(/^desktop-[0-9a-f-]{36}$/);
    expect(first.scene_meta).toEqual({ client: 'portal-desktop/0.1.2', scene_label: '桌面·广春泽PC' });
    expect(await loadDesktopScene(directory, '0.1.2', '广春泽PC')).toEqual(first);
    const upgraded = await loadDesktopScene(directory, '0.1.3', '新设备名');
    expect(upgraded.scene_id).toBe(first.scene_id);
    expect(upgraded.scene_meta).toEqual({ client: 'portal-desktop/0.1.3', scene_label: '桌面·新设备名' });
    expect(JSON.parse(await readFile(path.join(directory, 'chat-scene.json'), 'utf8'))).toEqual({ scene_id: first.scene_id });
    const other = await loadDesktopScene(path.join(directory, 'other-profile'), '0.1.2', '广春泽PC');
    expect(other.scene_id).not.toBe(first.scene_id);
  });

  it.each(['{incomplete', '{"scene_id":""}'])('preserves an invalid saved identity instead of silently switching rooms: %s', async saved => {
    const directory = await profile(), file = path.join(directory, 'chat-scene.json');
    await writeFile(file, saved);
    await expect(loadDesktopScene(directory, '0.1.2', 'PC')).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe(saved);
  });

  it('does not return a temporary identity if persistence fails', async () => {
    const directory = await profile();
    await mkdir(path.join(directory, 'chat-scene.json.tmp'));
    await expect(loadDesktopScene(directory, '0.1.2', 'PC')).rejects.toThrow();
    await expect(readFile(path.join(directory, 'chat-scene.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('desktop scene request scope', () => {
  const connection = parseConnection('https://fixture.test/alice/?token=fixture');
  const scene = { scene_id: 'desktop-fixture', scene_meta: { client: 'portal-desktop/0.1.2', scene_label: '桌面·PC' } };

  it.each([scene, undefined])('leaves history, stop and config requests unchanged when the scene is %j', async configuredScene => {
    const upstream = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = new Request('https://fixture.test', init);
      return Response.json({ body: await request.text() });
    });
    for (const [route, method, body] of [
      ['/api/stop', 'POST', '{ "stream_id": "stream" }'],
      ['/api/llm/config', 'PATCH', '{ "sbs_enabled": "off" }'],
      ['/api/history', 'GET', undefined],
    ] as const) {
      const proxy = new ChatProxy(() => connection, upstream, configuredScene);
      const result = await proxy.handle(new Request('beings://chat' + route, { method, body }));
      expect(await result.json()).toEqual({ body: body || '' });
    }
  });

  it.each(['loom-Willow', 'all', 'desktop-other'])('overrides renderer scene %s with the persistent desktop identity', async rendererScene => {
    const upstream = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => Response.json(await new Request('https://fixture.test', init).json()));
    const proxy = new ChatProxy(() => connection, upstream, scene);
    const body = { message: '保持原文', session_id: 'session-fixture', attachments: [{ media_type: 'text/plain', data: 'YWJj' }] };
    const result = await proxy.handle(new Request('beings://chat/api/chat/stream', { method: 'POST', body: JSON.stringify({
      ...body, scene_id: rendererScene, scene_meta: { client: 'loom-web', scene_label: '网页' },
    }) }));
    expect(await result.json()).toEqual({ ...body, ...scene });
  });

  it.each([{}, { scene_id: 'loom-Willow', scene_meta: { client: 'loom-web', scene_label: '网页' } }])('blocks sending without a desktop identity even if the renderer supplies %j', async suppliedScene => {
    const upstream = vi.fn();
    const proxy = new ChatProxy(() => connection, upstream);
    const result = await proxy.handle(new Request('beings://chat/api/chat/stream', { method: 'POST', body: JSON.stringify({ message: '你好', ...suppliedScene }) }));
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ error: '客户端场景不可用，暂时无法发送消息。请检查启动提示并重启客户端。' });
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each(['{invalid', 'null', '[]', '"message"'])('rejects invalid chat JSON before sending: %s', async body => {
    const upstream = vi.fn();
    const proxy = new ChatProxy(() => connection, upstream, scene);
    const result = await proxy.handle(new Request('beings://chat/api/chat/stream', { method: 'POST', body }));
    expect(result.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe('multiple sessions for one Being', () => {
  it('moves and removes a selection atomically, preserves order and replaces an empty list once', async () => {
    const { ChatSessions } = await import('../desktop/main/chat/scene');
    const directory = await profile(), original = await loadDesktopScene(directory, 'test', 'PC');
    const sessions = new ChatSessions(directory, original);
    await sessions.load();
    for (const id of ['b', 'c', 'd']) await sessions.change('alice', 'bind', id, id);
    await sessions.change('alice', 'move', ['d', 'b'], original.scene_id);
    expect(sessions.list('alice').map(item => item.scene_id)).toEqual(['b', 'd', original.scene_id, 'c']);
    expect(sessions.current('alice').scene_id).toBe('d');
    const saved = await readFile(path.join(directory, 'chat-sessions.json'), 'utf8');
    for (const operation of ['move', 'delete'] as const) {
      for (const ids of [[], ['b', 'missing']]) await expect(sessions.change('alice', operation, ids)).rejects.toThrow('不存在');
      expect(await readFile(path.join(directory, 'chat-sessions.json'), 'utf8')).toBe(saved);
    }
    await sessions.change('alice', 'delete', ['b', 'c']);
    expect(sessions.current('alice').scene_id).toBe('d');
    const reopened = new ChatSessions(directory, original); await reopened.load();
    expect(reopened.list('alice').map(item => item.scene_id)).toEqual(['d', original.scene_id]);
    expect(reopened.list('bob')).toEqual([original]);
    await reopened.change('alice', 'delete', ['d', original.scene_id]);
    expect(reopened.list('alice')).toHaveLength(1);
    expect(reopened.current('alice').scene_meta.scene_label).toBe('新场景');
  });

  it.each(['move', 'delete'] as const)('rolls back the whole batch when %s cannot be saved', async operation => {
    const { ChatSessions } = await import('../desktop/main/chat/scene');
    const directory = await profile(), original = await loadDesktopScene(directory, 'test', 'PC');
    const sessions = new ChatSessions(directory, original);
    await sessions.load();
    for (const id of ['b', 'c']) await sessions.change('alice', 'bind', id, id);
    const saved = sessions.list('alice'), active = sessions.current('alice');
    await mkdir(path.join(directory, 'chat-sessions.json.tmp'));
    await expect(sessions.change('alice', operation, ['b', 'c'], original.scene_id)).rejects.toThrow();
    expect(sessions.list('alice')).toEqual(saved);
    expect(sessions.current('alice')).toEqual(active);
  });

  it('persists relative moves per Being without changing selection and rejects stale targets atomically', async () => {
    const { ChatSessions } = await import('../desktop/main/chat/scene');
    const directory = await profile();
    const original = await loadDesktopScene(directory, 'test', 'PC');
    const sessions = new ChatSessions(directory, original);
    await sessions.load();
    await sessions.change('alice', 'bind', 'B', 'b');
    await sessions.change('alice', 'bind', 'C', 'c');
    await sessions.change('alice', 'move', 'c', original.scene_id);
    expect(sessions.list('alice').map(scene => scene.scene_id)).toEqual(['c', original.scene_id, 'b']);
    expect(sessions.current('alice').scene_id).toBe('c');
    expect(sessions.list('bob')).toEqual([original]);
    await sessions.change('alice', 'move', 'c');
    const reopened = new ChatSessions(directory, original);
    await reopened.load();
    const saved = reopened.list('alice');
    expect(saved.map(scene => scene.scene_id)).toEqual([original.scene_id, 'b', 'c']);
    expect(reopened.current('alice').scene_id).toBe('c');
    for (const [id, target] of [['missing', 'b'], ['b', 'missing']])
      await expect(reopened.change('alice', 'move', id, target)).rejects.toThrow('不存在');
    expect(reopened.list('alice')).toEqual(saved);
    await mkdir(path.join(directory, 'chat-sessions.json.tmp'));
    await expect(reopened.change('alice', 'move', 'b', original.scene_id)).rejects.toThrow();
    expect(reopened.list('alice')).toEqual(saved);
  });
  it('binds external scene IDs, deduplicates, persists and only removes the local entry', async () => {
    const { ChatSessions } = await import('../desktop/main/chat/scene');
    const directory = await profile();
    const original = await loadDesktopScene(directory, 'test', 'PC');
    const sessions = new ChatSessions(directory, original);
    await sessions.load();
    await sessions.change('alice', 'bind', '共享会话', ' feishu-shared ');
    expect(sessions.current('alice').scene_id).toBe('feishu-shared');
    await sessions.change('alice', 'bind', '重复名称', 'feishu-shared');
    expect(sessions.list('alice')).toHaveLength(2);
    expect(sessions.current('alice').scene_meta.scene_label).toBe('共享会话');
    expect(sessions.list('bob')).toEqual([original]);
    const reopened = new ChatSessions(directory, original);
    await reopened.load();
    expect(reopened.current('alice').scene_id).toBe('feishu-shared');
    for (const invalid of ['', 'a b', 'a\nb', 'x'.repeat(257)]) {
      await expect(reopened.change('alice', 'bind', '无效', invalid)).rejects.toThrow('场景 ID');
    }
    await reopened.change('alice', 'delete', 'feishu-shared');
    expect(reopened.list('alice')).toEqual([original]);
    await reopened.change('alice', 'bind', '重新绑定', 'feishu-shared');
    expect(reopened.current('alice').scene_id).toBe('feishu-shared');
  });

  it('migrates the existing room, persists multiple scenes and selections, and separates Beings', async () => {
    const { ChatSessions } = await import('../desktop/main/chat/scene');
    const directory = await profile();
    const original = await loadDesktopScene(directory, 'test', 'PC');
    const sessions = new ChatSessions(directory, original);
    await sessions.load();
    expect(sessions.current('alice')).toEqual(original);
    await sessions.change('alice', 'create', '方案讨论');
    const discussion = sessions.current('alice');
    expect(discussion.scene_id).not.toBe(original.scene_id);
    await sessions.change('alice', 'create', '日常聊天');
    expect(sessions.list('alice')).toHaveLength(3);
    expect(sessions.list('bob')).toEqual([original]);
    await sessions.change('alice', 'select', discussion.scene_id);
    await sessions.change('alice', 'rename', '技术方案');
    const reopened = new ChatSessions(directory, original);
    await reopened.load();
    expect(reopened.current('alice')).toMatchObject({ scene_id: discussion.scene_id, scene_meta: { scene_label: '技术方案' } });
    expect(reopened.list('alice')).toHaveLength(3);
    await expect(reopened.change('alice', 'select', 'missing')).rejects.toThrow('不存在');
    await expect(reopened.change('alice', 'create', '  ')).rejects.toThrow('名称');
    await mkdir(path.join(directory, 'chat-sessions.json.tmp'));
    await expect(reopened.change('alice', 'create', '保存失败')).rejects.toThrow();
    expect(reopened.list('alice')).toHaveLength(3);
  });

  it('renames a targeted inactive scene, deletes durably and replaces the last scene', async () => {
    const { ChatSessions } = await import('../desktop/main/chat/scene');
    const directory = await profile();
    const original = await loadDesktopScene(directory, 'test', 'PC');
    const sessions = new ChatSessions(directory, original);
    await sessions.load();
    await sessions.change('alice', 'create', 'B');
    const b = sessions.current('alice').scene_id;
    await sessions.change('alice', 'rename', 'A renamed', original.scene_id);
    expect(sessions.current('alice').scene_id).toBe(b);
    expect(sessions.list('alice')[0].scene_meta.scene_label).toBe('A renamed');
    await expect(sessions.change('alice', 'delete', 'missing')).rejects.toThrow('不存在');
    await sessions.change('alice', 'delete', original.scene_id);
    expect(sessions.current('alice').scene_id).toBe(b);
    expect(sessions.list('bob')).toEqual([original]);
    await sessions.change('alice', 'delete', b);
    const fresh = sessions.current('alice');
    expect(fresh.scene_id).not.toBe(b);
    expect(fresh.scene_id).not.toBe(original.scene_id);
    const reopened = new ChatSessions(directory, original);
    await reopened.load();
    expect(reopened.list('alice')).toEqual([fresh]);
    await mkdir(path.join(directory, 'chat-sessions.json.tmp'));
    await expect(reopened.change('alice', 'delete', fresh.scene_id)).rejects.toThrow();
    expect(reopened.current('alice')).toEqual(fresh);
  });

  it('rejects sends from the previously selected scene and snapshots identity before reading the body', async () => {
    const connection = parseConnection('https://fixture.test/alice/?token=fixture');
    let scene = { scene_id: 'desktop-a', scene_meta: { client: 'test', scene_label: 'A' } };
    const upstream = vi.fn(async (_url: unknown, init?: RequestInit) => Response.json(JSON.parse(String(init?.body))));
    const proxy = new ChatProxy(() => connection, upstream, () => scene);
    scene = { ...scene, scene_id: 'desktop-b' };
    const stale = await proxy.handle(new Request('beings://chat/api/chat/stream', { method: 'POST', headers: { 'X-Portal-Scene-Id': 'desktop-a' }, body: '{"message":"old"}' }));
    expect(stale.status).toBe(409);
    expect(upstream).not.toHaveBeenCalled();
    const sending = proxy.handle(new Request('beings://chat/api/chat/stream', { method: 'POST', headers: { 'X-Portal-Scene-Id': 'desktop-b' }, body: '{"message":"new","scene_id":"spoofed"}' }));
    scene = { ...scene, scene_id: 'desktop-c' };
    expect(await (await sending).json()).toMatchObject({ message: 'new', scene_id: 'desktop-b' });
  });
});

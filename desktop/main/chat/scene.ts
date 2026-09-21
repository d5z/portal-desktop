import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChatScene } from '../../shared/types';

// A room belongs to this persistent desktop profile, independently of the
// current Being, conversation session, page, Portal name or application version.
export async function loadDesktopScene(directory: string, version: string, deviceName: string): Promise<ChatScene> {
  const file = path.join(directory, 'chat-scene.json');
  let sceneId: string;
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    if (typeof saved?.scene_id !== 'string' || !/^desktop-[a-zA-Z0-9_-]{1,72}$/.test(saved.scene_id)) {
      throw new Error('无效的桌面场景标识。');
    }
    sceneId = saved.scene_id;
  } catch (error) {
    // Do not silently replace an unreadable room with a different identity.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    sceneId = `desktop-${randomUUID()}`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(file + '.tmp', JSON.stringify({ scene_id: sceneId }), { mode: 0o600 });
    await rename(file + '.tmp', file);
  }
  return {
    scene_id: sceneId,
    scene_meta: { client: `portal-desktop/${version}`, scene_label: `桌面·${deviceName}` },
  };
}

const validSceneId = (value: unknown): value is string => typeof value === "string" && /^[\x21-\x7e]{1,256}$/.test(value);

interface SessionGroup { active: string; scenes: ChatScene[] }

/** Per-Being session directory. The original desktop room is migrated in place. */
export class ChatSessions {
  private groups: Record<string, SessionGroup> = {};
  constructor(private directory: string, private fallback: ChatScene) {}
  async load() {
    try {
      const saved = JSON.parse(await readFile(path.join(this.directory, 'chat-sessions.json'), 'utf8'));
      if (saved.version !== 1 || !saved.groups || typeof saved.groups !== 'object' || Array.isArray(saved.groups)) throw new Error('会话目录无效');
      for (const group of Object.values(saved.groups) as SessionGroup[]) {
        if (!group || !Array.isArray(group.scenes) || !group.scenes.length || group.scenes.some(scene =>
          !validSceneId(scene?.scene_id) ||
          typeof scene.scene_meta?.scene_label !== 'string' || !scene.scene_meta.scene_label.trim() || scene.scene_meta.scene_label.length > 128) ||
          new Set(group.scenes.map(scene => scene.scene_id)).size !== group.scenes.length || !group.scenes.some(scene => scene.scene_id === group.active)) throw new Error('会话目录无效');
      }
      this.groups = saved.groups;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  list(endpoint?: string): ChatScene[] {
    return (endpoint && this.groups[endpoint]?.scenes || [this.fallback]).map(scene => ({ ...scene,
      scene_meta: { ...scene.scene_meta, client: this.fallback.scene_meta.client } }));
  }
  current(endpoint?: string): ChatScene {
    const scenes = this.list(endpoint);
    return scenes.find(scene => scene.scene_id === (endpoint && this.groups[endpoint]?.active)) || scenes[0];
  }
  async change(endpoint: string, operation: 'create' | 'bind' | 'select' | 'rename' | 'delete', value: string, sceneId?: string) {
    if (!endpoint) throw new Error('请先连接 Being。');
    if (typeof value !== 'string') throw new Error('无效的会话参数。');
    let scenes = this.list(endpoint);
    let active = this.current(endpoint).scene_id;
    if (operation === 'select') {
      if (!scenes.some(scene => scene.scene_id === value)) throw new Error('会话不存在。');
      active = value;
    } else if (operation === 'delete') {
      const index = scenes.findIndex(scene => scene.scene_id === value);
      if (index < 0) throw new Error('会话不存在。');
      scenes.splice(index, 1);
      if (!scenes.length) scenes.push({ scene_id: `desktop-${randomUUID()}`, scene_meta: { ...this.fallback.scene_meta, scene_label: '新会话' } });
      if (active === value) active = scenes[Math.min(index, scenes.length - 1)].scene_id;
    } else {
      const label = value.trim();
      if (!label || label.length > 128 || /[\r\n\u0000-\u001f]/.test(label)) throw new Error('会话名称需为 1–128 个字符。');
      if (operation === 'bind') {
        const id = typeof sceneId === 'string' ? sceneId.trim() : '';
        if (!validSceneId(id)) throw new Error('场景 ID 需为 1–256 个非空白 ASCII 字符。');
        if (!scenes.some(scene => scene.scene_id === id)) {
          if (scenes.length >= 500) throw new Error('当前 Being 的会话数量已达上限。');
          scenes.push({ scene_id: id, scene_meta: { ...this.fallback.scene_meta, scene_label: label } });
        }
        active = id;
      } else if (operation === 'create') {
        if (scenes.length >= 500) throw new Error('当前 Being 的会话数量已达上限。');
        active = `desktop-${randomUUID()}`;
        scenes.push({ scene_id: active, scene_meta: { ...this.fallback.scene_meta, scene_label: label } });
      } else {
        const current = scenes.find(scene => scene.scene_id === (sceneId || active));
        if (!current) throw new Error('会话不存在。');
        current.scene_meta = { ...current.scene_meta, scene_label: label };
      }
    }
    const groups = { ...this.groups, [endpoint]: { active, scenes } };
    const file = path.join(this.directory, 'chat-sessions.json');
    await writeFile(file + '.tmp', JSON.stringify({ version: 1, groups }), { mode: 0o600 });
    await rename(file + '.tmp', file);
    this.groups = groups;
  }
}

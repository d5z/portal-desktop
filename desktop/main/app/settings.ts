import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parse } from 'smol-toml';
import { parseConnection, type Connection } from '../chat/connection';
import type { Settings, SaveSettings } from '../../shared/types';
import { permissionMode } from '../../shared/security';

export interface SecretStorage { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string }
interface Stored { version: 1; settings: Omit<Settings, 'hasToken'>; credential: string }
export class SettingsStore {
  connection: Connection | null = null;
  settings: Settings;
  constructor(private directory: string, private storage: SecretStorage, private binary: string) {
    this.settings = { endpoint: '', being: '', hasToken: false, workspace: path.join(os.homedir(), 'portal-desktop Workspace'),
      portalBinary: binary, portalName: `portal-desktop-${os.hostname().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 50)}`,
      autoStart: false, backgroundEnabled: true, allowExec: true, kitsEnabled: true, permissionMode: 'auto-review' };
  }
  async load() {
    let raw: string;
    try { raw = await readFile(path.join(this.directory, 'connection.json'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const saved = JSON.parse(raw) as Stored;
    if (saved.version !== 1) throw new Error('不支持的客户端配置版本。');
    const secrets = JSON.parse(this.storage.decryptString(Buffer.from(saved.credential, 'base64')));
    const connection = parseConnection(secrets.link);
    connection.relaySecret = secrets.relaySecret || connection.token;
    this.connection = connection;
    this.settings = { ...this.settings, ...saved.settings, portalBinary: this.binary, endpoint: connection.endpoint, being: connection.being, hasToken: true };
    this.settings.permissionMode = permissionMode(saved.settings.permissionMode);
    // A path persisted by an older client is only a hint. If it was removed or
    // is no longer valid TOML, fall back to the configuration generated from
    // the current client settings instead of failing Portal startup.
    if (this.settings.portalConfigPath) {
      try {
        const source = await readFile(this.settings.portalConfigPath, 'utf8');
        parse(source.replace(/^\uFEFF/, ''));
      } catch {
        this.settings.portalConfigPath = undefined;
      }
    }
  }
  async reusePortalConfig(candidates: string[]) {
    if (this.settings.portalConfigPath) return;
    for (const file of candidates) {
      let raw: string;
      try { raw = await readFile(file, 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      const config = parse(raw.replace(/^\uFEFF/, ''));
      const security = config.security as Record<string, unknown> | undefined;
      const tools = config.tools as Record<string, unknown> | undefined;
      const workspace = config.workspace ?? security?.workspace_root;
      const expand = (value: string) => value === '~' ? os.homedir() : /^[~][\\/]/.test(value) ? path.join(os.homedir(), value.slice(2)) : value;
      const connection = !this.connection && typeof config.connect === 'string' && config.connect.trim() ? parseConnection(config.connect) : null;
      this.settings = { ...this.settings, portalConfigPath: file,
        ...(!this.settings.hasToken && typeof config.name === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(config.name) ? { portalName: config.name } : {}),
        ...(typeof workspace === 'string' && workspace ? { workspace: path.resolve(path.dirname(file), expand(workspace)) } : {}),
        ...(typeof tools?.exec === 'boolean' ? { allowExec: tools.exec } : {}),
        ...(typeof config.kits_enabled === 'boolean' ? { kitsEnabled: config.kits_enabled } : {}),
        ...(connection ? { endpoint: connection.endpoint, being: connection.being, hasToken: true } : {}) };
      if (connection) this.connection = connection;
      return;
    }
  }
  async save(input: SaveSettings) {
    if (!input || typeof input !== 'object') throw new Error('无效的设置。');
    const mode = permissionMode(input.permissionMode ?? this.settings.permissionMode);
    const connection = this.resolveConnection(input);
    if (!this.storage.isEncryptionAvailable()) throw new Error('系统密钥库不可用，无法安全保存连接。请启用系统密钥库后重试。');
    if (typeof input.workspace !== 'string' || !path.isAbsolute(input.workspace)) throw new Error('请选择绝对路径的工作目录。');
    if (typeof input.portalName !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.portalName)) throw new Error('Portal 名称仅支持 1–80 个字母、数字、横线和下划线。');
    for (const key of ['autoStart', 'allowExec', 'kitsEnabled'] as const) if (typeof input[key] !== 'boolean') throw new Error('无效的开关设置。');
    if (input.backgroundEnabled !== undefined && typeof input.backgroundEnabled !== 'boolean') throw new Error('无效的后台运行设置。');
    if (input.portalConfigPath && (!path.isAbsolute(input.portalConfigPath) || !(await stat(input.portalConfigPath)).isFile())) throw new Error('现有 Portal 配置文件不存在。');
    if (input.portalEnvironmentPath !== undefined && (typeof input.portalEnvironmentPath !== 'string' || input.portalEnvironmentPath.includes('\0'))) throw new Error('无效的 Portal PATH。');
    await mkdir(input.workspace, { recursive: true });
    if (!(await stat(input.workspace)).isDirectory()) throw new Error('工作路径不是目录。');
    const next: Settings = { endpoint: connection.endpoint, being: connection.being, hasToken: true,
      permissionMode: mode,
      workspace: input.workspace, portalBinary: this.binary, portalName: input.portalName,
      autoStart: input.autoStart, allowExec: input.allowExec, kitsEnabled: input.kitsEnabled,
      backgroundEnabled: input.backgroundEnabled ?? this.settings.backgroundEnabled,
      portalConfigPath: input.portalConfigPath || undefined, portalEnvironmentPath: input.portalEnvironmentPath || undefined };
    const { hasToken: _, ...publicSettings } = next;
    const credential = this.storage.encryptString(JSON.stringify({ link: connection.link, relaySecret: connection.relaySecret })).toString('base64');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.directory, 'connection.json.tmp');
    await writeFile(temporary, JSON.stringify({ version: 1, settings: publicSettings, credential }), { mode: 0o600 });
    await rename(temporary, path.join(this.directory, 'connection.json'));
    this.connection = connection;
    this.settings = next;
  }
  resolveConnection(input: Pick<SaveSettings, 'connectionLink'>): Connection {
    const connection = input.connectionLink?.trim() ? parseConnection(input.connectionLink) : this.connection;
    if (!connection) throw new Error('请先输入 Being 链接。');
    return { ...connection };
  }
}

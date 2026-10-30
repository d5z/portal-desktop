import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { SettingsStore } from '../desktop/main/app/settings';
import { portalConfig } from '../desktop/main/portal/supervisor';
import { parse } from 'smol-toml';

it('persists credentials encrypted, reloads and preserves them on workspace-only changes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'beings-settings-'));
  const key = randomBytes(32);
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]); },
    decryptString: (data: Buffer) => { const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); cipher.setAuthTag(data.subarray(-16)); return Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]).toString(); },
  };
  try {
    const store = new SettingsStore(dir, storage, process.execPath);
    await store.load(); expect(store.connection).toBeNull();
    expect(store.settings.permissionMode).toBe('auto-review');
    expect(parse(portalConfig(store.settings))).toMatchObject({ security: { permission_mode: 'auto-review' } });
    expect(store.settings.allowExec).toBe(true);
    expect(store.settings.kitsEnabled).toBe(true);
    expect(parse(portalConfig(store.settings))).toMatchObject({ kits_enabled: true, tools: { exec: true, screenshot: true, custom_tools_enabled: true } });
    await store.save({ ...store.settings, workspace: path.join(dir, '中文 workspace'), connectionLink: 'https://echo.example/alice/?token=private-test-credential&secret=relay-secret' });
    expect(JSON.stringify(store.settings)).not.toContain('private-test-credential');
    const disk = await readFile(path.join(dir, 'connection.json'), 'utf8');
    expect(disk).not.toContain('private-test-credential'); expect(disk).not.toContain('relay-secret');
    const reopened = new SettingsStore(dir, storage, process.execPath); await reopened.load();
    expect(reopened.connection?.relaySecret).toBe('relay-secret');
    expect(reopened.settings.allowExec).toBe(true);
    expect(reopened.settings.kitsEnabled).toBe(true);
    await reopened.save({ ...reopened.settings, portalName: 'new-name' });
    expect(reopened.connection?.token).toBe('private-test-credential');
    expect(reopened.settings).toMatchObject({ being: 'alice', endpoint: 'https://echo.example/alice', portalName: 'new-name' });
    expect(reopened.connection).toMatchObject({ relaySecret: 'relay-secret', link: 'https://echo.example/alice/?token=private-test-credential' });
    await expect(reopened.save({ ...reopened.settings, connectionLink: 'another_being' })).rejects.toThrow('完整的 Being 链接');
    await reopened.save({ ...reopened.settings, connectionLink: 'https://other.example/another_being/?token=new-credential&secret=new-relay-secret', portalName: 'my-laptop' });
    expect(reopened.settings).toMatchObject({ being: 'another_being', endpoint: 'https://other.example/another_being', portalName: 'my-laptop' });
    expect(reopened.connection).toMatchObject({ relaySecret: 'new-relay-secret', token: 'new-credential', link: 'https://other.example/another_being/?token=new-credential' });
    await reopened.save({ ...reopened.settings, allowExec: false, kitsEnabled: false });
    const optedOut = new SettingsStore(dir, storage, process.execPath); await optedOut.load();
    expect(optedOut.settings.allowExec).toBe(false);
    expect(optedOut.settings.kitsEnabled).toBe(false);
    expect(parse(portalConfig(optedOut.settings))).toMatchObject({ kits_enabled: false, tools: { exec: false, screenshot: true, custom_tools_enabled: false } });
    const unavailable = new SettingsStore(dir, { ...storage, isEncryptionAvailable: () => false }, process.execPath);
    await expect(unavailable.save({ ...store.settings, connectionLink: 'https://echo.example/alice/?token=test' })).rejects.toThrow('密钥库');
    await expect(store.save({ ...store.settings, portalName: 'bad\nname' })).rejects.toThrow();
    await expect(store.save({ ...store.settings, workspace: '../outside' })).rejects.toThrow();
    await expect(store.save({ ...store.settings, permissionMode: 'invalid' as any })).rejects.toThrow('权限');
    await store.save({ ...store.settings, permissionMode: 'read-only' });
    const restricted = new SettingsStore(dir, storage, process.execPath); await restricted.load();
    expect(restricted.settings.permissionMode).toBe('read-only');
    await restricted.save({ ...restricted.settings, permissionMode: 'auto-review' });
    const automatic = new SettingsStore(dir, storage, '/client/heart-portal');
    await automatic.load();
    expect(automatic.settings.permissionMode).toBe('auto-review');
    expect(parse(portalConfig(automatic.settings))).toMatchObject({ security: { permission_mode: 'auto-review' } });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('uses the current client binary after reinstall, upgrade and saves while retaining configuration', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'portal-client-settings-'));
  const storage = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() };
  const config = path.join(dir, 'original.toml');
  const source = 'workspace = "./work"\nkits_enabled = false\n[tools]\nexec = false\n';
  try {
    await writeFile(config, source);
    const old = new SettingsStore(dir, storage, '/removed/old-portal');
    await old.save({ ...old.settings, workspace: dir, portalName: 'original-name', portalConfigPath: config,
      portalEnvironmentPath: '/my/tools', allowExec: false, kitsEnabled: false, backgroundEnabled: false, autoStart: true,
      connectionLink: 'https://example.org/alice/?token=fixture&secret=relay-fixture' });
    for (const binary of ['/client/reinstalled/heart-portal', '/client/upgraded/heart-portal']) {
      const current = new SettingsStore(dir, storage, binary);
      await current.load();
      expect(current.settings).toEqual({ ...old.settings, portalBinary: binary });
      expect(current.connection).toEqual(old.connection);
      await current.save({ ...current.settings, portalBinary: '/another/standalone-portal' });
      expect(current.settings.portalBinary).toBe(binary);
      expect(JSON.parse(await readFile(path.join(dir, 'connection.json'), 'utf8')).settings.portalBinary).toBe(binary);
      expect(await readFile(config, 'utf8')).toBe(source);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('reuses a stopped Portal configuration and connection without requiring its executable', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'portal-config-only-'));
  const storage = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() };
  const config = path.join(dir, 'portal.toml');
  const source = '\uFEFFname = "old-name"\nconnect = "https://example.org/alice/?token=fixture"\nworkspace = "./中文 workspace"\nkits_enabled = false\nkits_dir = "./kits"\n[tools]\nexec = false\nscreenshot = true\n';
  try {
    await writeFile(config, source);
    const store = new SettingsStore(dir, storage, '/client/heart-portal');
    await store.reusePortalConfig([path.join(dir, 'missing.toml'), config]);
    expect(store.settings).toMatchObject({ portalBinary: '/client/heart-portal', portalConfigPath: config,
      portalName: 'old-name', workspace: path.join(dir, '中文 workspace'), allowExec: false, kitsEnabled: false, hasToken: true });
    expect(store.connection?.being).toBe('alice');
    await store.save(store.settings);
    await store.reusePortalConfig([path.join(dir, 'another.toml')]);
    expect(store.settings.portalConfigPath).toBe(config);
    expect(await readFile(config, 'utf8')).toBe(source);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('preserves client name and credentials when reusing a legacy TOML and reports invalid files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'portal-config-priority-'));
  const storage = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() };
  const config = path.join(dir, 'portal.toml');
  try {
    const store = new SettingsStore(dir, storage, '/client/heart-portal');
    await store.save({ ...store.settings, workspace: dir, portalName: 'chosen-name', connectionLink: 'https://example.org/alice/?token=current' });
    await writeFile(config, 'invalid toml');
    await expect(store.reusePortalConfig([config])).rejects.toThrow();
    expect(store.settings.portalConfigPath).toBeUndefined();
    await writeFile(config, 'name = "old-name"\nconnect = "invalid old link"\n[security]\nworkspace_root = "~/my-work"\n');
    await store.reusePortalConfig([config]);
    expect(store.settings).toMatchObject({ portalName: 'chosen-name', workspace: path.join(os.homedir(), 'my-work'), portalConfigPath: config });
    expect(store.connection?.token).toBe('current');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { parse, stringify } from 'smol-toml';
import { app } from 'electron';
import * as runtime from '../desktop/main/updates/runtime';
import { ClientErrorLog } from '../desktop/main/app/error-log';
import { MutationQueue } from '../desktop/main/app/mutations';
import { SettingsStore } from '../desktop/main/app/settings';
import { parseConnection } from '../desktop/main/chat/connection';
import type { ChatProxy } from '../desktop/main/chat/proxy';
import { BackgroundPortal } from '../desktop/main/portal/background';
import { createPortalController } from '../desktop/main/portal/controller';
import { PortalSupervisor } from '../desktop/main/portal/supervisor';
import { PortalTakeover } from '../desktop/main/portal/takeover';

const { probe } = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock('electron', () => ({ app: { get isPackaged() { return false; } }, net: { fetch: vi.fn() }, dialog: {} }));
vi.mock('../desktop/main/chat/ready', () => ({ verifyBeingConnection: vi.fn() }));
vi.mock('../desktop/main/portal/subagent-probe', () => ({ probeSubagentModel: probe }));

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture(contents?: string, installed = false) {
  probe.mockReset().mockResolvedValue(undefined);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-apply-'));
  const file = installed ? path.join(directory, 'portal-service', 'previous', 'portal.toml') : path.join(directory, 'desktop-portal.toml');
  await mkdir(path.dirname(file), { recursive: true });
  if (contents !== undefined) await writeFile(file, contents);
  const errorLog = new ClientErrorLog(directory);
  cleanups.push(async () => { await errorLog.flush(); await rm(directory, { recursive: true, force: true }); });
  const store = new SettingsStore(directory, {
    isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString(),
  }, '/unused/portal');
  store.connection = parseConnection('https://example.org/alice/?token=alice-token');
  await store.save({ ...store.settings, workspace: directory, backgroundEnabled: false,
    ...(contents !== undefined ? { portalConfigPath: file } : {}) });
  const portal = new PortalSupervisor(directory);
  const background = new BackgroundPortal(directory);
  const start = vi.spyOn(portal, 'start').mockResolvedValue(portal.state);
  const stop = vi.spyOn(portal, 'stop').mockResolvedValue(portal.state);
  const ready = vi.spyOn(portal, 'waitReady').mockResolvedValue(undefined);
  vi.spyOn(background, 'portalState').mockResolvedValue(portal.state);
  vi.spyOn(PortalTakeover.prototype, 'run').mockImplementation(async (_connection, _intent, start) => { await start(false); return true; });
  const changed = vi.fn();
  const controller = await createPortalController({
    directory, binary: '/unused/portal', store, portal, background, errorLog,
    mutations: new MutationQueue(), proxy: { portalStateChanged: vi.fn() } as unknown as ChatProxy,
    window: () => null, isQuitting: () => false, reusePreviousConfig: async () => {}, connectionChanged: changed,
    cleanup: async () => {}, quit: () => {}, resumeAfterFailedShutdown: async () => {},
  });
  return { controller, store, file, start, stop, ready, changed, background };
}

const original = '[subagent]\nenabled=true\nmodel_source="custom"\n[subagent.model]\nprovider="openai"\nmodel="old-model"\napi_key="old-key"\n';
const custom = { provider: 'openai', model: 'new-model', api_key: 'new-key', thinking: 'off' };

it.each([original, undefined])('rolls back the model file if readiness fails (previous=%s)', async contents => {
  const { controller, store, file, ready, changed } = await fixture(contents);
  const previous = { ...store.settings };
  ready.mockRejectedValueOnce(new Error('runtime did not start'));
  await expect(controller.save({ ...store.settings, subagentSetup: custom })).rejects.toThrow('runtime did not start');
  if (contents === undefined) await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
  else expect(await readFile(file, 'utf8')).toBe(contents);
  expect(store.settings).toEqual(previous);
  expect(changed).toHaveBeenCalledTimes(2);
});

it('rolls back a subagent enable toggle when readiness fails', async () => {
  const { controller, store, file, ready } = await fixture(original);
  const previous = { ...store.settings };
  ready.mockRejectedValueOnce(new Error('runtime did not start'));
  await expect(controller.save({ ...store.settings, subagentEnabled: false })).rejects.toThrow('runtime did not start');
  expect(parse(await readFile(file, 'utf8')).subagent).toMatchObject({ enabled: true });
  expect(store.settings).toEqual(previous);
});

it('does not stop the working runtime or change its file when generation fails', async () => {
  const { controller, store, file, stop, start } = await fixture(original);
  const settingsFile = path.join(path.dirname(file), 'connection.json');
  const settingsBefore = await readFile(settingsFile, 'utf8');
  probe.mockRejectedValueOnce(new Error('HTTP 500'));
  await expect(controller.save({ ...store.settings, workspace: path.join(path.dirname(file), 'candidate'), subagentInherit: true })).rejects.toThrow('HTTP 500');
  expect(await readFile(file, 'utf8')).toBe(original);
  expect(await readFile(settingsFile, 'utf8')).toBe(settingsBefore);
  expect(store.settings.workspace).not.toContain('candidate');
  expect(stop).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});

it('keeps a verified model only after runtime startup succeeds', async () => {
  const { controller, store, file } = await fixture(original);
  await controller.save({ ...store.settings, subagentSetup: custom });
  expect(parse(await readFile(file, 'utf8')).subagent).toMatchObject({
    model_source: 'custom', model: { model: 'new-model', api_key: 'new-key' },
  });
});

it('restores the model without stopping the old engine when takeover is rejected', async () => {
  const { controller, store, file, stop } = await fixture(original);
  vi.mocked(PortalTakeover.prototype.run).mockRejectedValueOnce(new Error('takeover rejected'));
  await expect(controller.save({ ...store.settings, subagentSetup: custom })).rejects.toThrow('takeover rejected');
  expect(await readFile(file, 'utf8')).toBe(original);
  expect(stop).not.toHaveBeenCalled();
});

it('disables the old identity when a new Being cannot validate its default model', async () => {
  const old = stringify({ subagent: { enabled: true, inherit_model: true, model_source: 'loom', validated_at: 1,
    inherited_from: 'https://example.org/alice', model: { provider: 'portal-custom', model: 'glm5.3flash',
      base_url: 'https://101.132.86.87/llm/alice/v1', api: 'openai-completions', thinking: 'off', api_key: 'alice-token' } } });
  const { controller, store, file, start } = await fixture(old);
  probe.mockRejectedValueOnce(new Error('HTTP 500'));
  await controller.save({ ...store.settings, connectionLink: 'https://example.org/bob/?token=bob-token' });
  expect(store.connection?.being).toBe('bob');
  expect(parse(await readFile(file, 'utf8')).subagent).toMatchObject({ enabled: false });
  expect(start).toHaveBeenCalledWith(expect.objectContaining({ portalConfigPath: file }), expect.objectContaining({ being: 'bob' }));
});

it('starts other tools with subagent disabled if initial default verification fails', async () => {
  const { controller, store, file, start } = await fixture();
  probe.mockRejectedValueOnce(new Error('HTTP 500'));
  await controller.save(store.settings);
  expect(parse(await readFile(file, 'utf8')).subagent).toMatchObject({ enabled: false });
  expect(store.settings.portalConfigPath).toBe(file);
  expect(start).toHaveBeenCalledOnce();
});

it('loads and enables the default on startup, recovering after a failed verification', async () => {
  const { controller, store, file, start } = await fixture();
  probe.mockRejectedValueOnce(new Error('HTTP 500'));
  await controller.start();
  expect(parse(await readFile(file, 'utf8')).subagent).toMatchObject({ enabled: false });
  await controller.start();
  expect(parse(await readFile(file, 'utf8')).subagent).toMatchObject({
    enabled: true, model_source: 'loom', model: { model: 'glm5.3flash', api_key: 'alice-token' },
  });
  expect(store.settings.portalConfigPath).toBe(file);
  expect(start).toHaveBeenCalledTimes(2);
});

it('enables the manually selected model at startup without loading the default', async () => {
  const { controller, file } = await fixture(original.replace('enabled=true', 'enabled=false'));
  await controller.start();
  expect(parse(await readFile(file, 'utf8')).subagent).toMatchObject({
    enabled: true, model_source: 'custom', model: { model: 'old-model', api_key: 'old-key' },
  });
  expect(probe).not.toHaveBeenCalled();
});

it.each([true, false])('initializes and synchronizes the installed runtime config after upgrade (generated=%s)', async generatedConfig => {
  const { controller, store, file, start, background } = await fixture('[subagent]\nenabled=false\n', true);
  vi.spyOn(app, 'isPackaged', 'get').mockReturnValue(true);
  vi.spyOn(runtime, 'loadRuntimeBundle').mockResolvedValue({ binary: '/unused/portal', bundle: {
    schema: 1, id: 'fixture', clientVersion: '1.0.0', portalVersion: '1.0.0', sha256: '', platform: process.platform, arch: process.arch,
  } });
  vi.spyOn(runtime.RuntimeUpdater.prototype, 'sync').mockResolvedValue({ phase: 'current', message: '' });
  vi.spyOn(background, 'installedService', 'get').mockReturnValue({ root: path.join(background.runtimeDirectory, 'current'), label: background.label, file: '', existing: false, configPath: file, generatedConfig });
  await controller.restoreStartup();
  expect(parse(await readFile(file, 'utf8')).subagent).toMatchObject({ enabled: true, model_source: 'loom', model: { model: 'glm5.3flash' } });
  expect(store.settings.portalConfigPath).toBe(file);
  expect(start).toHaveBeenCalledWith(expect.objectContaining({ portalConfigPath: file }), store.connection);
  await controller.save({ ...store.settings, connectionLink: 'https://example.org/bob/?token=bob-token' });
  expect(parse(await readFile(file, 'utf8')).subagent).toMatchObject({
    model_source: 'loom', model: { base_url: 'https://101.132.86.87/llm/bob/v1', api_key: 'bob-token' },
  });
  probe.mockRejectedValueOnce(new Error('HTTP 500'));
  await controller.save({ ...store.settings, connectionLink: 'https://example.org/carol/?token=carol-token' });
  expect(parse(await readFile(file, 'utf8')).subagent).toMatchObject({ enabled: false });
  expect(store.settings.portalConfigPath).toBe(file);
});

it.each(['[subagent]\nenabled=false\n', original.replace('enabled=true', 'enabled=false')])('restarts an existing background runtime only when startup changes its subagent configuration (%s)', async contents => {
  const { controller, store, file, background } = await fixture(contents, true);
  await store.save({ ...store.settings, backgroundEnabled: true });
  vi.spyOn(app, 'isPackaged', 'get').mockReturnValue(true);
  vi.spyOn(runtime, 'loadRuntimeBundle').mockResolvedValue({ binary: '/unused/portal', bundle: {
    schema: 1, id: 'fixture', clientVersion: '1.0.0', portalVersion: '1.0.0', sha256: '', platform: process.platform, arch: process.arch,
  } });
  vi.spyOn(runtime.RuntimeUpdater.prototype, 'sync').mockResolvedValue({ phase: 'current', message: '' });
  vi.spyOn(runtime.RuntimeUpdater.prototype, 'waitReady').mockResolvedValue(undefined);
  vi.spyOn(background, 'installedService', 'get').mockReturnValue({ root: path.dirname(file), label: background.label, file: '', existing: false, configPath: file, generatedConfig: true });
  background.state = { ...background.state, enabled: true, running: true };
  let runtimeEnabled = false;
  const disable = vi.spyOn(background, 'disable').mockImplementation(async () => {
    background.state = { ...background.state, enabled: false, running: false };
    return background.state;
  });
  vi.spyOn(background, 'enable').mockImplementation(async () => {
    // An already running guardian retains its startup config until stopped.
    if (!background.state.running) runtimeEnabled = (parse(await readFile(file, 'utf8')).subagent as { enabled: boolean }).enabled;
    background.state = { ...background.state, enabled: true, running: true };
    return background.state;
  });
  await controller.restoreStartup();
  expect(runtimeEnabled).toBe(true);
  expect(disable).toHaveBeenCalledOnce();
  await controller.restoreStartup();
  expect(disable).toHaveBeenCalledOnce();
});

it('persists the default config path even when startup finds an unchanged model', async () => {
  const { controller, store, file } = await fixture();
  await controller.start();
  await store.save({ ...store.settings, portalConfigPath: undefined });
  probe.mockClear();
  await controller.start();
  expect(store.settings.portalConfigPath).toBe(file);
  expect(probe).not.toHaveBeenCalled();
});

it('does not initialize an imported custom config merely because the service uses it', async () => {
  const { controller, store, file, background } = await fixture();
  const imported = path.join(path.dirname(file), 'imported-portal.toml');
  const contents = '[subagent]\nenabled=false\n';
  await writeFile(imported, contents);
  await store.save({ ...store.settings, portalConfigPath: imported });
  vi.spyOn(background, 'installedService', 'get').mockReturnValue({
    root: path.join(background.runtimeDirectory, 'current'), label: background.label,
    file: '', existing: false, configPath: imported, generatedConfig: false,
  });
  await controller.start();
  expect(await readFile(imported, 'utf8')).toBe(contents);
  expect(probe).not.toHaveBeenCalled();
});

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { parse } from 'smol-toml';
import { parseConnection } from '../desktop/main/chat/connection';
const { launch, probe } = vi.hoisted(() => ({ launch: vi.fn(), probe: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../desktop/main/portal/subagent-probe', () => ({ probeSubagentModel: probe }));
vi.mock('node:child_process', () => ({ spawn: launch }));
import { setupSubagent, syncSubagentModel, validateSubagentSetup, readSubagentConfig, saveSubagentPreferences, setSubagentEnabled } from '../desktop/main/portal/subagent-setup';
import type { Settings } from '../desktop/shared/types';
const settings: Settings = { endpoint: '', being: '', hasToken: false, workspace: '/workspace', portalBinary: '/bundled/portal', portalName: 'test', autoStart: false, allowExec: true, kitsEnabled: true };
const input = { provider: 'openai', model: 'fixture-model', api_key: 'secret-fixture', thinking: 'medium' };
let directory = '';
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); vi.clearAllMocks(); });
function fake(result: unknown, code = 0) {
  let received = '';
  launch.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    child.stdin.on('data', chunk => { received += chunk.toString(); });
    child.stdin.on('finish', () => queueMicrotask(() => { child.stdout.write('DESKTOP_SUBAGENT_RESULT=' + JSON.stringify(result) + '\n'); child.emit('close', code); }));
    return child;
  });
  return () => received;
}
it('uses stdin for secrets and a durable config without persisting setup data in Desktop settings', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-setup-'));
  const received = fake({ content: [{ type: 'text', text: JSON.stringify({ ok: true, pi_installed: true, install_error: null }) }] });
  const file = await setupSubagent(directory, settings, input);
  expect(launch.mock.calls[0][1]).toEqual(['--config', file, 'subagent-setup']);
  expect(JSON.stringify(launch.mock.calls[0])).not.toContain(input.api_key);
  expect(JSON.parse(received())).toEqual(input);
  expect(await readFile(file, 'utf8')).not.toContain(input.api_key);
  await setupSubagent(directory, settings, { ...input, api_key: '' });
  expect(JSON.parse(received().slice(received().indexOf('}{') + 1))).not.toHaveProperty('api_key');
});
it('does not report installation failure as success or expose backend errors containing a key', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-setup-'));
  fake({ isError: true, content: [{ text: input.api_key }] });
  const error = await setupSubagent(directory, settings, input).catch(e => e as Error);
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).not.toContain(input.api_key);
  fake({ content: [{ text: JSON.stringify({ ok: true, pi_installed: false, install_error: 'npm missing' }) }] });
  await expect(setupSubagent(directory, settings, input)).rejects.toThrow('安装或配置失败');
});
it('rejects malformed configuration before launching', () => {
  for (const patch of [{ provider: 'unknown' }, { model: '' }, { api_key: 'a\nb' }, { thinking: 'invalid' }])
    expect(() => validateSubagentSetup({ ...input, ...patch })).toThrow();
  expect(launch).not.toHaveBeenCalled();
});

it('reads public model fields without returning keys or installing anything', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-read-'));
  expect(await readSubagentConfig(directory, settings)).toEqual({ enabled: true, inherit_model: true, provider: '', model: '', thinking: 'medium', api_key_configured: false });
  const file = path.join(directory, 'custom.toml');
  await writeFile(file, '[subagent.model]\nprovider="openai"\nmodel="fixture"\napi_key="private-fixture-key"\nthinking="high"\n');
  expect(await readSubagentConfig(directory, { ...settings, portalConfigPath: file })).toEqual({ enabled: true, inherit_model: true, provider: 'openai', model: 'fixture', thinking: 'high', api_key_configured: true });
  await writeFile(file, 'broken = "private-fixture-key');
  const error = await readSubagentConfig(directory, { ...settings, portalConfigPath: file }).catch(e => e);
  expect(String(error)).not.toContain('private-fixture-key');
  expect(launch).not.toHaveBeenCalled();
});

const connection = parseConnection('https://loom.example/being-one/?token=loom-test-token');

it('configures the default gateway with the current Loom identity and no upstream key', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-default-'));
  expect(await syncSubagentModel(directory, settings, connection)).toBe(true);
  const file = path.join(directory, 'desktop-portal.toml');
  const document = parse(await readFile(file, 'utf8')) as any;
  expect(document.subagent).toMatchObject({ enabled: true, inherit_model: true, model_source: 'loom', model: {
    provider: 'portal-custom', model: 'glm5.3flash', base_url: 'https://101.132.86.87/llm/being-one/v1',
    api: 'openai-completions', thinking: 'off', api_key: connection.token,
  } });
  expect(JSON.stringify(await readSubagentConfig(directory, settings))).not.toContain(connection.token);
  const { stat } = await import('node:fs/promises');
  if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(launch).not.toHaveBeenCalled();
});

it('refreshes the token and Being path, migrating the old inherited model', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-default-'));
  const file = path.join(directory, 'desktop-portal.toml');
  await writeFile(file, '[subagent]\ninherit_model=true\nmodel_source="being"\n[subagent.model]\nprovider="openrouter"\nmodel="old-model"\napi_key="upstream-key"\n');
  await syncSubagentModel(directory, settings, connection);
  const next = parseConnection('https://loom.example/being-two/?token=rotated-loom-token');
  await syncSubagentModel(directory, { ...settings, endpoint: next.endpoint }, next);
  const doc = parse(await readFile(file, 'utf8')) as any;
  expect(doc.subagent.model.base_url).toBe('https://101.132.86.87/llm/being-two/v1');
  expect(doc.subagent.model.api_key).toBe(next.token);
  expect(JSON.stringify(doc.desktop_model_keys || {})).not.toContain(connection.token);
});

it('preserves custom configuration and restores its key after switching through the default', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-custom-'));
  const custom = { ...input, provider: 'portal-custom', base_url: 'https://custom.example/v1', api: 'openai-completions' };
  const file = await saveSubagentPreferences(directory, settings, custom);
  expect(await syncSubagentModel(directory, settings, connection)).toBe(false);
  expect(await readSubagentConfig(directory, settings)).toMatchObject({ inherit_model: false, model: input.model });
  await saveSubagentPreferences(directory, settings, undefined, connection);
  expect(await readSubagentConfig(directory, settings)).toMatchObject({ inherit_model: true, model: 'glm5.3flash' });
  await saveSubagentPreferences(directory, settings, { ...custom, api_key: '' });
  const doc = parse(await readFile(file, 'utf8')) as any;
  expect(doc.subagent.model.api_key).toBe(input.api_key);
  expect(doc.subagent.inherit_model).toBe(true); // Keep the Portal tool bridge in both modes.
});

it('never reuses the Loom token as a custom model key', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-key-scope-'));
  await syncSubagentModel(directory, settings, connection);
  const file = await saveSubagentPreferences(directory, settings, {
    ...input, provider: 'portal-custom', base_url: 'https://101.132.86.87/llm/being-one/v1', api: 'openai-completions', api_key: '',
  });
  const doc = parse(await readFile(file, 'utf8')) as any;
  expect(doc.subagent.model.api_key).toBeUndefined();
  expect(JSON.stringify(doc.desktop_model_keys || {})).not.toContain(connection.token);
});

it('keeps custom credentials scoped to their Being and route', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-key-scope-'));
  const first = { ...settings, endpoint: connection.endpoint };
  await saveSubagentPreferences(directory, first, input);
  await saveSubagentPreferences(directory, first, { ...input, provider: 'anthropic', api_key: '' });
  expect((await readSubagentConfig(directory, first)).api_key_configured).toBe(false);
  await saveSubagentPreferences(directory, first, { ...input, api_key: '' });
  expect((await readSubagentConfig(directory, first)).api_key_configured).toBe(true);
  const other = { ...first, endpoint: 'https://loom.example/other' };
  await saveSubagentPreferences(directory, other, { ...input, api_key: '' });
  expect((await readSubagentConfig(directory, other)).api_key_configured).toBe(false);
});

it('rejects invalid gateway identities before writing configuration', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-invalid-'));
  await expect(syncSubagentModel(directory, settings, { ...connection, being: '../bad' })).rejects.toThrow('有效的 Being');
  await expect(readFile(path.join(directory, 'desktop-portal.toml'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});

it('leaves the exact previous file untouched when candidate verification fails', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-verify-'));
  const file = await saveSubagentPreferences(directory, settings, input);
  const original = await readFile(file, 'utf8');
  probe.mockRejectedValueOnce(new Error('HTTP 401'));
  await expect(saveSubagentPreferences(directory, settings, undefined, connection)).rejects.toThrow('HTTP 401');
  expect(await readFile(file, 'utf8')).toBe(original);
  expect((await readSubagentConfig(directory, settings)).model).toBe(input.model);
});

it('does not revalidate unchanged defaults on every Portal startup', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-verify-'));
  expect(await syncSubagentModel(directory, settings, connection)).toBe(true);
  expect(await syncSubagentModel(directory, settings, connection)).toBe(false);
  expect(probe).toHaveBeenCalledTimes(1);
  expect(await syncSubagentModel(directory, settings, { ...connection, token: 'new-token' })).toBe(true);
  expect(probe).toHaveBeenCalledTimes(2);
});

it('reenables a disabled default only after startup verification succeeds', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-disabled-'));
  const file = await saveSubagentPreferences(directory, settings, undefined, connection);
  await setSubagentEnabled(directory, { ...settings, portalConfigPath: file }, false);
  probe.mockRejectedValueOnce(new Error('HTTP 500'));
  await expect(syncSubagentModel(directory, settings, connection)).rejects.toThrow('HTTP 500');
  expect(await readSubagentConfig(directory, settings)).toMatchObject({ enabled: false });
  await syncSubagentModel(directory, settings, connection);
  expect(await readSubagentConfig(directory, settings)).toMatchObject({ enabled: true, model: 'glm5.3flash' });
  expect(probe).toHaveBeenCalledTimes(3);
});

it('enables the saved custom model at startup without replacing or probing it', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-custom-start-'));
  const file = await saveSubagentPreferences(directory, settings, input);
  await setSubagentEnabled(directory, { ...settings, portalConfigPath: file }, false);
  const before = parse(await readFile(file, 'utf8')) as any;
  probe.mockClear();
  expect(await syncSubagentModel(directory, settings, connection)).toBe(true);
  const after = parse(await readFile(file, 'utf8')) as any;
  expect(after.subagent).toEqual({ ...before.subagent, enabled: true });
  expect(probe).not.toHaveBeenCalled();
});

it('loads the default at startup when an old config has no selected model', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-empty-start-'));
  await writeFile(path.join(directory, 'desktop-portal.toml'), '[subagent]\nenabled=false\ninherit_model=false\n');
  await syncSubagentModel(directory, settings, connection);
  expect(await readSubagentConfig(directory, settings)).toMatchObject({ enabled: true, inherit_model: true, model: 'glm5.3flash' });
});

it('uses one default file for save, toggle, public reads and preserves the model when toggled', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-path-'));
  const file = await saveSubagentPreferences(directory, settings, input);
  expect(await setSubagentEnabled(directory, settings, false)).toBe(file);
  expect(await readSubagentConfig(directory, settings)).toMatchObject({ enabled: false, model: input.model });
  await expect(readFile(path.join(directory, 'subagent-portal.toml'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('rejects mistyped TOML fields at the boundary before probing or exposing them', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-types-'));
  const file = path.join(directory, 'desktop-portal.toml');
  await writeFile(file, '[subagent.model]\nprovider="openai"\nmodel=123\n');
  await expect(readSubagentConfig(directory, settings)).rejects.toThrow('无法读取');
  await expect(saveSubagentPreferences(directory, settings, input)).rejects.toThrow('无法读取');
  expect(probe).not.toHaveBeenCalled();
});
it('ignores invalid saved key values instead of using them as credentials', async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'subagent-keys-'));
  const file = path.join(directory, 'desktop-portal.toml');
  await writeFile(file, 'desktop_model_keys=42\n');
  await saveSubagentPreferences(directory, settings, input);
  expect((parse(await readFile(file, 'utf8')) as any).subagent.model.api_key).toBe(input.api_key);
});

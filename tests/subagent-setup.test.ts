import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
const { launch } = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: launch }));
import { setupSubagent, validateSubagentSetup, readSubagentConfig } from '../desktop/main/portal/subagent-setup';
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
  expect(await readSubagentConfig(directory, settings)).toEqual({ enabled: false, provider: '', model: '', thinking: 'medium' });
  const file = path.join(directory, 'custom.toml');
  await writeFile(file, '[subagent.model]\nprovider="openai"\nmodel="fixture"\napi_key="private-fixture-key"\nthinking="high"\n');
  expect(await readSubagentConfig(directory, { ...settings, portalConfigPath: file })).toEqual({ enabled: true, provider: 'openai', model: 'fixture', thinking: 'high' });
  await writeFile(file, 'broken = "private-fixture-key');
  const error = await readSubagentConfig(directory, { ...settings, portalConfigPath: file }).catch(e => e);
  expect(String(error)).not.toContain('private-fixture-key');
  expect(launch).not.toHaveBeenCalled();
});

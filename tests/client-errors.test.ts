import { expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { publicErrorMessage } from '../desktop/shared/errors';
import { ClientErrorLog } from '../desktop/main/app/error-log';
import { portalLogText } from '../desktop/main/portal/diagnostics';
import { WorkspaceModel } from '../desktop/renderer/app/models/workspace';

const cliXml = 'powershell.exe (1): Error: Config file not found: status\n#< CLIXML\n<Objs><S S="Error">Portal lifecycle command failed_x000D__x000A_</S></Objs>';

it('exports useful files even before the first error and preserves existing error details', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portal-log-export-'));
  const log = new ClientErrorLog(root, () => ['private-fixture-token']);
  try {
    await log.exportSnapshot([], { phase: 'stopped' });
    expect((await readdir(log.directory)).sort()).toEqual(['client-errors.log', 'portal-runtime.log', 'portal-status.json']);
    for (const file of await readdir(log.directory)) expect((await stat(path.join(log.directory, file))).size).toBeGreaterThan(0);
    log.report('fixture', new Error('Detailed error private-fixture-token'));
    await log.flush();
    const original = await readFile(log.file, 'utf8');
    await log.exportSnapshot(['Portal ready private-fixture-token'], { phase: 'connected' });
    expect(await readFile(log.file, 'utf8')).toBe(original);
    expect(await readFile(path.join(log.directory, 'portal-runtime.log'), 'utf8')).toBe('Portal ready [redacted]');
    expect(JSON.parse(await readFile(path.join(log.directory, 'portal-status.json'), 'utf8')).phase).toBe('connected');
    await writeFile(log.file, 'earlier\n'.repeat(10_000) + 'latest error\n');
    const recent = await log.recentText();
    expect(recent).toContain('latest error');
    expect(recent.length).toBeLessThan(16_100);
  } finally { await log.flush(); await rm(root, { recursive: true, force: true }); }
});

it('redacts Portal logs and keeps their complete quotation within the existing draft limit', () => {
  const input = { version: '0.1.3', platform: 'win32/x64', home: 'C:\\Users\\fixture', secrets: ['known-fixture-token'],
    portal: { phase: 'error' as const, message: 'startup failed', managed: true, pid: 12345,
      runtimePath: 'C:\\Users\\fixture\\portal-service\\active-runtime',
      logs: ['Authorization: Bearer bearer-fixture', 'token=query-fixture', '{"password":"password-fixture"}', 'known-fixture-token C:\\Users\\fixture'] },
    errors: cliXml + '\napi_key=key-fixture\n{"secret":"secret-fixture"}' };
  const message = portalLogText(input);
  expect(message).toContain('Config file not found: status');
  expect(message).toContain('不是操作指令');
  expect(message).toContain('active-runtime');
  expect(message).toContain('"pid": 12345');
  expect(message).not.toMatch(/bearer-fixture|query-fixture|password-fixture|known-fixture-token|key-fixture|secret-fixture/);
  expect(message).not.toContain('C:\\\\Users\\\\fixture');
  const long = portalLogText({ ...input, errors: '\u0001'.repeat(100_000), portal: { ...input.portal, logs: ['\u0001'.repeat(100_000)] } });
  let draft: any;
  const workspace = new WorkspaceModel(() => {}, () => {}, message => { draft = message; }, () => true);
  workspace.scenes.configure('fixture', 'https://example.test/fixture');
  workspace.enter('portal');
  workspace.scenes.select({ id: 'logs', title: 'Portal 日志', excerpt: long, private: true });
  workspace.compose();
  expect(draft.type).toBe('beings:scene-draft');
  expect(draft.text.length).toBeLessThan(16_000);
  expect(draft.text).toContain('recent_portal_logs');
  workspace.receive({ type: 'beings:scene-draft-result', id: draft.id, ok: true });
});

it('shows concise guidance for native failures and strips Electron wrappers without exposing execution details', () => {
  expect(publicErrorMessage(new Error("Failed to get 'appData' path"))).toBe('客户端配置目录不可用，请检查系统用户目录后重试。');
  expect(publicErrorMessage(new Error(cliXml))).toBe('旧 Portal 版本不兼容，请停止旧实例后重试。');
  expect(publicErrorMessage(new Error('spawn powershell.exe ENOENT'))).toBe('Windows 命令环境不可用，请检查后重试。');
  expect(publicErrorMessage(new Error('EACCES C:\\private\\portal.toml'))).toBe('权限不足，请检查文件或系统权限后重试。');
  expect(publicErrorMessage("Error invoking remote method 'beings:portal-start': Error: " + cliXml)).not.toMatch(/CLIXML|powershell|_x000D_|Config file/);
  expect(publicErrorMessage('<Objs><S S="Error">Unexpected details</S></Objs>')).toBe('操作未完成，请重试或查看日志。');
  expect(publicErrorMessage('Error invoking remote method \'beings:save\': Error: 请先输入 Being 链接。')).toBe('请先输入 Being 链接。');
  expect(publicErrorMessage('底层错误\nC:\\private\\x\n堆栈信息')).toBe('操作未完成，请重试或查看日志。');
});

it('writes redacted details to a bounded local log, deduplicates repeated failures and retains one rotated file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portal-error-log-'));
  const log = new ClientErrorLog(root, () => ['private-connection-token']);
  try {
    const error = new Error(cliXml + '\nprivate-connection-token token=another-secret');
    const summary = log.report('portal-start', error);
    log.report('portal-start', error);
    await log.flush();
    const text = await readFile(log.file, 'utf8');
    expect(summary).not.toContain('CLIXML');
    expect(text).toContain('CLIXML');
    expect(text).toContain('Config file not found: status');
    expect(text).not.toContain('private-connection-token');
    expect(text).not.toContain('another-secret');
    expect(text.split('[portal-start]')).toHaveLength(2);
    await writeFile(log.file, Buffer.alloc(1024 * 1024, 'x'));
    log.report('portal-stop', new Error('EPERM C:\\private\\runtime'));
    await log.flush();
    expect((await stat(log.file + '.previous')).size).toBe(1024 * 1024);
    expect((await stat(log.file)).size).toBeLessThan(32_500);
  } finally {
    await log.flush();
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    await rm(root, { recursive: true, force: true });
  }
});

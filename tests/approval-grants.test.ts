import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { ApprovalGrants } from '../desktop/main/chat/approval-grants';
import { ToolApproval } from '../desktop/main/chat/tool-approval';
import type { PermissionMode } from '../desktop/shared/security';

const signal = () => new AbortController().signal;
const exec = { tool: 'portal_exec', workspace: '/work', isolation: 'host-tool',
  arguments: { command: 'npm test', workdir: '/work', justification: 'Run tests' } };
const request = (value = exec, context = {}) => ({ endpoint: 'https://fixture.test/being', verb: 'security-approve',
  sceneId: 'scene-a', args: JSON.stringify(value), ...context });
const file = { tool: 'portal_file_edit', workspace: '/work', isolation: 'file-scope', target: '/outside/notes.txt',
  arguments: { path: '../outside/notes.txt', old_text: 'a', new_text: 'b' } };

it('remembers default-mode consent across scenes, argument order and justification changes', async () => {
  const prompt = vi.fn(async () => true);
  const approval = new ToolApproval(() => 'auto-review', prompt);
  expect(await approval.request(request(), signal())).toBe('allow-once');
  expect(await approval.request(request({ ...exec, arguments: { justification: 'Verify again', workdir: '/work', command: 'npm test' } }, { sceneId: 'scene-b' }), signal())).toBe('allow-once');
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ rememberScope: expect.stringContaining('相同命令') }));
});

it('isolates grants by Being, workspace, command, execution parameters and sandbox', async () => {
  const prompt = vi.fn(async () => true);
  const approval = new ToolApproval(() => 'auto-review', prompt);
  for (const input of [request(), request(exec, { endpoint: 'https://fixture.test/other' }),
    request({ ...exec, workspace: '/other' }), request({ ...exec, isolation: 'macos-seatbelt-offline' }),
    request({ ...exec, arguments: { ...exec.arguments, workdir: '/other' } }),
    request({ ...exec, arguments: { ...exec.arguments, command: 'npm test && rm important.txt' } })]) {
    expect(await approval.request(input, signal())).toBe('allow-once');
  }
  expect(prompt).toHaveBeenCalledTimes(6);
});

it('reuses canonical file scope across changed edits, including batched edits, but not targets or tools', async () => {
  const prompt = vi.fn(async () => true);
  const approval = new ToolApproval(() => 'auto-review', prompt);
  const call = (value: object) => approval.request({ ...request(), args: JSON.stringify(value) }, signal());
  await call(file);
  await call({ ...file, arguments: { path: '/outside/notes.txt', old_text: 'b', new_text: 'c' } });
  await call({ ...file, arguments: { path: '/outside/notes.txt', expected_sha256: 'updated', edits: [{ old_text: 'c', new_text: 'd' }] } });
  expect(prompt).toHaveBeenCalledTimes(1);
  await call({ ...file, target: '/outside/secrets.txt' });
  await call({ ...file, tool: 'portal_file_write', arguments: { path: '/outside/notes.txt', content: 'new' } });
  expect(prompt).toHaveBeenCalledTimes(3);
  await call({ ...file, tool: 'portal_file_write', arguments: { path: '/outside/notes.txt', content: 'changed' } });
  expect(prompt).toHaveBeenCalledTimes(3);
});

it('remembers public website reads by origin without extending to queries, credentials, ports or headers', async () => {
  const prompt = vi.fn(async () => true);
  const approval = new ToolApproval(() => 'auto-review', prompt);
  const call = (url: string, extra = {}) => approval.request({ ...request(), args: JSON.stringify({
    tool: 'portal_web_fetch', workspace: '/work', isolation: 'public-web-read', arguments: { url, ...extra },
  }) }, signal());
  await call('https://example.com/one');
  await call('https://example.com/two', { max_chars: 500 });
  expect(prompt).toHaveBeenCalledTimes(1);
  for (const url of ['https://example.com/?data=private', 'https://user:pass@example.com/',
    'https://example.com:9443/', 'http://example.com/', 'https://example.com.evil.test/']) await call(url);
  await call('https://example.com/', { headers: { Authorization: 'secret' } });
  expect(prompt).toHaveBeenCalledTimes(7);
});

it('matches unknown tool arguments exactly, preserving nested values and array order', async () => {
  const prompt = vi.fn(async () => true);
  const approval = new ToolApproval(() => 'auto-review', prompt);
  const call = (args: object) => approval.request({ ...request(), args: JSON.stringify({ ...exec, tool: 'custom_tool', arguments: args }) }, signal());
  await call({ options: { a: 1, b: 2 }, values: [1, 2] });
  await call({ values: [1, 2], options: { b: 2, a: 1 } });
  expect(prompt).toHaveBeenCalledTimes(1);
  await call({ options: { a: 1, b: 3 }, values: [1, 2] });
  await call({ options: { a: 1, b: 2 }, values: [2, 1] });
  expect(prompt).toHaveBeenCalledTimes(3);
});

it('keeps supervised mode one-shot and does not reuse grants under read-only', async () => {
  let mode: PermissionMode = 'auto-review';
  const prompt = vi.fn(async () => true);
  const approval = new ToolApproval(() => mode, prompt);
  await approval.request(request(), signal());
  mode = 'supervised';
  await approval.request(request(), signal());
  await approval.request(request(), signal());
  expect(prompt).toHaveBeenCalledTimes(3);
  mode = 'read-only';
  expect(await approval.request(request(), signal())).toBe('deny');
  mode = 'auto-review';
  expect(await approval.request(request(), signal())).toBe('allow-once');
  expect(prompt).toHaveBeenCalledTimes(3);
});

it('allows remembered and reviewed operations while a different prompt is open', async () => {
  const prompt = vi.fn(async () => true);
  const approval = new ToolApproval(() => 'auto-review', prompt);
  await approval.request(request(), signal());
  let resolve!: (allowed: boolean) => void;
  prompt.mockImplementation(() => new Promise<boolean>(r => { resolve = r; }));
  const other = request({ ...exec, arguments: { ...exec.arguments, command: 'npm run build' } });
  const pending = approval.request(other, signal());
  expect(await approval.request(request(), signal())).toBe('allow-once');
  expect(await approval.request({ ...request(), args: JSON.stringify({
    tool: 'portal_web_fetch', workspace: '/work', isolation: 'public-web-read', arguments: { url: 'https://docs.python.org/' },
  }) }, signal())).toBe('allow-once');
  expect(await approval.request(other, signal())).toBe('deny');
  const controller = new AbortController(); controller.abort();
  expect(await approval.request(request(), controller.signal)).toBe('deny');
  expect(prompt).toHaveBeenCalledTimes(2);
  resolve(false);
  expect(await pending).toBe('deny');
});

it('preserves existing grants but never publishes consent cancelled during persistence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'approval-grants-abort-'));
  const filename = path.join(directory, 'grants.json');
  try {
    const grants = new ApprovalGrants(filename);
    const original = 'a'.repeat(64), cancelled = 'b'.repeat(64);
    await grants.remember(original, () => true);
    const controller = new AbortController();
    const saving = grants.remember(cancelled, () => !controller.signal.aborted);
    controller.abort();
    await saving;
    expect(grants.has(original)).toBe(true);
    expect(grants.has(cancelled)).toBe(false);
    const restored = new ApprovalGrants(filename); await restored.load();
    expect(restored.has(original)).toBe(true);
    expect(restored.has(cancelled)).toBe(false);
    await expect(readFile(filename + '.tmp')).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(filename); await restored.load();
    expect(restored.has(original)).toBe(false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it.each(['deny', 'abort', 'mode-change', 'failure'])('does not remember %s as consent', async kind => {
  let mode: PermissionMode = 'auto-review';
  const controller = new AbortController();
  const prompt = vi.fn(async () => {
    if (kind === 'abort') controller.abort();
    if (kind === 'mode-change') mode = 'supervised';
    if (kind === 'failure') throw new Error('closed');
    return kind !== 'deny';
  });
  const approval = new ToolApproval(() => mode, prompt);
  if (kind === 'failure') await expect(approval.request(request(), controller.signal)).rejects.toThrow('closed');
  else expect(await approval.request(request(), controller.signal)).toBe('deny');
  mode = 'auto-review'; prompt.mockImplementation(async () => true);
  expect(await approval.request(request(), signal())).toBe('allow-once');
  expect(prompt).toHaveBeenCalledTimes(2);
});

it('restores grants after restarting without storing command text, and rejects corrupt or unknown files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'approval-grants-'));
  const filename = path.join(directory, 'grants.json');
  try {
    const grants = new ApprovalGrants(filename);
    await grants.load();
    await new ToolApproval(() => 'auto-review', async () => true, grants).request(request(), signal());
    expect(await readFile(filename, 'utf8')).not.toContain('npm test');
    const restored = new ApprovalGrants(filename); await restored.load();
    const prompt = vi.fn(async () => true);
    expect(await new ToolApproval(() => 'auto-review', prompt, restored).request(request(), signal())).toBe('allow-once');
    expect(prompt).not.toHaveBeenCalled();
    for (const data of ['broken', '{"version":2,"keys":[]}', '{"version":1,"keys":[true]}']) {
      await writeFile(filename, data); await restored.load();
      await new ToolApproval(() => 'auto-review', prompt, restored).request(request(), signal());
    }
    expect(prompt).toHaveBeenCalledTimes(3);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('does not retain consent if saving fails', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'approval-grants-failure-'));
  try {
    const grants = new ApprovalGrants(directory);
    const prompt = vi.fn(async () => true);
    const approval = new ToolApproval(() => 'auto-review', prompt, grants);
    await expect(approval.request(request(), signal())).rejects.toThrow();
    await expect(approval.request(request(), signal())).rejects.toThrow();
    expect(prompt).toHaveBeenCalledTimes(2);
  } finally { await rm(directory, { recursive: true, force: true }); await rm(directory + '.tmp', { force: true }); }
});

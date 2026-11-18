import { expect, it, vi } from 'vitest';
import { ToolApproval } from '../desktop/main/chat/tool-approval';
import { permissionMode, type PermissionMode } from '../desktop/shared/security';

const request = { endpoint: 'https://fixture.test/being', verb: 'security-approve', sceneId: 'scene-a',
  args: JSON.stringify({ tool: 'portal_exec', arguments: { command: 'echo hello' }, workspace: 'D:\\work' }) };

it('defaults to asking every time and rejects unknown policy values', () => {
  expect(permissionMode(undefined)).toBe('supervised');
  expect(() => permissionMode('auto-approve')).toThrow();
});

it('shows the exact operation and keeps supervised approvals one-shot', async () => {
  const prompt = vi.fn(async () => true);
  const approval = new ToolApproval(() => 'supervised', prompt);
  const signal = new AbortController().signal;
  expect(await approval.request(request, signal)).toBe('allow-once');
  expect(prompt.mock.calls[0]).toBeDefined();
  expect(await approval.request(request, signal)).toBe('allow-once');
  expect(prompt).toHaveBeenCalledTimes(2);
  expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('echo hello') }));
  expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('scene-a') }));
});

it('queues concurrent prompts and rejects cancellation and policy changes without granting consent', async () => {
  let mode: PermissionMode = 'supervised';
  let resolve!: (allowed: boolean) => void;
  const prompt = vi.fn(() => new Promise<boolean>(r => { resolve = r; }));
  const approval = new ToolApproval(() => mode, prompt);
  const controller = new AbortController();
  const first = approval.request(request, controller.signal);
  const queued = approval.request(request, controller.signal);
  await vi.waitFor(() => expect(prompt).toHaveBeenCalled());
  expect(prompt).toHaveBeenCalledTimes(1);
  controller.abort(); resolve(true);
  await expect(first).rejects.toThrow('已取消');
  await expect(queued).rejects.toThrow('已取消');
  const second = approval.request(request, new AbortController().signal);
  await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
  mode = 'full-access'; resolve(true);
  await expect(second).rejects.toThrow('权限模式已更改');
  await expect(approval.request(request, new AbortController().signal)).rejects.toThrow('权限模式已更改');
});

it('rejects malformed and oversized operations without opening a prompt', async () => {
  const prompt = vi.fn(async () => true);
  const approval = new ToolApproval(() => 'supervised', prompt);
  for (const args of ['{}', 'null', JSON.stringify({tool:'portal_exec', workspace:'x', arguments:{command:'x'.repeat(21000)}})]) {
    await expect(approval.request({ ...request, args }, new AbortController().signal)).rejects.toThrow();
  }
  expect(prompt).not.toHaveBeenCalled();
});

it('does not turn rejection or a dialog failure into authorization', async () => {
  const signal = new AbortController().signal;
  expect(await new ToolApproval(() => 'supervised', async () => false).request(request, signal)).toBe('deny');
  const approval = new ToolApproval(() => 'supervised', async () => { throw new Error('window closed'); });
  await expect(approval.request(request, signal)).rejects.toThrow('window closed');
  await expect(approval.request(request, signal)).rejects.toThrow('window closed');
});

it.each([
  ['macos-seatbelt-offline', 'macOS 沙箱'],
  ['windows-lpac-offline', 'Windows 沙箱'],
  ['host-tool', '本机工具'],
])('describes the actual %s isolation in the approval', async (isolation, label) => {
  const prompt = vi.fn(async () => true);
  const approval = new ToolApproval(() => 'supervised', prompt);
  await approval.request({ ...request, args: JSON.stringify({ ...JSON.parse(request.args), isolation }) }, new AbortController().signal);
  expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining(label) }));
});

it('cancels a queued caller immediately without allowing a later dialog to overtake the active one', async () => {
  let finish!: (allowed: boolean) => void;
  const prompt = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const approval = new ToolApproval(() => 'supervised', prompt);
  const first = approval.request(request, new AbortController().signal);
  await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
  const cancelled = new AbortController();
  const second = approval.request(request, cancelled.signal);
  const rejected = expect(second).rejects.toThrow('已取消');
  const third = approval.request(request, new AbortController().signal);
  cancelled.abort();
  await rejected;
  expect(prompt).toHaveBeenCalledTimes(1);
  finish(true);
  expect(await first).toBe('allow-once');
  await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
  finish(false);
  expect(await third).toBe('deny');
});

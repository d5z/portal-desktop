import { expect, it, vi } from 'vitest';
import { ToolApproval } from '../desktop/main/chat/tool-approval';
import { permissionMode, type PermissionMode } from '../desktop/shared/security';

const request = { endpoint: 'https://fixture.test/being', verb: 'security-approve', sceneId: 'scene-a',
  args: JSON.stringify({ tool: 'portal_exec', arguments: { command: 'echo hello' }, workspace: 'D:\\work' }) };

it('defaults to automatic review and rejects unknown policy values', () => {
  expect(permissionMode(undefined)).toBe('auto-review');
  expect(() => permissionMode('auto-approve')).toThrow();
});

it('shows the exact operation and never caches approvals', async () => {
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

it('denies cancellation, policy changes, and concurrent prompt floods', async () => {
  let mode: PermissionMode = 'supervised';
  let resolve!: (allowed: boolean) => void;
  const prompt = vi.fn(() => new Promise<boolean>(r => { resolve = r; }));
  const approval = new ToolApproval(() => mode, prompt);
  const controller = new AbortController();
  const first = approval.request(request, controller.signal);
  expect(await approval.request(request, controller.signal)).toBe('deny');
  controller.abort(); resolve(true);
  expect(await first).toBe('deny');
  const second = approval.request(request, new AbortController().signal);
  mode = 'read-only'; resolve(true);
  expect(await second).toBe('deny');
  expect(await approval.request(request, new AbortController().signal)).toBe('deny');
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

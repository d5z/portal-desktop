import { expect, it, vi } from 'vitest';
import { ApprovalDialogs } from '../desktop/main/chat/approval-dialogs';
it('binds a single response to its request and rejects stale replies', async () => {
  const publish = vi.fn(); const dialogs = new ApprovalDialogs(publish);
  const waiting = dialogs.request({ title:'test', message:'run', detail:'command', rememberScope:'同一目标', signal:new AbortController().signal });
  expect(dialogs.current()?.rememberScope).toBe('同一目标');
  const id = dialogs.current()!.id;
  expect(() => dialogs.answer('forged', true)).toThrow();
  dialogs.answer(id, true);
  expect(await waiting).toBe(true);
  expect(dialogs.current()).toBeNull();
  expect(() => dialogs.answer(id, true)).toThrow();
  expect(publish).toHaveBeenLastCalledWith(null);
});
it('denies timeout, cancelled calls, and concurrent requests', async () => {
  vi.useFakeTimers();
  try {
    const dialogs = new ApprovalDialogs(() => {});
    const controller = new AbortController();
    const input = { title:'test', message:'run', detail:'command', signal:controller.signal };
    const waiting = dialogs.request(input);
    expect(await dialogs.request(input)).toBe(false);
    controller.abort(); expect(await waiting).toBe(false);
    const expiring = dialogs.request({ ...input, signal:new AbortController().signal });
    await vi.advanceTimersByTimeAsync(120001);
    expect(await expiring).toBe(false);
    expect(dialogs.current()).toBeNull();
  } finally { vi.useRealTimers(); }
});

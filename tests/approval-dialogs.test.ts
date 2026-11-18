import { expect, it, vi } from 'vitest';
import { ApprovalDialogs } from '../desktop/main/chat/approval-dialogs';
it('binds a single response to its request and rejects stale replies', async () => {
  const publish = vi.fn(); const dialogs = new ApprovalDialogs(publish);
  const waiting = dialogs.request({ title:'test', message:'run', detail:'command', signal:new AbortController().signal });
  const id = dialogs.current()!.id;
  expect(() => dialogs.answer('forged', true)).toThrow();
  dialogs.answer(id, true);
  expect(await waiting).toBe(true);
  expect(dialogs.current()).toBeNull();
  expect(() => dialogs.answer(id, true)).toThrow();
  expect(publish).toHaveBeenLastCalledWith(null);
});
it('distinguishes timeout, cancelled calls, and concurrent requests from user denial', async () => {
  vi.useFakeTimers();
  try {
    const dialogs = new ApprovalDialogs(() => {});
    const controller = new AbortController();
    const input = { title:'test', message:'run', detail:'command', signal:controller.signal };
    const waiting = expect(dialogs.request(input)).rejects.toThrow('已取消');
    await expect(dialogs.request(input)).rejects.toThrow('另一个操作');
    controller.abort(); await waiting;
    const expiring = expect(dialogs.request({ ...input, signal:new AbortController().signal })).rejects.toThrow('60 秒');
    await vi.advanceTimersByTimeAsync(60001);
    await expiring;
    expect(dialogs.current()).toBeNull();
  } finally { vi.useRealTimers(); }
});

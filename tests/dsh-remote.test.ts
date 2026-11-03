import { Context } from '@deepseek-ai/cordis';
import { describe, expect, it, vi } from 'vitest';
import { LocalRemote } from '../desktop/renderer/plugins/dsh/remote';

const descriptor = (method: string) => ({ namespace: 'shared', service: 'host', method, invocation: { kind: 'direct' }, parameters: [], mode: 'unary' });
describe('Remote contribution lifetimes', () => {
  it('owns shared namespaces independently of the first contributing fiber', async () => {
    const ctx = new Context(); new LocalRemote(ctx);
    const a = ctx.plugin({ name: 'remote-a', inject: ['remote'], async apply(scope) {
      await (scope.get('remote') as LocalRemote).$mount({ descriptors: [descriptor('first')] });
    } });
    await a.await();
    const b = ctx.plugin({ name: 'remote-b', inject: ['remote'], async apply(scope) {
      await (scope.get('remote') as LocalRemote).$mount({ descriptors: [descriptor('second')] });
    } });
    await b.await(); await a.dispose();
    expect(Object.keys(ctx.get('remote.shared') as object)).toEqual(['second']);
    await b.dispose(); expect(ctx.get('remote.shared')).toBeUndefined();
  });
  it('keeps peer methods available when a contribution is removed and can remount it', async () => {
    const ctx = new Context(), remote = new LocalRemote(ctx);
    const call = vi.spyOn(remote, 'call').mockResolvedValue({ ok: true, value: 7 });
    const first = await remote.$mount({ descriptors: [descriptor('first')] });
    const second = await remote.$mount({ descriptors: [descriptor('second')] });
    const face = ctx.get('remote.shared') as any;
    expect(Object.keys(face).sort()).toEqual(['first', 'second']);
    const stale = face.first;
    first(); first();
    expect(face.first).toBeUndefined();
    await expect(stale()).rejects.toThrow('已卸载');
    await expect(face.second()).resolves.toEqual({ ok: true, value: 7 });
    expect(call).toHaveBeenCalledTimes(1);
    const again = await remote.$mount({ descriptors: [descriptor('first')] });
    second();
    expect(ctx.get('remote.shared')).toBe(face);
    expect(Object.keys(face)).toEqual(['first']);
    again();
    expect(ctx.get('remote.shared')).toBeUndefined();
  });
  it('rejects collisions transactionally without removing existing methods', async () => {
    const ctx = new Context(), remote = new LocalRemote(ctx);
    const release = await remote.$mount({ descriptors: [descriptor('first')] });
    await expect(remote.$mount({ descriptors: [descriptor('second'), descriptor('first')] })).rejects.toThrow('冲突');
    expect(Object.keys(ctx.get('remote.shared') as object)).toEqual(['first']);
    release();
  });
  it('aborts pending calls on unmount', async () => {
    const ctx = new Context(), remote = new LocalRemote(ctx);
    let pendingSignal: AbortSignal | undefined;
    vi.spyOn(remote, 'call').mockImplementation(async (_service, _method, _args, signal) => {
      pendingSignal = signal;
      return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    });
    const release = await remote.$mount({ descriptors: [descriptor('first')] });
    const request = (ctx.get('remote.shared') as any).first();
    const rejected = expect(request).rejects.toThrow('aborted');
    release(); await rejected;
    expect(pendingSignal?.aborted).toBe(true);
  });
});

import { Context } from '@deepseek-ai/cordis';
import { mkdtemp, rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { installLocalServices } from '../desktop/main/plugins/dsh/local-services';

it('decodes RPC JSON across UTF-8 byte boundaries and limits the received bytes', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'town-dsh-rpc-'));
  vi.stubEnv('DSH_HOME', home);
  try {
    const services = await installLocalServices(new Context());
    const invoke = async (chunks: Buffer[]) => {
      const request = Object.assign(Readable.from(chunks), { method: 'POST' });
      let body = '';
      const response = { setHeader() {}, end(value: string) { body = value; } };
      await services.handle(request as IncomingMessage, response as unknown as ServerResponse, '/@town-dsh/rpc');
      return JSON.parse(body);
    };
    const bytes = Buffer.from(JSON.stringify({ service: 'settings', method: 'mutate', args: ['你好🌱', []] }));
    const result = await invoke([...bytes].map(byte => Buffer.from([byte])));
    expect(result.error.message).toBe('Error: 未知配置命名空间：你好🌱');
    const oversized = Buffer.from(JSON.stringify({ service: 'settings', method: 'describe', padding: '中'.repeat(400000) }));
    expect((await invoke([oversized])).error.message).toBe('Error: RPC 请求过大');
  } finally {
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  }
});

it('emits Town completion/error transitions once without replaying initial state or inventing approvals', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'town-dsh-activity-'));
  vi.stubEnv('DSH_HOME', home);
  const ctx = new Context(), events: unknown[][] = [];
  (ctx as any).on('session/event', (...args: unknown[]) => events.push(args));
  try {
    const services = await installLocalServices(ctx);
    const update = async (state: unknown) => {
      const request = Object.assign(Readable.from([Buffer.from(JSON.stringify({service:'townActivity',method:'update',args:[state]}))]), {method:'POST'});
      let body = '';
      await services.handle(request as IncomingMessage, {setHeader(){},end(value: string){body=value;}} as unknown as ServerResponse, '/@town-dsh/rpc');
      return JSON.parse(body);
    };
    await update({a:'done'}); expect(events).toHaveLength(0);
    await update({a:'working',b:'thinking'});
    await update({a:'done',b:'error'});
    await update({a:'done',b:'error'});
    expect(events).toEqual([
      [{header:{id:'a',origin:'town'}},{type:'turn/end',seq:1,data:{reason:{kind:'completed'}}}],
      [{header:{id:'b',origin:'town'}},{type:'turn/end',seq:2,data:{reason:{kind:'error'}}}],
    ]);
    await update({a:'stopped'}); await update({}); expect(events).toHaveLength(2);
    expect((await update({a:'approval'})).error.message).toContain('无效 Town 场景状态');
  } finally { await ctx.fiber.dispose(); vi.unstubAllEnvs(); await rm(home,{recursive:true,force:true}); }
});

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

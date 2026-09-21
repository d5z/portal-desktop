import type { ChatScene } from '../../shared/types';
import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, rename, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

export interface ClientCommandRequest { endpoint: string; verb: string; args: string; sceneId?: string; scenes?: ChatScene[] }

/** Local capability endpoint; never forwards requests from a different Being. */
export class ClientCommandServer {
  private server?: Server;
  private token = randomBytes(32).toString('hex');
  constructor(private file: string, private currentEndpoint: () => string | undefined,
    private execute: (request: ClientCommandRequest) => Promise<string>) {}

  async start() {
    const server = createServer(async (request, response) => {
      const reply = (status: number, value: object) => {
        if (!response.destroyed) { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)); }
      };
      const authorization = Buffer.from(request.headers.authorization || '');
      const expected = Buffer.from(`Bearer ${this.token}`);
      if (request.method !== 'POST' || request.url !== '/command' || request.headers.origin ||
          authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
        reply(403, { error: 'Unauthorized client request' }); return;
      }
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          const bytes = Buffer.from(chunk);
          chunks.push(bytes); size += bytes.length;
          if (size > 8192) { reply(413, { error: 'Request too large' }); return; }
        }
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!data || typeof data.verb !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(data.verb) ||
            typeof data.args !== 'string' || data.args.length > 1024 ||
            (data.sceneId != null && (typeof data.sceneId !== 'string' || data.sceneId.length > 256))) {
          reply(400, { error: 'Invalid client command' }); return;
        }
        const endpoint = this.currentEndpoint();
        if (!endpoint || data.endpoint !== endpoint) { reply(409, { error: 'Being connection changed' }); return; }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const text = await Promise.race([
            this.execute(data),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Client command timed out')), 8000); }),
          ]);
          if (this.currentEndpoint() !== endpoint) { reply(409, { error: 'Being connection changed' }); return; }
          if (typeof text !== 'string' || text.length > 256_000) throw new Error('Client response too large');
          reply(200, { text });
        } finally { clearTimeout(timer); }
      } catch (error) { reply(200, { error: error instanceof Error ? error.message : 'Client command failed' }); }
    });
    server.requestTimeout = 10_000;
    server.headersTimeout = 10_000;
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    this.server = server;
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Client server did not bind');
    try {
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      await writeFile(this.file + '.tmp', JSON.stringify({ port: address.port, token: this.token }), { mode: 0o600 });
      await rename(this.file + '.tmp', this.file);
    } catch (error) { await this.close(); throw error; }
  }

  async close() {
    this.server?.closeAllConnections();
    if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve()));
    this.server = undefined;
    await rm(this.file, { force: true });
  }
}

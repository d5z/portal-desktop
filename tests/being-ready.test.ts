import { expect, it, vi } from 'vitest';
import { verifyBeingConnection } from '../desktop/main/chat/ready';
import { parseConnection } from '../desktop/main/chat/connection';

const connection = parseConnection('https://example.org/willow/?token=private-token');
it('requires saved configuration and an authenticated Being status response', async () => {
  const fetcher = vi.fn(async () => Response.json({ being_name: 'Willow' }));
  await expect(verifyBeingConnection(null, fetcher)).rejects.toThrow('尚未配置');
  expect(fetcher).not.toHaveBeenCalled();
  await verifyBeingConnection(connection, fetcher);
  expect(fetcher).toHaveBeenCalledWith('https://example.org/willow/api/status?token=private-token',
    expect.objectContaining({ redirect: 'error', credentials: 'omit', signal: expect.any(AbortSignal) }));
});
it('blocks unauthenticated, unreachable, invalid and oversized responses without leaking credentials', async () => {
  for (const response of [new Response('', { status: 401 }), new Response('', { status: 403 }),
    new Response('', { status: 503 }), new Response('<html>Sign in</html>'), Response.json({}), new Response('x'.repeat(64_001))]) {
    await expect(verifyBeingConnection(connection, async () => response)).rejects.toThrow('Portal 未启动');
  }
  const failed = async () => { throw new Error('fetch https://example.org/?token=private-token failed'); };
  await expect(verifyBeingConnection(connection, failed)).rejects.toThrow('无法验证 Being 连接');
  await expect(verifyBeingConnection(connection, failed)).rejects.not.toThrow('private-token');
});

it('records the HTTP result and failing stage without URLs containing credentials or response bodies', async () => {
  const diagnostic = vi.fn();
  for (const [response, stage, status] of [
    [new Response('private-token', { status: 403 }), 'http', 403],
    [new Response('private-token'), 'response-body', 200],
  ] as const) {
    await expect(verifyBeingConnection(connection, async () => response, diagnostic)).rejects.toThrow();
    expect(diagnostic).toHaveBeenLastCalledWith({ endpoint: connection.endpoint, route: '/api/status',
      stage, status, ok: false, durationMs: expect.any(Number) });
  }
  await expect(verifyBeingConnection(connection, async () => { throw new Error(connection.link); }, diagnostic)).rejects.toThrow();
  expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'request', status: undefined, ok: false }));
  await verifyBeingConnection(connection, async () => Response.json({ name: 'Willow' }), diagnostic);
  expect(diagnostic).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'validated', status: 200, ok: true }));
  expect(diagnostic).toHaveBeenCalledTimes(4);
  expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/private-token|\?token/);
});

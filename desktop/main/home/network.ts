import { randomUUID } from 'node:crypto';
import { CONNECTOR_NETWORK_METHODS, CONNECTOR_NETWORK_ROUTES } from '../../shared/home';
import { publicErrorMessage } from '../../shared/errors';
import { HomeError } from './protocol';

/** Renderer-visible requests reuse the trusted Connector handlers; Home tokens stay in main. */
export class ConnectorNetwork {
  readonly key = randomUUID();
  readonly handlers = new Map<string, (...args: any[]) => unknown>();
  constructor(private shellURL: () => string) {}

  async handle(request: Request): Promise<Response> {
    const shell = new URL(this.shellURL());
    const origin = `${shell.protocol}//${shell.host}`;
    const headers = { 'Access-Control-Allow-Origin': origin, 'Cache-Control': 'no-store', Vary: 'Origin' };
    const url = new URL(request.url);
    const routeMatch = (template: string) => {
      const actual = url.pathname.split('/');
      const expected = template.split('/');
      if (actual.length !== expected.length || !expected.every((segment, index) => segment.startsWith(':') || segment === actual[index])) return;
      return expected.flatMap((segment, index) => segment.startsWith(':') ? [decodeURIComponent(actual[index])] : []);
    };
    const routeOperations = Object.entries(CONNECTOR_NETWORK_ROUTES).flatMap(([operation, template]) => {
      const args = routeMatch(template);
      return args ? [{ operation: operation as keyof typeof CONNECTOR_NETWORK_METHODS, args }] : [];
    });
    const matched = routeOperations.find(item => request.method === 'OPTIONS' || CONNECTOR_NETWORK_METHODS[item.operation] === request.method);
    const operation = (matched?.operation || '') as keyof typeof CONNECTOR_NETWORK_METHODS;
    const callback = this.handlers.get(operation);
    if (!callback || (request.headers.has('Origin') && request.headers.get('Origin') !== origin)) return new Response(null, { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
      ...headers, 'Access-Control-Allow-Methods': [...new Set(routeOperations.map(item => CONNECTOR_NETWORK_METHODS[item.operation]))].join(', '),
      'Access-Control-Allow-Headers': 'Content-Type, X-Connector-Access',
    } });
    if (request.headers.get('X-Connector-Access') !== this.key) return new Response(null, { status: 403, headers });
    if (request.method !== CONNECTOR_NETWORK_METHODS[operation]) return new Response(null, { status: 405, headers });
    let args: unknown;
    try { args = request.method === 'GET' ? JSON.parse(url.searchParams.get('args') || '[]') : await request.json(); }
    catch { return Response.json({ error: '无效的 Connector 请求。' }, { status: 400, headers }); }
    if (!Array.isArray(args)) return Response.json({ error: '无效的 Connector 请求。' }, { status: 400, headers });
    try {
      const value = await callback(...(matched?.args || []), ...args);
      if (value === undefined) return new Response(null, { status: 204, headers });
      const rejected = operation === 'lifecycle' && (value as { accepted: boolean }).accepted === false;
      return Response.json(value, { status: rejected ? 409 : 200, headers });
    } catch (error) {
      return Response.json({ error: publicErrorMessage(error, 'Connector 请求失败，请重试。') }, {
        status: error instanceof HomeError && error.status >= 400 ? error.status : 502, headers,
      });
    }
  }
}

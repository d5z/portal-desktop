import { randomUUID } from 'node:crypto';
import { CONNECTOR_NETWORK_METHODS, CONNECTOR_NETWORK_ROUTES } from '../../shared/home';
import { publicErrorMessage } from '../../shared/errors';
import { HomeError } from './protocol';

/** Fixed Connector resources reuse Home authentication; tokens stay in main. */
export class ConnectorNetwork {
  readonly key = randomUUID();
  forward?: (request: Request, sessionVersion: number) => Promise<Response>;
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
    if (!matched || (request.headers.has('Origin') && request.headers.get('Origin') !== origin)) return new Response(null, { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
      ...headers, 'Access-Control-Allow-Methods': [...new Set(routeOperations.map(item => CONNECTOR_NETWORK_METHODS[item.operation]))].join(', '),
      'Access-Control-Allow-Headers': 'Content-Type, X-Connector-Access, X-Home-Session',
    } });
    if (request.headers.get('X-Connector-Access') !== this.key) return new Response(null, { status: 403, headers });
    if (request.method !== CONNECTOR_NETWORK_METHODS[operation]) return new Response(null, { status: 405, headers });
    const session = request.headers.get('X-Home-Session');
    if (session === null || !/^\d+$/.test(session)) return Response.json({ error: 'home_session_changed' }, { status: 409, headers });
    if (!this.forward) return new Response(null, { status: 503, headers });
    try {
      const upstream = await this.forward(request, Number(session));
      const responseHeaders = new Headers(upstream.headers);
      for (const [name, value] of Object.entries(headers)) responseHeaders.set(name, value);
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch (error) {
      return Response.json({ error: error instanceof HomeError ? error.code : publicErrorMessage(error, 'Connector 请求失败，请重试。') }, {
        status: error instanceof HomeError && error.status >= 400 ? error.status : 502, headers,
      });
    }
  }
}

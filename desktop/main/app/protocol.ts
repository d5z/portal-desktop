import { protocol, session } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChatProxy } from '../chat/proxy';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const CHAT_CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src https: data: blob:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'";
const CHAT_ASSETS = new Set(['loom.html', 'chat.js', 'highlight.css', 'chat.css', 'client-context.html', 'client-context.js']);

export function registerLocalProtocol(assets: string, proxy: ChatProxy) {
  protocol.handle('beings', async request => {
    const url = new URL(request.url);
    if (url.hostname === 'chat' && (url.pathname.startsWith('/api/') || url.pathname === '/health')) return proxy.handle(request);
    if (!['desktop', 'chat'].includes(url.hostname) || request.method !== 'GET') return new Response('Not found', { status: 404 });

    const relative = url.hostname === 'chat'
      ? (url.pathname === '/' ? 'loom.html' : url.pathname.slice(1))
      : (url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    if (url.hostname === 'chat' && !CHAT_ASSETS.has(relative)) return new Response('Not found', { status: 404 });

    const file = path.resolve(assets, relative);
    if (!file.startsWith(assets + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const headers: Record<string, string> = {
        'Content-Type': MIME_TYPES[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      };
      if (url.hostname === 'chat') headers['Content-Security-Policy'] = CHAT_CONTENT_SECURITY_POLICY;
      return new Response(await readFile(file), { headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

export function configureLocalSession() {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}

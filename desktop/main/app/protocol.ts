import type { DshPluginManager } from '../plugins/dsh/manager';
import { app, dialog, protocol, session, shell } from 'electron';
import type { LocalFilePreviews } from './local-file-preview';
import {AttachmentDownloads} from '../chat/downloads';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChatProxy } from '../chat/proxy';
import type { PluginRegistry } from '../plugins/registry';
import { remoteImage } from '../chat/remote-image';
import { HTML_PREVIEW_RUNTIME, htmlPreviewPolicy } from './html-preview';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const CHAT_CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src https: data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-src beings://chat/iui-runtime.html";
const CHAT_ASSETS = new Set(['loom.html', 'chat.js', 'highlight.css', 'chat.css', 'client-context.html', 'client-context.js', 'iui-runtime.html']);

export function registerLocalProtocol(assets: string, proxy: ChatProxy, plugins?: PluginRegistry, downloads = new AttachmentDownloads(app.getPath('userData'), async current => {
  const result=await dialog.showOpenDialog({title:'选择附件下载位置',defaultPath:current || app.getPath('downloads'),properties:['openDirectory','createDirectory']});
  return result.canceled ? undefined : result.filePaths[0];
}, file => shell.openPath(file), file => shell.showItemInFolder(file)), localFiles?: LocalFilePreviews, dshPlugins?: DshPluginManager) {
  proxy.onAttachmentUploaded = (token,endpoint,id,checksum) => downloads.bindSource(token,endpoint,id,checksum);
  protocol.handle('beings', async request => {
    const url = new URL(request.url);
    if (url.hostname === 'desktop' && dshPlugins?.matches(url.pathname)) return dshPlugins.resource(request);
    if (url.hostname === 'chat' && url.pathname === '/api/remote-image') return remoteImage(request);
    if (url.hostname === 'preview' && url.pathname === '/runtime.html' && request.method === 'GET') return new Response(HTML_PREVIEW_RUNTIME, { headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': htmlPreviewPolicy(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    } });
    if (url.hostname === 'preview' && localFiles) return localFiles.resource(request);
    if (url.hostname === 'chat' && url.pathname === '/api/local-downloads') return downloads.handle(request,proxy);
    if (url.hostname === 'plugins' && request.method === 'GET' && plugins) return plugins.document(url);
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
      if (url.hostname === 'chat') headers['Content-Security-Policy'] = relative === 'iui-runtime.html'
        ? "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'"
        : CHAT_CONTENT_SECURITY_POLICY;
      return new Response(await readFile(file), { headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

export function configureLocalSession(shellURL: () => string = () => 'beings://desktop/', notificationsAllowed: () => boolean = () => false) {
  const trusted = (url: string | undefined) => { try { const actual = new URL(url || ''), expected = new URL(shellURL()); return actual.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname; } catch { return false; } };
  const allow = (contents: Electron.WebContents | null, permission: string, details: { isMainFrame: boolean; requestingUrl?: string }) => permission === 'notifications' && details.isMainFrame && trusted(details.requestingUrl) && trusted(contents?.getURL()) && notificationsAllowed();
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(allow(contents, permission, details)));
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => allow(contents, permission, details));
}

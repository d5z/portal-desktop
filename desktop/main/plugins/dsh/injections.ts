import { parse, serializeOuter, type DefaultTreeAdapterMap } from 'parse5';
import { externalizePluginScripts } from './html';
import type { DshDocumentInjection } from '../../../shared/dsh-plugins';
/** Raw contributions belong to the host; only compiled HTML/scripts cross IPC. */
export type IndexInjection = { placement?: string } & (
  | { kind: 'global'; name: string; value?: unknown }
  | { kind: 'script' | 'style'; text: string }
  | { kind: 'script-src'; src: string; type?: string }
  | { kind: 'script-preload'; src: string }
  | { kind: 'html'; html: string }
);
const attr = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
/** Match DSH's ordering: render structured rows, then transform that same document with every legacy tap. */
export function compileIndexInjections(rows: IndexInjection[], taps: ((html: string) => string)[], scripts: Map<string, string>): DshDocumentInjection[] {
  let head = '', body = '';
  for (const row of rows) {
    let html = '', placement = row.placement || 'head';
    const { kind } = row;
    switch (kind) {
      case 'global': html = `<script>globalThis[${JSON.stringify(row.name)}]=${JSON.stringify(row.value)?.replaceAll('<', '\\u003c') ?? 'undefined'}</script>`; break;
      case 'script': html = `<script>${row.text}</script>`; break;
      case 'script-src': html = `<script src="${attr(row.src)}"${row.type ? ` type="${attr(row.type)}"` : ''}></script>`; break;
      case 'script-preload': html = `<link rel="preload" as="script" href="${attr(row.src)}">`; break;
      case 'style': html = `<style>${row.text}</style>`; break;
      case 'html': html = row.html || ''; break;
      default: throw new Error(`不支持的注入类型：${kind}`);
    }
    if (placement === 'body') body += html; else head += html;
  }
  let html = `<html><head>${head}</head><body>${body}</body></html>`;
  for (const tap of taps) html = tap(html);
  const doc = parse(externalizePluginScripts(html, scripts, process.env.TOWN_DSH_DOCUMENT_URL || 'beings://desktop/')), result: DshDocumentInjection[] = [];
  const walk = (node: DefaultTreeAdapterMap['node']) => {
    if ('tagName' in node && (node.tagName === 'head' || node.tagName === 'body')) {
      const placement = node.tagName;
      for (const child of node.childNodes) {
        const extracted: DshDocumentInjection[] = [];
        const collect = (current: DefaultTreeAdapterMap['node']): boolean => {
          if ('tagName' in current && current.tagName === 'script') {
            const type = current.attrs.find(a => a.name === 'type')?.value;
            if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) return false;
            const src = current.attrs.find(a => a.name === 'src')?.value;
            if (src) extracted.push({ kind: 'script-src', placement, src, type });
            return true;
          }
          if ('childNodes' in current && !('tagName' in current && current.tagName === 'template')) current.childNodes = current.childNodes.filter(child => !collect(child)) as any;
          return false;
        };
        if (!collect(child)) result.push({ kind: 'html', placement, html: serializeOuter(child) });
        result.push(...extracted);
      }
    } else if ('childNodes' in node) node.childNodes.forEach(walk);
  };
  walk(doc); return result;
}

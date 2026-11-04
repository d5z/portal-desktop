import { parse, serializeOuter, type DefaultTreeAdapterMap } from 'parse5';
import { diffArrays } from 'diff';
import { externalizeDocumentScripts } from './html';
import type { DshDocumentInjection } from '../../../shared/dsh-plugins';
/** Raw contributions belong to the host; only compiled HTML/scripts cross IPC. */
export type IndexInjection = { placement?: string; owner?: string } & (
  | { kind: 'global'; name: string; value?: unknown }
  | { kind: 'script' | 'style'; text: string }
  | { kind: 'script-src'; src: string; type?: string }
  | { kind: 'script-preload'; src: string }
  | { kind: 'html'; html: string }
);
const attr = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
/** Match DSH's ordering: render structured rows, then transform that same document with every legacy tap. */
export function compileIndexInjections(rows: IndexInjection[], taps: { owner?: string; transform: (html: string) => string }[], scripts: Map<string, string>): DshDocumentInjection[] {
  type Token = { text: string; owner?: string };
  const tokenize = (html: string, owner?: string): Token[] => html.split(/(?=<)|(?<=>)/).filter(Boolean).map(text => ({ text, owner }));
  const head: Token[] = [], body: Token[] = [];
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
    for (const token of tokenize(html, row.owner)) (placement === 'body' ? body : head).push(token);
  }
  let tokens = [...tokenize('<html><head>'), ...head, ...tokenize('</head><body>'), ...body, ...tokenize('</body></html>')];
  let html = tokens.map(t => t.text).join('');
  // Legacy taps edit the whole document. Keep ownership of unchanged markup;
  // newly inserted or replaced tags belong to the tap that wrote them.
  for (const tap of taps) {
    const next = tap.transform(html);
    if (next === html) continue;
    const nextTokens: Token[] = [];
    let cursor = 0;
    for (const part of diffArrays(tokens.map(t => t.text), tokenize(next).map(t => t.text))) {
      if (part.added) for (const text of part.value) nextTokens.push({ text, owner: tap.owner });
      else {
        if (!part.removed) for (let i = cursor; i < cursor + part.count; i++) nextTokens.push(tokens[i]);
        cursor += part.count;
      }
    }
    tokens = nextTokens; html = next;
  }
  let offset = 0;
  const owners = new Map<number, string>();
  for (const token of tokens) {
    if (token.owner) owners.set(offset, token.owner);
    offset += token.text.length;
  }
  const doc = parse(html, { sourceCodeLocationInfo: true }), result: DshDocumentInjection[] = [];
  externalizeDocumentScripts(doc, scripts, process.env.TOWN_DSH_DOCUMENT_URL || 'beings://desktop/');
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
            if (src) extracted.push({ kind: 'script-src', placement, owner: owners.get(current.sourceCodeLocation!.startOffset), src, type });
            return true;
          }
          if ('childNodes' in current && !('tagName' in current && current.tagName === 'template')) current.childNodes = current.childNodes.filter(child => !collect(child)) as any;
          return false;
        };
        if (!collect(child)) result.push({ kind: 'html', placement, owner: child.sourceCodeLocation ? owners.get(child.sourceCodeLocation.startOffset) : undefined, html: serializeOuter(child) });
        result.push(...extracted);
      }
    } else if ('childNodes' in node) node.childNodes.forEach(walk);
  };
  walk(doc); return result;
}

import { initSync, parse as parseModule } from 'es-module-lexer';
import { createHash } from 'node:crypto';
import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5';

/** Preserve plugin documents while serving their scripts through same-origin URLs.
 * This also works when a plugin fetches HTML and assigns it to iframe.srcdoc.
 * Town's main document does not need unsafe-inline or unsafe-eval permission.
 */
export function externalizePluginScripts(html: string, scripts: Map<string, string>, documentURL = 'beings://desktop/') {
  const document = parse(html);
  externalizeDocumentScripts(document, scripts, documentURL);
  return serialize(document);
}
export function externalizeDocumentScripts(document: DefaultTreeAdapterMap['document'], scripts: Map<string, string>, documentURL: string) {
  initSync();
  let baseURL = documentURL;
  const findBase = (node: DefaultTreeAdapterMap['node']) => {
    if ('tagName' in node && node.tagName === 'base') { const href = node.attrs.find(a => a.name === 'href')?.value; if (href) baseURL = new URL(href, documentURL).href; }
    if ('childNodes' in node) node.childNodes.forEach(findBase);
  };
  findBase(document);
  const walk = (node: DefaultTreeAdapterMap['node']) => {
    if ('tagName' in node && node.tagName === 'script') {
      const type = node.attrs.find(attr => attr.name === 'type')?.value.toLowerCase() || '';
      if (!node.attrs.some(attr => attr.name === 'src') && ['', 'module', 'text/javascript', 'application/javascript'].includes(type)) {
        let source = node.childNodes.map(child => 'value' in child ? child.value : '').join('');
        if (type === 'module') {
          const [imports] = parseModule(source);
          for (const item of [...imports].reverse()) {
            if (item.d === -2 && source.slice(item.e, item.e + 4) === '.url') {
              source = source.slice(0, item.s) + JSON.stringify(documentURL) + source.slice(item.e + 4);
            } else if (item.n && /^(?:\.\.?\/|\/)/.test(item.n)) {
              const value = new URL(item.n, baseURL).href;
              source = source.slice(0, item.s) + (item.d >= 0 ? JSON.stringify(value) : value) + source.slice(item.e);
            }
          }
        }
        const url = '/@town-dsh/document-scripts/' + createHash('sha256').update(source).digest('hex') + '.js';
        if (!scripts.has(url) && scripts.size >= 512) throw new Error('插件文档脚本数量超过限制，请重新加载插件宿主。');
        scripts.set(url, source); node.attrs.push({name:'src',value:url}); node.childNodes = [];
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) walk(child);
  };
  walk(document);
}

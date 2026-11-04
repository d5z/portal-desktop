/** Generated HTML can use the web, but never receives the shell's origin or IPC. */
export const HTML_PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads';
export const htmlPreviewPolicy = (resources = '') => `default-src 'none'; script-src ${resources} http: https: 'unsafe-inline' 'unsafe-eval' blob:; style-src ${resources} http: https: 'unsafe-inline'; img-src ${resources} http: https: data: blob:; font-src ${resources} http: https: data:; media-src ${resources} http: https: data: blob:; connect-src http: https: ws: wss:; frame-src http: https:; worker-src blob:; form-action http: https:; base-uri http: https:; sandbox ${HTML_PREVIEW_SANDBOX}`;

// Keep external links out of the preview frame, including explicit _top targets.
// Fragment links and page-owned click handlers retain their normal behavior.
export const previewLinkScript = `<script>document.addEventListener('click',function(event){
  var link=event.target.closest && event.target.closest('a[href]');
  if(!link || event.defaultPrevented || event.button!==0) return;
  var url=new URL(link.href,document.baseURI);
  if(!['http:','https:','mailto:'].includes(url.protocol)) return;
  if(url.hash && url.origin===location.origin && url.pathname===location.pathname && url.search===location.search) return;
  event.preventDefault(); window.open(url.href,'_blank','noopener');
});</script>`;

/** A separate document avoids inheriting the trusted shell's restrictive CSP. */
export const HTML_PREVIEW_RUNTIME = `<!doctype html><meta charset="utf-8"><script>
addEventListener('message',function receive(event){
  if(event.source!==parent || event.data?.type!=='home:html-preview' || typeof event.data.html!=='string') return;
  removeEventListener('message',receive);
  document.open();
  document.write('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">'+${JSON.stringify(previewLinkScript).replace(/</g, '\\u003c')}+event.data.html);
  document.close();
});</script>`;

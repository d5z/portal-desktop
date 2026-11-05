import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import { zipSync, strToU8 } from 'fflate';
import { build } from '../scripts/renderer-build.mjs';

// Real OOXML fixtures exercise the existing renderers, not stand-in preview components.
const relationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const presentation = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const pptx = zipSync(Object.fromEntries(Object.entries({
  '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
  '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relationships}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
  'ppt/presentation.xml': `<p:presentation xmlns:p="${presentation}" xmlns:r="${relationships}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
  'ppt/_rels/presentation.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[1, 2].map(i => `<Relationship Id="rId${i}" Type="${relationships}/slide" Target="slides/slide${i}.xml"/>`).join('')}</Relationships>`,
  ...Object.fromEntries([1, 2].map(i => [`ppt/slides/slide${i}.xml`, `<p:sld xmlns:p="${presentation}" xmlns:a="${drawing}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F8F4EC"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="800000" y="1200000"/><a:ext cx="10000000" cy="3000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="4400"><a:solidFill><a:srgbClr val="20382C"/></a:solidFill></a:rPr><a:t>Being — slide ${i}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`])),
}).map(([name, xml]) => [name, strToU8(xml)])));
const workbook = new ExcelJS.Workbook();
workbook.addWorksheet('概览').addRows([['文件', '页数'], ['Being Intro', 11]]);
workbook.addWorksheet('备注').addRow(['云端与本地共用渲染']);
const xlsx = await workbook.xlsx.writeBuffer();
const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 240] /Resources << >> /Contents 4 0 R >>'];
const stream = '0 0 1 rg 0 0 400 240 re f\n';
objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
let pdf = '%PDF-1.4\n'; const offsets = [0];
objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
const xref = pdf.length;
pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
const files = {
  'Being-Intro.pptx': Array.from(pptx), 'overview.xlsx': Array.from(xlsx), 'report.pdf': Array.from(strToU8(pdf)),
  ...Object.fromEntries(Object.entries({
    'readme.md': '# 云端 Markdown\n\n**已生成**，可以直接阅读。',
    'data.json': '{"Being":{"pages":11,"ready":true}}',
    'data.csv': '名称,说明\nBeing,"感知,记忆,行动"',
    'query.sql': 'SELECT * FROM being;',
    'diagram.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300"><rect width="800" height="300" fill="#236b4b"/><text x="40" y="140" fill="white" font-size="40">Being SVG</text></svg>',
    'unknown.bin': 'unsupported',
  }).map(([name, text]) => [name, Array.from(strToU8(text))])),
};
const bundle = await build({ plugins: [{ name: 'worker-fixture', setup(builder) {
  builder.onLoad({ filter: /xlsx-preview\.tsx$/ }, async args => ({ loader: 'tsx', contents: (await readFile(args.path, 'utf8')).replace("new URL('./xlsx-worker.ts',import.meta.url)", "new URL('/xlsx-worker.js',location.href)") }));
} }], stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import { createRoot } from 'react-dom/client';
  import { HomeLibrary } from './desktop/renderer/app/models/home-library';
  import { HomeFilePanel } from './desktop/renderer/app/components/home-file-panel';
  import './desktop/renderer/app/styles.scss';
  const files = ${JSON.stringify(files)};
  const store = new HomeLibrary({ preview: async name => ({ name, path:name, bytes:new Uint8Array(files[name]) }), download:async()=>true, list:async()=>({entries:[]}) });
  window.openFile = name => store.open({name,path:name,type:'file',size:files[name].length});
  createRoot(document.getElementById('root')).render(<div className="workspace-body" style={{height:'100vh'}}><main className="workspace-stage" style={{padding:32}}><h1>云端文件预览</h1><p>真实渲染器 · 合成测试文件</p></main><HomeFilePanel store={store}/></div>);
` }, bundle: true, format: 'esm', write: false, outdir: '/fixture', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } });
const assets = new Map(bundle.outputFiles.map(file => ['/' + path.basename(file.path), file.contents]));
for (const [entry, target] of [['desktop/renderer/preview/pptx-runtime.ts', '/pptx-preview.js'], ['desktop/renderer/app/components/xlsx-worker.ts', '/xlsx-worker.js']]) {
  const output = await build({ entryPoints: [entry], bundle: true, write: false, format: 'iife' });
  assets.set(target, output.outputFiles[0].contents);
}
assets.set('/pptx-preview.html', await readFile('desktop/renderer/preview/pptx-preview.html'));
assets.set('/pdf.worker.min.js', await readFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs'));
const server = createServer((req, res) => {
  const asset = assets.get(req.url);
  res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : req.url.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
  res.end(asset || '<!doctype html><link rel="stylesheet" href="/stdin.css"><div id="root"></div><script type="module" src="/stdin.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
try {
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('heading', { name: '云端文件预览' }).waitFor();
  const open = name => page.evaluate(name => window.openFile(name), name);
  const panel = page.locator('.client-file-viewer');
  await mkdir('output/playwright', { recursive: true });
  await open('Being-Intro.pptx');
  const slides = page.frameLocator('iframe[title="幻灯片预览"]');
  await slides.getByRole('status').filter({ hasText: '1 / 2' }).waitFor();
  await slides.locator('#stage').getByText('Being — slide 1').waitFor();
  const fillsPanel = async selector => {
    const box = await page.locator(selector).boundingBox(), parent = await panel.boundingBox();
    assert(box.width > parent.width - 40, 'preview must fill panel width');
    assert(box.height > parent.height - 100, 'preview must fill available panel height');
  };
  await fillsPanel('iframe[title="幻灯片预览"]');
  // A sandboxed iframe paints in another process. Wait for its input hit test
  // to catch up too; DOM visibility alone can still send the click to the iframe.
  await slides.getByRole('button', { name: '下一张' }).hover();
  await slides.locator('#next:hover').waitFor();
  await slides.getByRole('button', { name: '下一张' }).click();
  await slides.locator('#stage').getByText('Being — slide 2').waitFor();
  await slides.getByRole('status').filter({ hasText: '2 / 2' }).waitFor();
  await slides.locator('#stage').evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: 'output/playwright/home-pptx-desktop.png' });
  assert.equal(await slides.getByRole('status').innerText(), '2 / 2');
  await panel.getByRole('button', { name: '展开全部' }).click();
  await fillsPanel('iframe[title="幻灯片预览"]');
  await panel.getByRole('button', { name: '恢复对话' }).click();
  await page.setViewportSize({ width: 800, height: 700 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await fillsPanel('iframe[title="幻灯片预览"]');
  await slides.getByRole('button', { name: '第 1 张幻灯片' }).hover();
  await slides.locator('#thumbs button[data-index="0"]:hover').waitFor();
  await slides.getByRole('button', { name: '第 1 张幻灯片' }).click();
  await slides.locator('#stage').getByText('Being — slide 1').waitFor();
  await page.screenshot({ path: 'output/playwright/home-pptx-narrow-dark.png' });
  await open('overview.xlsx');
  await page.getByRole('tab', { name: '概览' }).waitFor();
  await fillsPanel('.xlsx-preview');
  await page.getByRole('button', { name: 'B2: 11' }).click();
  await page.locator('.xlsx-cell-value').filter({ hasText: 'B2' }).waitFor();
  await page.getByRole('tab', { name: '备注' }).click();
  await page.getByRole('button', { name: 'A1: 云端与本地共用渲染' }).waitFor();
  await page.screenshot({ path: 'output/playwright/home-xlsx-narrow-dark.png' });
  await open('report.pdf');
  await page.waitForFunction(() => { const c = document.querySelector('canvas'); return c?.width && c.getContext('2d').getImageData(10, 10, 1, 1).data[2] === 255; });
  await fillsPanel('.pdf-pages');
  await open('readme.md');
  await panel.getByRole('heading', { name: '云端 Markdown' }).waitFor();
  await open('data.json');
  await panel.locator('summary').filter({ hasText: 'Being:' }).click();
  assert.equal(await panel.locator('details').nth(1).getAttribute('open'), null);
  await open('data.csv');
  await panel.getByRole('cell', { name: '感知,记忆,行动' }).waitFor();
  await open('query.sql');
  assert.equal(await panel.locator('pre').innerText(), 'SELECT * FROM being;');
  await open('diagram.svg');
  await panel.getByRole('img', { name: 'diagram.svg' }).waitFor();
  await page.waitForFunction(() => document.querySelector('.client-file-body img')?.naturalWidth === 800);
  assert((await panel.getByRole('img').boundingBox()).width <= (await panel.boundingBox()).width);
  await open('unknown.bin');
  await panel.getByText('暂不支持此格式的在线预览，请下载后查看。').waitFor();
  await panel.getByRole('button', { name: '下载文件' }).click();
  await panel.getByText('文件已保存').waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: Home PPTX layout/slide navigation/resize, XLSX sheets/cells, PDF pixels, shared Markdown/JSON/CSV/images/text, unsupported download.');
} catch (error) {
  await mkdir('test-results', { recursive: true });
  await context.tracing.stop({ path: 'test-results/home-file-formats-trace.zip' });
  console.error(await context.pages()[0].locator('iframe').contentFrame().locator('body').innerText());
  throw error;
} finally { await browser.close(); server.closeAllConnections(); server.close(); }

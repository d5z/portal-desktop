// Invoked by Forge with Electron's ASAR-aware Node runtime, on every platform.
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('parse5');
const [resources, renderer, ...external] = process.argv.slice(2);
const archive = path.join(resources, 'app.asar');
const { main } = JSON.parse(fs.readFileSync(path.join(archive, 'package.json'), 'utf8'));
const mainCode = fs.readFileSync(path.join(archive, main), 'utf8');
if (/desktop[\\/]+(?:generated|renderer)[\\/"']/.test(mainCode)) {
  throw new Error('Packaged main process still refers to a source-tree renderer path');
}
const expected = new Map();
function compareTree(source, target) {
  if (fs.statSync(source).isDirectory()) {
    for (const name of fs.readdirSync(source)) compareTree(path.join(source, name), path.join(target, name));
  } else expected.set(target, source);
}
const vite = path.join(archive, '.vite');
compareTree('.vite/build', path.join(vite, 'build'));
compareTree('.vite/renderer', path.join(vite, 'renderer'));
const publicRoot = path.join(vite, 'renderer', renderer);
compareTree('desktop/generated', publicRoot);
for (const source of external) compareTree(source, path.join(resources, path.basename(source)));
for (const [target, source] of expected) {
  if (!fs.readFileSync(target).equals(fs.readFileSync(source))) throw new Error('Packaged file differs from build output: ' + target);
}
// Verify local links after Vite rewrites them, including hashed assets and fonts.
let links = 0;
for (const file of expected.keys()) {
  if (!file.startsWith(publicRoot + path.sep) || !/\.(css|html)$/.test(file)) continue;
  const code = fs.readFileSync(file, 'utf8'), refs = [];
  if (file.endsWith('.html')) {
    const nodes = [parse(code)];
    for (const node of nodes) {
      nodes.push(...(node.childNodes || []));
      for (const attr of node.attrs || []) {
        if (attr.name === 'src' || (node.tagName === 'link' && attr.name === 'href')) refs.push(attr.value);
      }
    }
  } else {
    for (const match of code.matchAll(/url\(\s*['"]?([^)'"]+)['"]?\s*\)/g)) refs.push(match[1].trim());
  }
  const base = 'beings://desktop/' + path.relative(publicRoot, file).split(path.sep).join('/');
  for (const ref of refs) {
    const url = new URL(ref, base);
    if (url.protocol !== 'beings:' || !['desktop', 'chat'].includes(url.hostname)) continue;
    const target = url.pathname === '/' ? (url.hostname === 'chat' ? 'loom.html' : 'index.html') : decodeURIComponent(url.pathname.slice(1));
    if (!fs.statSync(path.join(publicRoot, target), { throwIfNoEntry: false })?.isFile()) throw new Error('Broken packaged link: ' + file + ' -> ' + ref);
    links++;
  }
}
console.log(`Verified ${expected.size} packaged files and ${links} local resource links.`);

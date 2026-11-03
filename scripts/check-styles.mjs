import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileAsync } from 'sass';
import postcss from 'postcss';

export const styleEntries = [
  'desktop/renderer/app/styles.scss',
  'desktop/renderer/chat/document.scss',
  'desktop/renderer/plugins/dsh/styles.scss',
  'web/styles.scss',
  'web/chat.scss',
];

export function duplicateRules(css) {
  const seen = new Map();
  const duplicates = [];
  postcss.parse(css).walkRules(rule => {
    const conditions = [];
    for (let parent = rule.parent; parent?.type !== 'root'; parent = parent.parent) {
      // The same keyframe body is meaningful in different named animations.
      conditions.unshift(`@${parent.name} ${parent.params}`);
    }
    const declarations = rule.nodes.filter(node => node.type === 'decl')
      .map(node => [node.prop, node.value, Boolean(node.important)]);
    if (!declarations.length) return;
    const signature = JSON.stringify([conditions, rule.selector, declarations]);
    if (seen.has(signature)) duplicates.push(rule.selector);
    else seen.set(signature, true);
  });
  return duplicates;
}

async function styleFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const children = await Promise.all(entries.map(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? styleFiles(file) : /\.(css|scss)$/.test(file) ? [file] : [];
  }));
  return children.flat();
}

export async function checkStyles() {
  const files = (await Promise.all(['desktop/renderer', 'web'].map(styleFiles))).flat();
  const problems = [];
  const loaded = new Set();
  for (const file of files) {
    if (file.endsWith('.css')) problems.push(`${file}: use SCSS for owned source styles`);
    const source = await readFile(file, 'utf8');
    if (/^\s*@import\b/m.test(source)) problems.push(`${file}: use @use instead of @import`);
  }
  for (const file of [...styleEntries, ...files.filter(file => file.endsWith('.module.scss'))]) {
    const { css, loadedUrls } = await compileAsync(file, { style: 'expanded' });
    for (const url of loadedUrls) if (url.protocol === 'file:') loaded.add(fileURLToPath(url));
    for (const selector of duplicateRules(css)) problems.push(`${file}: duplicate rule ${selector}`);
  }
  for (const file of files) {
    if (!loaded.has(path.resolve(file))) problems.push(`${file}: not owned by a document entry or component module`);
  }
  if (problems.length) throw new Error(problems.join('\n'));
  console.log(`Styles checked: ${files.length} SCSS files; no CSS sources, legacy imports, orphan files or duplicate rules.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await checkStyles();
}

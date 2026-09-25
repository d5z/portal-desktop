import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const fixture = await build({
  stdin: {
    contents: `
      import React, { useRef, useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { ComposerField } from './desktop/renderer/chat/components/composer-field';
      function App() {
        const editorRef = useRef(null);
        const [value, setValue] = useState('');
        window.composerAudit = { editorRef, setValue };
        return <div id="input-area"><div id="input-row">
          <ComposerField editorRef={editorRef} id="input" value={value} placeholder="说点什么…"
            onChange={setValue} onKeyDown={() => {}} onCompositionStart={() => {}} onCompositionEnd={() => {}} />
        </div></div>;
      }
      createRoot(document.getElementById('root')).render(<App />);
    `,
    resolveDir: process.cwd(),
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const css = await readFile('desktop/renderer/chat/styles.css');
const server = createServer((request, response) => {
  if (request.url === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(fixture.outputFiles[0].contents);
  } else if (request.url === '/fixture.css') {
    response.setHeader('Content-Type', 'text/css');
    response.end(css);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><div class="message"><div class="content" id="sent-headings"><h1>First</h1><h2>Second</h2><h3>Third</h3><ul><li>Bullet</li></ul><ol><li>Number</li></ol></div></div><div class="message"><div class="content" id="sent-nested"><ul><li>first<ul><li>second<ul><li>third</li></ul></li></ul></li></ul></div></div><div class="message"><div class="content" id="sent-ordered"><ol><li>first<ol><li>second<ol><li>third</li></ol></li></ol></li></ol></div></div><script src="/fixture.js"></script>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const input = page.locator('#input .cm-content');
  await input.waitFor();
  await input.fill('# Title\nPlain');
  const state = await page.evaluate(() => {
    const root = document.querySelector('#input');
    const content = root.querySelector('.cm-content');
    const lines = [...root.querySelectorAll('.cm-line')];
    const heading = lines[0];
    const plain = lines[1];
    const headingText = [...heading.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.includes('Title'));
    const range = document.createRange();
    range.selectNodeContents(headingText);
    const headingX = range.getBoundingClientRect().x;
    return {
      headingText: heading.textContent,
      plainText: plain.textContent,
      headingX,
      plainX: plain.getBoundingClientRect().x,
      headingFont: getComputedStyle(heading).fontSize,
      plainFont: getComputedStyle(plain).fontSize,
      textColor: getComputedStyle(heading).color,
      plainColor: getComputedStyle(plain).color,
      spellcheck: content.spellcheck,
      textareaCount: root.querySelectorAll('textarea').length,
      editableCount: root.querySelectorAll('[contenteditable="true"]').length,
    };
  });
  assert.equal(state.headingText, 'Title');
  assert.equal(state.plainText, 'Plain');
  assert.ok(Math.abs(state.headingX - state.plainX) < 2, JSON.stringify(state));
  assert.equal(state.headingFont, '22px');
  assert.equal(state.plainFont, '15px');
  assert.equal(state.textColor, state.plainColor);
  assert.equal(state.spellcheck, false);
  assert.equal(state.textareaCount, 0);
  assert.equal(state.editableCount, 1);
  await input.fill('# First\n## Second\n### Third\nPlain');
  const headingStyles = await page.evaluate(() => {
    const read = element => {
      const style = getComputedStyle(element);
      return [style.fontSize, style.fontWeight, style.lineHeight, style.letterSpacing, style.color];
    };
    return {
      editing: [...document.querySelectorAll('#input .cm-line')].slice(0, 3).map(read),
      sent: [...document.querySelectorAll('#sent-headings > h1, #sent-headings > h2, #sent-headings > h3')].map(read),
    };
  });
  assert.deepEqual(headingStyles.editing, headingStyles.sent, 'Editing headings match sent Markdown heading typography');
  await input.fill('  # Indented');
  assert.equal(await input.locator('.cm-line').first().textContent(), 'Indented', 'A heading with allowed leading spaces matches sent Markdown');
  await input.fill('- Bullet\n1. Number');
  const listStyles = await page.evaluate(() => {
    const read = element => {
      const style = getComputedStyle(element);
      return [style.fontSize, style.fontWeight, style.color];
    };
    const lines = document.querySelectorAll('#input .cm-line');
    const reference = document.querySelectorAll('#sent-headings li');
    return {
      editing: [...lines].map(read),
      sent: [...reference].map(read),
      bullet: getComputedStyle(document.querySelector('.cm-composer-bullet')).color,
      sentBullet: getComputedStyle(reference[0], '::marker').color,
    };
  });
  assert.deepEqual(listStyles.editing, listStyles.sent, 'List text matches sent-message typography');
  assert.equal(listStyles.bullet, listStyles.sentBullet, 'Bullet marker uses the sent-message color');
  await input.fill('- first\n  - second\n    - third');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['• first', '◦ second', '▪ third'], 'Nested bullets match sent-message marker shapes');
  const compareNestedOffsets = async (sentSelector) => {
    const nestedOffsets = await page.evaluate((sentSelector) => {
    const xOf = (element, word) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const offset = node.textContent.indexOf(word);
        if (offset < 0) continue;
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + word.length);
        return range.getBoundingClientRect().x;
      }
      throw new Error(`Missing ${word}`);
    };
    const words = ['first', 'second', 'third'];
    const editing = [...document.querySelectorAll('#input .cm-line')].map((line, i) => xOf(line, words[i]));
    const sent = [...document.querySelectorAll(`${sentSelector} li`)].map((line, i) => xOf(line, words[i]));
    return { editing: editing.map(x => x - document.querySelector('#input .cm-line').getBoundingClientRect().x), sent: sent.map(x => x - document.querySelector(sentSelector).getBoundingClientRect().x) };
    }, sentSelector);
    nestedOffsets.editing.forEach((x, i) => assert.ok(Math.abs(x - nestedOffsets.sent[i]) < 2, JSON.stringify(nestedOffsets)));
  };
  await input.fill('- first\n     - second\n          - third');
  await compareNestedOffsets('#sent-nested');
  await input.fill('- first\n  - second\n    - third');
  await compareNestedOffsets('#sent-nested');
  await input.fill('- first\n\n  - second\n    - third\n      - fourth');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['• first', '', '◦ second', '▪ third', '▪ fourth'], 'Blank lines preserve nesting and the third marker repeats at deeper levels');
  await input.fill('1. first\n     1. second\n          1. third');
  await compareNestedOffsets('#sent-ordered');
  await input.fill('  - Bullet');
  const rootOffset = await page.evaluate(() => {
    const line = document.querySelector('#input .cm-line');
    const text = [...line.childNodes].find(node => node.textContent?.includes('Bullet'));
    const range = document.createRange();
    const offset = text.textContent.indexOf('Bullet');
    range.setStart(text, offset);
    range.setEnd(text, offset + 'Bullet'.length);
    return range.getBoundingClientRect().x - line.getBoundingClientRect().x;
  });
  assert.ok(Math.abs(rootOffset - 22) < 2, `Root list with leading spaces starts at ${rootOffset}px`);
  const source = () => page.evaluate(() => window.composerAudit.editorRef.current.state.doc.toString());
  await input.fill('1) Number');
  assert.equal(await input.locator('.cm-line').first().textContent(), '1. Number', 'A parenthesized list marker displays like the sent decimal list');
  assert.equal(await source(), '1) Number', 'List marker display keeps its original source');
  await input.fill('1) a\n2) b\n3) c');
  await page.evaluate(() => {
    const view = window.composerAudit.editorRef.current;
    view.dispatch({ selection: { anchor: view.state.doc.line(2).from + 2 } });
  });
  await input.press('Backspace');
  assert.equal(await source(), '1) a\n2 b\n2) c', 'Deleting a parenthesized marker immediately renumbers the next item');
  await input.press('ControlOrMeta+z');
  assert.equal(await source(), '1) a\n2) b\n3) c', 'Undo restores the parenthesized marker and sequence together');
  await input.fill('');
  await input.press('#');
  await input.press('Space');
  await input.press('a');
  assert.equal(await source(), '# a');
  assert.equal(await input.locator('.cm-line').first().textContent(), 'a');
  const firstLine = await input.locator('.cm-line').first().boundingBox();
  await page.mouse.click(firstLine.x + 1, firstLine.y + firstLine.height / 2);
  await input.press('X');
  assert.equal(await source(), '# Xa', 'Clicking the visible title start inserts after the hidden marker');
  await input.press('ControlOrMeta+z');
  assert.equal(await source(), '# a', 'Undo retains the heading source');
  await input.fill('```js\n# literal\n- literal\n```\n### heading\n#### literal');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), [
    '```js', '# literal', '- literal', '```', 'heading', '#### literal',
  ]);
  await input.fill('# ');
  const client = await page.context().newCDPSession(page);
  await client.send('Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1 });
  assert.equal(await input.locator('.cm-line').first().textContent(), '中', 'Composition keeps the heading prefix hidden');
  await client.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
  await client.send('Input.insertText', { text: '中文' });
  assert.equal(await source(), '# 中文');
  await input.fill('draft');
  await page.evaluate(() => window.composerAudit.setValue('restored'));
  await page.waitForFunction(() => window.composerAudit.editorRef.current.state.doc.toString() === 'restored');
  assert.equal(await source(), 'restored');
  await input.press('ControlOrMeta+z');
  assert.equal(await source(), 'restored', 'An external draft restoration should not be an undo step');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await input.fill('# Heading');
  await input.press('ControlOrMeta+a');
  await input.press('ControlOrMeta+c');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '# Heading', 'Copy keeps the Markdown source');
  await input.fill('1. a\n2. b\n3. c');
  await input.press('ControlOrMeta+Home');
  await input.press('Shift+ArrowDown');
  await input.press('Backspace');
  assert.equal(await source(), '1. b\n2. c', 'Deleting the first list item renumbers the survivors');
  await input.fill('1. a\n2. b\n3. c');
  await input.press('ControlOrMeta+Home');
  await input.press('ArrowDown');
  await input.press('Home');
  await input.press('Shift+ArrowDown');
  await input.press('ControlOrMeta+x');
  assert.equal(await source(), '1. a\n2. c', 'Cutting a list item renumbers the survivors');
  await input.fill('1. a\n2. b\n3. c\n4. d');
  await page.evaluate(() => {
    const view = window.composerAudit.editorRef.current;
    view.dispatch({ selection: { anchor: view.state.doc.line(3).from + 2 } });
  });
  await input.press('Backspace');
  assert.equal(await source(), '1. a\n2. b\n3 c\n3. d', 'Deleting only the list dot renumbers the following item immediately');
  await input.press('ControlOrMeta+z');
  assert.equal(await source(), '1. a\n2. b\n3. c\n4. d', 'Undo restores the marker and later number together');
  await input.press('ControlOrMeta+Shift+z');
  await input.press('Period');
  assert.equal(await source(), '1. a\n2. b\n3. c\n4. d', 'Retyping the dot restores the following number');
  await input.fill('1. a\n2. b\n3. c\n4. d');
  await page.evaluate(() => {
    const view = window.composerAudit.editorRef.current;
    view.dispatch({ selection: { anchor: view.state.doc.line(3).from + 1 } });
  });
  await input.press('Backspace');
  assert.equal(await source(), '1. a\n2. b\n. c\n3. d', 'Deleting only the list digit renumbers the following item immediately');
  await input.fill('1. a\n2. b\n3. c\n\nplain\n\n7. x\n8. y');
  await page.evaluate(() => {
    const view = window.composerAudit.editorRef.current;
    view.dispatch({ selection: { anchor: view.state.doc.line(3).from + 2 } });
  });
  await input.press('Backspace');
  assert.equal(await source(), '1. a\n2. b\n3 c\n\nplain\n\n7. x\n8. y', 'Deleting a marker does not renumber a separate list');
  await input.fill('```text\n1. a\n2. b\n3. c\n```');
  await page.evaluate(() => {
    const view = window.composerAudit.editorRef.current;
    view.dispatch({ selection: { anchor: view.state.doc.line(3).from + 2 } });
  });
  await input.press('Backspace');
  assert.equal(await source(), '```text\n1. a\n2 b\n3. c\n```', 'Deleting a marker inside a code fence does not renumber');
  await input.fill('1. a\n2. b\n3. c\n4. d');
  await page.evaluate(() => {
    const view = window.composerAudit.editorRef.current;
    view.dispatch({ selection: { anchor: view.state.doc.line(3).to } });
  });
  for (let i = 0; i < '3. c\n'.length; i += 1) await input.press('Backspace');
  assert.equal(await source(), '1. a\n2. b\n3. d', 'Backspacing a numbered item one character at a time renumbers the survivor');
  await input.press('ControlOrMeta+z');
  assert.match(await source(), /\n(?:3\. c\n|\n)4\. d$/, 'Undo restores the deleted boundary and its former number together');
  await input.fill('1. a\n2. b\n3. c\n\nplain\n\n7. x\n8. y');
  await page.evaluate(() => {
    const view = window.composerAudit.editorRef.current;
    view.dispatch({ selection: { anchor: view.state.doc.line(3).to } });
  });
  for (let i = 0; i < '3. c\n'.length; i += 1) await input.press('Backspace');
  assert.equal(await source(), '1. a\n2. b\n\nplain\n\n7. x\n8. y', 'A separate numbered list keeps its starting number');
  await input.fill('```text\n1. a\n2. b\n3. c\n```');
  await page.evaluate(() => {
    const view = window.composerAudit.editorRef.current;
    view.dispatch({ selection: { anchor: view.state.doc.line(3).to } });
  });
  for (let i = 0; i < '2. b\n'.length; i += 1) await input.press('Backspace');
  assert.equal(await source(), '```text\n1. a\n3. c\n```', 'Backspacing inside a code fence does not renumber');
  const perf = await page.evaluate(() => {
    const lines = ['```js', ...Array(10000).fill('const answer = calculate(value);'), '```'];
    const large = lines.join('\n');
    window.composerAudit.setValue(large);
    return large.length;
  });
  await page.waitForFunction(length => window.composerAudit.editorRef.current.state.doc.length === length, perf);
  const editTime = await page.evaluate(() => {
    const view = window.composerAudit.editorRef.current;
    const start = performance.now();
    view.dispatch({ changes: { from: view.state.doc.length, insert: 'x' } });
    return performance.now() - start;
  });
  assert.equal((await source()).endsWith('```x'), true);
  assert.deepEqual(errors, []);
  console.log('Composer browser audit passed:', { ...state, tenThousandLineEditMs: Math.round(editTime) });
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

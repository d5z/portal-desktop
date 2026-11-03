import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { build as viteBuild } from 'vite';
import { build } from '../scripts/renderer-build.mjs';
import { checkStyles, duplicateRules } from '../scripts/check-styles.mjs';

describe('renderer SCSS modules', () => {
  it('compiles every document entry without duplicated rules or retired CSS sources', async () => {
    await checkStyles();
  });

  it('detects repeated rules across partials while retaining conditional and animation variants', () => {
    expect(duplicateRules('.row { display:flex } .other { color:red } .row { display:flex }')).toEqual(['.row']);
    expect(duplicateRules('@media (width < 600px) { .row { display:flex } } @media (width < 600px) { .row { display:flex } }')).toEqual(['.row']);
    expect(duplicateRules(`
      .row { display:flex }
      @media (width < 600px) { .row { display:flex } }
      @supports (display:grid) { .row { display:flex } }
      @keyframes first { to { opacity:1 } }
      @keyframes second { to { opacity:1 } }
    `)).toEqual([]);
  });

  it.each(['esbuild', 'vite'] as const)('keeps classes, keyframes and global CSS together with %s', async engine => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'town-styles-'));
    try {
      await writeFile(path.join(directory, '_mixins.scss'), '@mixin focus { outline: 2px solid var(--accent); }');
      for (const name of ['first', 'second']) {
        await writeFile(path.join(directory, `${name}.module.scss`), `
          @use './mixins';
          .root { color: var(${name === 'first' ? '--text' : '--accent'}); animation: pulse 1s infinite; &:focus-visible { @include mixins.focus; } }
          .root :global(.legacy-child) { display: block; }
          @keyframes pulse { 50% { opacity: ${name === 'first' ? '.5' : '.6'}; } }
        `);
      }
      await writeFile(path.join(directory, 'global.css'), ':root { --accent: blue; --text: black; }');
      const entry = path.join(directory, 'entry.js');
      await writeFile(entry, `
        import './global.css';
        export { default as first } from './first.module.scss';
        export { default as second } from './second.module.scss';
      `);
      let js: string, css: string;
      if (engine === 'esbuild') {
        const result = await build({ entryPoints: [entry], bundle: true, write: false,
          format: 'iife', globalName: 'fixture', minify: true, outfile: path.join(directory, 'out.js') });
        js = result.outputFiles.find(file => file.path.endsWith('.js'))!.text;
        css = result.outputFiles.find(file => file.path.endsWith('.css'))!.text;
      } else {
        const result = await viteBuild({ configFile: false, root: directory, logLevel: 'silent',
          build: { write: false, lib: { entry, name: 'fixture', formats: ['iife'], cssFileName: 'fixture' } } });
        const bundle = Array.isArray(result) ? result[0] : result;
        if (!('output' in bundle)) throw new Error('Expected a Vite bundle');
        const script = bundle.output.find(file => file.type === 'chunk');
        const style = bundle.output.find(file => file.type === 'asset' && file.fileName.endsWith('.css'));
        if (!script || !style || style.type !== 'asset') throw new Error('Missing JS/CSS pair');
        js = script.code;
        css = String(style.source);
      }
      const context: { fixture?: { first: Record<string, string>; second: Record<string, string> } } = {};
      runInNewContext(js, context);
      const { first, second } = context.fixture!;
      expect(first.root).toBeTruthy();
      expect(second.root).not.toBe(first.root);
      for (const styles of [first, second]) {
        expect(css).toContain(`.${styles.root}`);
        expect(css).toContain(`.${styles.root}:focus-visible`);
        expect(css).toContain(`.${styles.root} .legacy-child`);
      }
      expect(css).toContain('--accent:');
      expect(css).toContain('var(--text)');
      expect(css).not.toMatch(/\.root[\s:{]/);
      const animations = [...css.matchAll(/@keyframes\s+([^\s{]+)/g)].map(match => match[1]);
      expect(new Set(animations).size).toBe(2);
      expect(animations).not.toContain('pulse');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

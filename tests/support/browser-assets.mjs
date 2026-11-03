import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
/** Preserve Vite's URL-import semantics in the small esbuild-only UI fixtures. */
export function browserAssets() {
  return { name: 'browser-assets', setup(build) {
    build.onResolve({ filter: /\?url$/ }, args => ({ path: createRequire(args.importer).resolve(args.path.slice(0, -4)), namespace: 'asset-url' }));
    build.onLoad({ filter: /.*/, namespace: 'asset-url' }, async args => ({ contents: `export default ${JSON.stringify('data:text/javascript;base64,' + (await readFile(args.path)).toString('base64'))}`, loader: 'js' }));
    build.onLoad({ filter: /\.(woff2?|ttf)$/ }, async args => ({ contents: await readFile(args.path), loader: 'dataurl' }));
  } };
}

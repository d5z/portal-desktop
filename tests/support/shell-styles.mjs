import { build } from '../../scripts/renderer-build.mjs';
import { fileURLToPath } from 'node:url';

// Raw CSS reads skip shared @imports in fixtures served at synthetic URLs.
export async function readShellStyles() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../../desktop/renderer/app/styles.scss', import.meta.url))],
    bundle: true, write: false, outfile: 'fixture/shell.css',
  });
  return result.outputFiles[0].text;
}

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Raw CSS reads skip shared @imports in fixtures served at synthetic URLs.
export async function readShellStyles() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../../desktop/renderer/app/styles.css', import.meta.url))],
    bundle: true, write: false,
  });
  return result.outputFiles[0].text;
}

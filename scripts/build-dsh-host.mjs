import { rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { writeThirdPartyLicenses } from './third-party-licenses.mjs';
const result = await build({ metafile:true, banner:{js:"const __townModuleURL = require('node:url').pathToFileURL(__filename).href;"}, define:{'import.meta.url':'__townModuleURL'}, entryPoints:['desktop/main/plugins/dsh/worker.ts'], bundle:true, platform:'node', format:'cjs', target:'node24', outfile:'desktop/generated/dsh-plugin-host.cjs' });

await writeThirdPartyLicenses('desktop/generated/DSH-PLUGIN-LICENSES.txt', Object.keys(result.metafile.inputs));
for (const name of ['dsh-client.js', 'dsh-client.css', 'dsh-core.js', 'town-shell.js', 'town-shell.css']) await rm('desktop/generated/' + name, {force:true});

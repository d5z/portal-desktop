import { mkdir, writeFile, copyFile, rm, cp } from "node:fs/promises";
import path from "node:path";
import { build } from "./renderer-build.mjs";
import { writeThirdPartyLicenses } from './third-party-licenses.mjs';

const output = path.resolve("desktop/generated");
await mkdir(output, { recursive: true });
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs',path.join(output,'pdf.worker.min.js'));
await cp('node_modules/pdfjs-dist/cmaps',path.join(output,'pdf-cmaps'),{recursive:true});
await cp('node_modules/pdfjs-dist/standard_fonts',path.join(output,'pdf-fonts'),{recursive:true});
const pptxBuild=await build({entryPoints:['desktop/renderer/preview/pptx-runtime.ts'],bundle:true,format:'iife',platform:'browser',minify:true,metafile:true,outfile:path.join(output,'pptx-preview.js')});
await copyFile('desktop/renderer/preview/pptx-preview.html',path.join(output,'pptx-preview.html'));
// All chat UI is compiled from React; the HTML file is only its document entry.
const chatBuild = await build({
  metafile: true,
  entryPoints: ["desktop/renderer/chat/main.tsx"],
  bundle: true,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
  outfile: path.join(output, "chat.js"),
});
await copyFile("loom.html", path.join(output, "loom.html"));
// Remove the retired DOM adapters from development and packaged public assets.
for (const asset of [
  "loom.css",
  "vendor.js",
  "chat-index.js",
  "chat-activity.js",
  "chat-scene.js",
])
  await rm(path.join(output, asset), { force: true });
await copyFile(
  "node_modules/highlight.js/styles/github-dark.min.css",
  path.join(output, "highlight.css"),
);
await writeThirdPartyLicenses(
  path.join(output, "THIRD-PARTY-LICENSES.txt"),
  [...Object.keys(chatBuild.metafile.inputs), ...Object.keys(pptxBuild.metafile.inputs), 'node_modules/pdfjs-dist/build/pdf.mjs', 'node_modules/exceljs/dist/exceljs.min.js'],
);
console.log("Built React chat assets in desktop/generated.");
await build({
  entryPoints: ["desktop/renderer/chat/client-context.ts"], bundle: true,
  format: "iife", platform: "browser", minify: true,
  outfile: path.join(output, "client-context.js"),
});
await writeFile(path.join(output, "client-context.html"), '<!doctype html><meta charset="utf-8"><script src="client-context.js"></script>');

// Match the chat iframe's top-level site so Chromium uses the same storage key.
await writeFile(path.join(output, "client-context-host.html"), '<!doctype html><meta charset="utf-8"><iframe src="beings://chat/client-context.html"></iframe>');

await copyFile('web/public/iui-runtime.html', path.join(output, 'iui-runtime.html'));

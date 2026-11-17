import { build } from "vite";
import { copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { viteModules, writeThirdPartyLicenses } from "./third-party-licenses.mjs";

let apiBase = process.env.WEB_STATIC_API_BASE || "";
if (apiBase) {
  const url = new URL(apiBase);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "WEB_STATIC_API_BASE must be an HTTPS API gateway URL without credentials.",
    );
  apiBase = url.href.replace(/\/+$/, "");
}
const result = await build({
  configFile: path.resolve("vite.web.config.mjs"),
  build: { outDir: path.resolve("out/web-static") },
});
await writeFile(
  "out/web-static/web-config.json",
  JSON.stringify({ mode: "static", apiBase }, null, 2) + "\n",
);
await copyFile("web/OSS.md", "out/web-static/DEPLOY.md");
await copyFile("LICENSE", "out/web-static/LICENSE");
await copyFile(
  "desktop/renderer/shared/components/react-bits-stack/LICENSE.md",
  "out/web-static/React-Bits-LICENSE.md",
);
await copyFile(
  "desktop/renderer/shared/components/animate-ui.LICENSE.md",
  "out/web-static/Animate-UI-LICENSE.md",
);
await writeThirdPartyLicenses("out/web-static/THIRD-PARTY-LICENSES.txt", viteModules(result));
console.log(
  "Static files ready in out/web-static. Upload its contents to OSS.",
);
if (!apiBase)
  console.log(
    "Town pairing connects directly by default, without a connection precheck.",
  );

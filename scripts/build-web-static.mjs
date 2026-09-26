import { build } from "vite";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
await build({
  configFile: path.resolve("vite.web.config.mjs"),
  build: { outDir: path.resolve("out/web-static") },
});
await writeFile(
  "out/web-static/web-config.json",
  JSON.stringify({ mode: "static", apiBase }, null, 2) + "\n",
);
await copyFile("web/OSS.md", "out/web-static/DEPLOY.md");
await copyFile("LICENSE", "out/web-static/LICENSE");
const notices = [];
for (const [name, file] of [
  ["marked", "LICENSE.md"],
  ["highlight.js", "LICENSE"],
  ["react", "LICENSE"],
  ["react-dom", "LICENSE"],
  ["scheduler", "LICENSE"],
  ["lucide-react", "LICENSE"],
])
  notices.push(
    `${name}\n${await readFile(path.join("node_modules", name, file), "utf8")}`,
  );
await writeFile(
  "out/web-static/THIRD-PARTY-LICENSES.txt",
  notices.join("\n\n---\n\n"),
);
console.log(
  "Static files ready in out/web-static. Upload its contents to OSS.",
);
if (!apiBase)
  console.log(
    "Town pairing connects directly by default, without a connection precheck.",
  );

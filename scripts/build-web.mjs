import { build } from "vite";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

await build({ configFile: path.resolve("vite.web.config.mjs") });
for (const file of ["server.mjs", "proxy.mjs", "README.md", "OSS.md"])
  await copyFile(`web/${file}`, `out/web/${file}`);
await copyFile("LICENSE", "out/web/LICENSE");
const notices = [];
for (const [name, file] of [
  ["marked", "LICENSE.md"],
  ["highlight.js", "LICENSE"],
  ["react", "LICENSE"],
  ["react-dom", "LICENSE"],
  ["scheduler", "LICENSE"],
]) {
  notices.push(
    `${name}\n${await readFile(path.join("node_modules", name, file), "utf8")}`,
  );
}
await writeFile(
  "out/web/THIRD-PARTY-LICENSES.txt",
  notices.join("\n\n---\n\n"),
);
await writeFile(
  "out/web/package.json",
  JSON.stringify(
    {
      name: "beings-town-web",
      private: true,
      type: "module",
      scripts: { start: "node server.mjs" },
      engines: { node: ">=22.12" },
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Standalone web build: out/web (no Electron, Rust or npm install needed to serve).",
);

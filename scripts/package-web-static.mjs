import "./build-web-static.mjs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";

const files = {};
async function collect(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(file, name + "/");
    else if (entry.isFile()) files[name] = await readFile(file);
  }
}
await collect("out/web-static");
await writeFile("out/town-web-oss.zip", zipSync(files, { level: 6 }));
console.log(
  "OSS upload archive: out/town-web-oss.zip (index.html at archive root).",
);

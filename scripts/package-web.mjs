import "./build-web.mjs";
import { create } from "tar";
await create({ gzip: true, file: "out/town-web.tar.gz", cwd: "out" }, ["web"]);
console.log("Standalone deployment archive: out/town-web.tar.gz");

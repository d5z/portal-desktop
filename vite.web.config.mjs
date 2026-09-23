import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { createProxy } from "./web/proxy.mjs";

export default defineConfig({
  root: "web",
  base: './',
  plugins: [
    react(),
    {
      name: "town-web-api",
      configureServer(server) {
        server.middlewares.use(createProxy());
      },
    },
  ],
  server: { host: "127.0.0.1", port: 5174 },
  build: {
    target: "es2022",
    outDir: path.resolve("out/web/public"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve("web/index.html"),
        chat: path.resolve("web/chat.html"),
      },
    },
  },
});

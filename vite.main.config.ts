import { defineConfig } from 'vite';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
let revision = 'local';
try { revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* Source archive. */ }

export default defineConfig(({ command }) => ({
  define: {
    PORTAL_DESKTOP_DEV_ASSETS: JSON.stringify(command === 'serve' ? path.join(__dirname, 'desktop/generated') : null),
    PORTAL_DESKTOP_BUILD: JSON.stringify(`${revision} · ${new Date().toISOString()}`),
    PORTAL_DESKTOP_UPDATE_REPOSITORY: JSON.stringify(process.env.PORTAL_DESKTOP_UPDATE_REPOSITORY || 'd5z/portal-desktop'),
  },
  build: { rollupOptions: { external: ['electron', 'bufferutil', 'utf-8-validate'] } },
}));

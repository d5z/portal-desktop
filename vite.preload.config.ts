import { defineConfig } from 'vite';
import { useDevHome } from './scripts/home-environment.mjs';
export default defineConfig(({ command }) => ({
  define: {
    PORTAL_DESKTOP_HOME_DEV: JSON.stringify(useDevHome(command === 'serve')),
  },
  build: { rollupOptions: { external: ['electron'] } },
}));

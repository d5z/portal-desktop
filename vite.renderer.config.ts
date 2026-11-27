import { defineConfig } from 'vite';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { useDevHome } from './scripts/home-environment.mjs';
export default defineConfig(({ command }) => ({
  define: { PORTAL_DESKTOP_HOME_DEV: JSON.stringify(useDevHome(command === 'serve')) },
  plugins: [react()],
  root: 'desktop/renderer', publicDir: '../generated', base: './',
  build: { outDir: path.resolve('.vite/renderer/main_window') },
}));

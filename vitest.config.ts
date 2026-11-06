import path from 'node:path';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  define: { PORTAL_DESKTOP_DEV_ASSETS: JSON.stringify(path.resolve('desktop/generated')) },
  test: {
    include: ['tests/**/*.test.ts'],
    // Native Windows fixtures share Task Scheduler, CIM and cold PowerShell
    // startup with the other files. Keep them from competing on hosted runners.
    fileParallelism: process.platform !== 'win32',
  },
});

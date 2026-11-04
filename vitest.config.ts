import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'desktop/main/chat/model-profiles.test.ts'],
    // Native Windows fixtures share Task Scheduler, CIM and cold PowerShell
    // startup with the other files. Keep them from competing on hosted runners.
    fileParallelism: process.platform !== 'win32',
  },
});

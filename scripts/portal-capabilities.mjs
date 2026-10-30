import { execFileSync } from 'node:child_process';

export function assertPortalPermissionModes(help) {
  const option = /--permission-mode\b[^\[]*\[possible values:\s*([^\]]+)\]/.exec(help);
  const modes = new Set(option?.[1].split(',').map(value => value.trim()));
  for (const mode of ['read-only', 'supervised', 'auto-review', 'full-access']) {
    if (!modes.has(mode)) throw new Error(`Bundled Portal does not support permission mode '${mode}'. Run npm run build:portal.`);
  }
}

export function checkPortalCapabilities(binary) {
  assertPortalPermissionModes(execFileSync(binary, ['--help'], {
    encoding: 'utf8', timeout: 15000, windowsHide: true,
  }));
}

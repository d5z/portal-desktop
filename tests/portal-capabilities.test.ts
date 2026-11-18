import { expect, it } from 'vitest';
import { assertPortalPermissionModes } from '../scripts/portal-capabilities.mjs';

it('requires both permission modes on the actual permission flag', () => {
  expect(() => assertPortalPermissionModes('--permission-mode <PERMISSION_MODE>\nApplication tool authorization [possible values: full-access]'))
    .toThrow("'supervised'");
  expect(() => assertPortalPermissionModes('--permission-mode <PERMISSION_MODE>\nApplication tool authorization [possible values: supervised]'))
    .toThrow("'full-access'");
  expect(() => assertPortalPermissionModes('--help Print help')).toThrow();
  expect(() => assertPortalPermissionModes('--unrelated [possible values: supervised, full-access]')).toThrow();
});

it('accepts the two client permission modes including wrapped help output', () => {
  expect(() => assertPortalPermissionModes('--permission-mode <PERMISSION_MODE>\nApplication tool authorization [possible values: read-only, supervised,\nfull-access]\n-h, --help Print help'))
    .not.toThrow();
});

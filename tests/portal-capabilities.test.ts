import { expect, it } from 'vitest';
import { assertPortalPermissionModes } from '../scripts/portal-capabilities.mjs';

it('rejects the old bundled engine even when the Portal version has not changed', () => {
  expect(() => assertPortalPermissionModes('--permission-mode <PERMISSION_MODE>\nApplication tool authorization [possible values: read-only, supervised, full-access]'))
    .toThrow("'auto-review'");
  expect(() => assertPortalPermissionModes('--help Print help')).toThrow();
  expect(() => assertPortalPermissionModes('--unrelated [possible values: read-only, supervised, auto-review, full-access]')).toThrow();
});

it('accepts every permission mode required by the client, including wrapped help output', () => {
  expect(() => assertPortalPermissionModes('--permission-mode <PERMISSION_MODE>\nApplication tool authorization [possible values: read-only, supervised,\nauto-review, full-access]\n-h, --help Print help'))
    .not.toThrow();
});

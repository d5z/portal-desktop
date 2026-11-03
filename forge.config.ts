import type { ForgeConfig } from '@electron-forge/shared-types';
import type { OsxSignOptions } from '@electron/packager';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ignoreMacSigningFile } from './scripts/mac-signing';
import signing from './desktop/macos-signing.json';
import { macDmgIdentifier, verifyMacSignature } from './desktop/main/updates/mac-signature';
import pkg from './package.json';

const binary = path.resolve('resources', process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal');
const macLocalTest = process.env.PORTAL_DESKTOP_MAC_LOCAL_TEST === '1';
const macIdentity = macLocalTest ? '-' : signing.identity;
if (process.platform === 'darwin' && macLocalTest && process.env.GITHUB_REF?.startsWith('refs/tags/')) {
  throw new Error('Local-test macOS signatures cannot be published as a release.');
}
// Packager supports continueOnError at runtime but omits it from its public type.
const macSignOptions: OsxSignOptions & { continueOnError: false } = {
  identity: macIdentity,
  continueOnError: false,
  keychain: process.env.PORTAL_DESKTOP_MAC_KEYCHAIN,
  identityValidation: macIdentity !== '-',
  preAutoEntitlements: macIdentity !== '-',
  preEmbedProvisioningProfile: false,
  ignore: ignoreMacSigningFile,
  // Ad-hoc builds have no Team ID, so hardened library validation cannot match
  // Electron's framework to the app. This applies only to local/CI test builds.
  optionsForFile: () => macIdentity === '-' ? { timestamp: 'none', hardenedRuntime: false } : {},
};
const config: ForgeConfig = {
  outDir: process.env.PORTAL_DESKTOP_PACKAGE_OUT || 'out',
  packagerConfig: {
    asar: true,
    // Packager also derives macOS's display name from its executable name.
    executableName: process.platform === 'darwin' ? 'Portal Desktop' : 'portal-desktop',
    appBundleId: signing.clientIdentifier,
    ...(process.platform === 'darwin' ? {
      osxSign: macSignOptions,
      // Match Heart Portal: Developer ID + hardened runtime + timestamp;
      // notarization is deliberately deferred, with no automatic submission.
    } : {}),
    icon: path.resolve('resources/branding/app'),
    extraResource: [binary, path.resolve('resources/HEART-PORTAL-LICENSE'), path.resolve('resources/branding'), path.resolve('resources/runtime-bundle.json'), path.resolve('node_modules/npm')],
  },
  hooks: {
    prePackage: async () => {
      if (!existsSync(binary)) throw new Error('Portal binary missing. Run npm run build:portal first.');
      if (process.platform === 'darwin') execFileSync(process.execPath, ['scripts/sign-macos-runtime.mjs'], { stdio: 'inherit' });
    },
    postPackage: async (_forgeConfig, result) => {
      if (result.platform === 'darwin' && !macLocalTest) {
        for (const output of result.outputPaths) {
          const app = path.join(output, `${pkg.productName}.app`);
          await verifyMacSignature(app, signing.clientIdentifier);
          await verifyMacSignature(path.join(app, 'Contents/Resources/heart-portal'), signing.portalIdentifier);
        }
      }
    },
    postMake: async (_forgeConfig, makeResults) => {
      if (process.platform === 'darwin') {
        for (const dmg of makeResults.flatMap(result => result.artifacts).filter(file => file.endsWith('.dmg'))) {
          execFileSync('/usr/bin/codesign', ['--force', '--sign', macIdentity, '--identifier', macDmgIdentifier,
            ...(macLocalTest ? ['--timestamp=none'] : ['--timestamp']),
            ...(process.env.PORTAL_DESKTOP_MAC_KEYCHAIN ? ['--keychain', process.env.PORTAL_DESKTOP_MAC_KEYCHAIN] : []), dmg], { stdio: 'inherit' });
          if (!macLocalTest) await verifyMacSignature(dmg, macDmgIdentifier);
        }
      }
      return makeResults;
    },
  },
  makers: [
    new MakerZIP({}, ['darwin', 'linux', 'win32']),
    new MakerDMG({ title: 'Portal Desktop', icon: path.resolve('resources/branding/app.icns'), format: 'ULFO' }, ['darwin']),
  ],
  plugins: [new VitePlugin({
    build: [
      { entry: 'desktop/main/main.ts', config: 'vite.main.config.ts', target: 'main' },
      { entry: 'desktop/preload/preload.ts', config: 'vite.preload.config.ts', target: 'preload' },
    ],
    renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
  })],
};
export default config;

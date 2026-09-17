import { build, Platform, Arch } from 'electron-builder';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const identity = JSON.parse(await readFile(new URL('../desktop/windows-installer.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Forge compiles the Vite application; builder wraps that exact packaged app
// with its standard one-click NSIS installer and a portable ZIP.
export async function buildWindowsInstaller(prepackaged, output, version = pkg.version, zip = true) {
  return build({
    targets: Platform.WINDOWS.createTarget(zip ? ['nsis', 'zip'] : ['nsis'], Arch.x64),
    prepackaged: path.resolve(prepackaged), publish: 'never',
    config: {
      appId: identity.appId, productName: pkg.productName,
      electronVersion: pkg.devDependencies.electron,
      extraMetadata: { version },
      directories: { output: path.resolve(output), buildResources: 'resources/branding' },
      artifactName: `portal-desktop-${version}-windows-x64.\${ext}`,
      win: { executableName: identity.executableName, icon: 'resources/branding/app.ico' },
      nsis: {
        installerIcon: 'resources/branding/logo-black.ico',
        guid: identity.guid, oneClick: true, perMachine: false,
        allowElevation: false, allowToChangeInstallationDirectory: false,
        runAfterFinish: true, deleteAppDataOnUninstall: false,
        packElevateHelper: false, shortcutName: pkg.productName,
        artifactName: `portal-desktop-${version}-windows-x64-Setup.exe`,
        include: 'scripts/windows-installer.nsh',
      },
    },
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.env.PORTAL_DESKTOP_PACKAGE_OUT || 'out';
  await buildWindowsInstaller(process.argv[2] || path.join(out, `${pkg.productName}-win32-x64`),
    process.argv[3] || path.join(out, 'make/nsis'));
}

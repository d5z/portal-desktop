# Desktop branding

This directory contains all artwork required for development and packaging.
Commit these files directly. No external artwork folder, generation step or
platform-specific conversion tool is required. To update the branding, replace
the corresponding files here while preserving their formats and size variants.

- `app.ico`: transparent white Windows executable and desktop shortcut icon,
  generated from the same artwork as `logo-white.ico` by `scripts/build-windows-icons.cjs`.
- `logo-black.ico`, `logo-white.ico`: transparent Windows taskbar, installer and notification
  source icons; regenerate with Electron and `scripts/build-windows-icons.cjs`.
- `notification-black*.png`, `notification-white*.png`: padded square toast artwork
  at 1×/2×. The logo occupies 62.5% of the canvas to avoid oversized/clipped strokes.
- `app.icns`: macOS application and DMG icon.
- `app.png`, `app-mac.png`: supplied Windows and macOS PNG artwork.
- `logo.png`, `logo-white.png`: transparent light/dark client branding. The
  Windows native window caption always uses the original black `logo.png`.
- `trayTemplate.png`, `trayTemplate@2x.png`: macOS menu bar template, colored by the OS.
- `tray-black*.png`, `tray-white*.png`: transparent Windows tray artwork at 1×/2×;
  selected using the system taskbar theme, independently of the app theme.

Windows reads `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`
`SystemUsesLightTheme` for both the tray and running taskbar icons. Electron 44's
system-integrated theme value follows the app theme on some systems. Refresh on
native theme updates and `WM_SETTINGCHANGE`, including shell-only theme changes.

Windows windows keep their black caption icon independent of the shell theme.
`desktop/main/app/taskbar-icons.ts` updates only `WM_SETICON / ICON_BIG` for
running windows, selecting white on a dark taskbar and black on a light taskbar.
One hidden PowerShell worker retains the DPI-sized native icon handles for the
application lifetime; `ICON_SMALL` remains unchanged. Do not use Electron's
`setIcon` for theme changes because it replaces both icons.
Run `npm run test:taskbar-icons` on Windows to inspect the native icon colors and
verify that theme changes preserve the caption icon, including newly opened windows.
Do not override their AppUserModelID or relaunch properties with
`setAppDetails`; notification branding must not change the window icon lifecycle.
Notifications use padded variants of the same transparent logo and the shell theme.
The current installation's notification shortcut also uses the matching ICO.
On reinstall, NSIS repairs existing Start Menu and desktop shortcut targets and
icon locations, including links left pointing at an old test build. It preserves
the absence of shortcuts the user removed. The desktop uses the white `app.ico`;
the Start Menu shortcut uses the ICO selected by the taskbar theme.
The NSIS installer updates its running taskbar icon when the shell theme changes;
its light content and caption surfaces retain the black logo for contrast.
Development notification IDs use `.development` so
Electron's automatically created shortcut cannot replace the installed app's name.

The existing Forge and Windows installer configurations package `app.icns` and
`app.ico`, plus this directory. Keep the `@2x` files beside their base images so
Electron can load the high-resolution representation.

On macOS, the packaged application/Dock and DMG use `app.icns`. The menu bar uses
the transparent 18 pt `trayTemplate.png` and its 2× Retina representation, marked
as a template image so macOS chooses its color for the menu bar background.
Client startup/welcome branding follows the client's light/dark appearance.

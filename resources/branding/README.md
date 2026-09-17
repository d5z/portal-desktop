# Desktop branding

This directory contains all artwork required for development and packaging.
Commit these files directly. No external artwork folder, generation step or
platform-specific conversion tool is required. To update the branding, replace
the corresponding files here while preserving their formats and size variants.

- `app.ico`: Windows application, installer and shortcuts.
- `app.icns`: macOS application and DMG icon.
- `app.png`, `app-mac.png`: supplied Windows and macOS PNG artwork.
- `logo.png`, `logo-white.png`: transparent light/dark client branding. Windows
  running taskbar buttons also use these, chosen by the system taskbar theme.
- `trayTemplate.png`, `trayTemplate@2x.png`: macOS menu bar template, colored by the OS.
- `tray-black*.png`, `tray-white*.png`: transparent Windows tray artwork at 1×/2×;
  selected using the system taskbar theme, independently of the app theme.

Windows reads `HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`
`SystemUsesLightTheme` for both the tray and running taskbar icons. Electron 44's
system-integrated theme value follows the app theme on some systems. Refresh on
native theme updates and `WM_SETTINGCHANGE`, including shell-only theme changes.

The existing Forge and Windows installer configurations package `app.icns` and
`app.ico`, plus this directory. Keep the `@2x` files beside their base images so
Electron can load the high-resolution representation.

On macOS, the packaged application/Dock and DMG use `app.icns`. The menu bar uses
the transparent 18 pt `trayTemplate.png` and its 2× Retina representation, marked
as a template image so macOS chooses its color for the menu bar background.
Client startup/welcome branding follows the client's light/dark appearance.

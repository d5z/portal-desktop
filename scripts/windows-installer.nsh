; Keep the standard one-click progress UI. Ask the running client to journal
; and stop its Portal before NSIS replaces files; never forcibly kill Portal.
!ifndef BUILD_UNINSTALLER
  !include "${PROJECT_DIR}\scripts\windows-installer-theme.nsh"
  !macro customHeader
    !include "${PROJECT_DIR}\scripts\windows-start-app.nsh"
  !macroend
  !macro customCheckAppRunning
    InitPluginsDir
    File /oname=$PLUGINSDIR\prepare-client.ps1 "${PROJECT_DIR}\scripts\windows-prepare-install.ps1"
    nsExec::ExecToStack /TIMEOUT=150000 '"$PowerShellPath" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\prepare-client.ps1" -Executable "$INSTDIR\${APP_EXECUTABLE_FILENAME}" -Version "${VERSION}"'
    Pop $0
    Pop $1
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "Portal Desktop could not stop safely. Close the client and retry installation.$\r$\n$1"
      SetErrorLevel 1
      Quit
    ${EndIf}
  !macroend
  !macro customInstall
    ; Upgrades preserve shortcuts, including ones redirected to an old test build.
    ; Repair existing links without recreating shortcuts the user removed.
    ${If} ${FileExists} "$newStartMenuLink"
      ReadRegDWORD $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Themes\Personalize" "SystemUsesLightTheme"
      StrCpy $1 "$INSTDIR\resources\branding\logo-white.ico"
      ${If} $0 == 1
        StrCpy $1 "$INSTDIR\resources\branding\logo-black.ico"
      ${EndIf}
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$1" 0 "" "" "${APP_DESCRIPTION}"
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${EndIf}
    ${If} ${FileExists} "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$INSTDIR\resources\branding\app.ico" 0 "" "" "${APP_DESCRIPTION}"
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${EndIf}
    System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, p 0, p 0)'
  !macroend
!endif

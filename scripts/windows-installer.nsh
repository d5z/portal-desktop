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
!endif

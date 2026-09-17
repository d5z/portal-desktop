!include "nsDialogs.nsh"
!define MUI_CUSTOMFUNCTION_GUIINIT PortalInstallerGuiInit
Var PortalInstallerTheme
Var PortalWhiteIcon
Var PortalBlackIcon
Var PortalWhiteSmallIcon
Var PortalBlackSmallIcon

Function PortalApplyInstallerTheme
  Push $0
  Push $1
  Push $2
  ReadRegDWORD $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Themes\Personalize" "SystemUsesLightTheme"
  ${If} $0 != 1
    StrCpy $0 0
  ${EndIf}
  ${If} $0 != $PortalInstallerTheme
    StrCpy $PortalInstallerTheme $0
    ${If} $0 == 1
      StrCpy $1 $PortalBlackIcon
      StrCpy $2 $PortalBlackSmallIcon
    ${Else}
      StrCpy $1 $PortalWhiteIcon
      StrCpy $2 $PortalWhiteSmallIcon
    ${EndIf}
    SendMessage $HWNDPARENT ${WM_SETICON} 1 $1
    ; NSIS uses a light caption/content surface; only the taskbar uses the shell theme.
    SendMessage $HWNDPARENT ${WM_SETICON} 0 $PortalBlackSmallIcon
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function PortalInstallerGuiInit
  Push $0
  Push $1
  InitPluginsDir
  File /oname=$PLUGINSDIR\portal-white.ico "${PROJECT_DIR}\resources\branding\logo-white.ico"
  File /oname=$PLUGINSDIR\portal-black.ico "${PROJECT_DIR}\resources\branding\logo-black.ico"
  System::Call 'user32::GetSystemMetrics(i 11) i.r0'
  System::Call 'user32::GetSystemMetrics(i 49) i.r1'
  System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\portal-white.ico", i 1, i r0, i r0, i 0x10) p.s'
  Pop $PortalWhiteIcon
  System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\portal-black.ico", i 1, i r0, i r0, i 0x10) p.s'
  Pop $PortalBlackIcon
  System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\portal-white.ico", i 1, i r1, i r1, i 0x10) p.s'
  Pop $PortalWhiteSmallIcon
  System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\portal-black.ico", i 1, i r1, i r1, i 0x10) p.s'
  Pop $PortalBlackSmallIcon
  StrCpy $PortalInstallerTheme -1
  Call PortalApplyInstallerTheme
  ; The standard NSIS content area is light regardless of the taskbar theme.
  GetDlgItem $0 $HWNDPARENT 1039
  SendMessage $0 ${STM_SETICON} $PortalBlackIcon 0
  ${NSD_CreateTimer} PortalApplyInstallerTheme 750
  Pop $1
  Pop $0
FunctionEnd

Function .onGUIEnd
  ${NSD_KillTimer} PortalApplyInstallerTheme
  System::Call 'user32::DestroyIcon(p $PortalWhiteIcon)'
  System::Call 'user32::DestroyIcon(p $PortalBlackIcon)'
  System::Call 'user32::DestroyIcon(p $PortalWhiteSmallIcon)'
  System::Call 'user32::DestroyIcon(p $PortalBlackSmallIcon)'
FunctionEnd

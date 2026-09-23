import assert from 'node:assert/strict';
import { powershell } from './windows-installation.mjs';

// createMainWindow uses the standard Windows title bar. Chromium tooltips also
// use Chrome_WidgetWin_1, but do not have WS_CAPTION (0x00c00000).
export function isClientMainWindow(window) {
  const WS_CAPTION = 0x00c00000;
  return window.visible && window.className === 'Chrome_WidgetWin_1' &&
    (window.style & WS_CAPTION) === WS_CAPTION;
}

export async function assertSingleClientWindow(pid) {
  const windows = await clientWindowSnapshot(pid);
  assert.equal(windows.filter(isClientMainWindow).length, 1,
    `Client ${pid} must own exactly one visible main window. Native windows: ${JSON.stringify(windows)}`);
}

export async function clientWindowSnapshot(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid client PID.');
  return JSON.parse(await powershell(`
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class PortalTestWindows {
  delegate bool Visitor(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(Visitor visitor, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] static extern uint GetWindowLong(IntPtr window, int index);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int length);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
  public static object[] Snapshot(uint process) {
    var windows = new List<object>();
    EnumWindows((window, data) => {
      uint owner; GetWindowThreadProcessId(window, out owner);
      if (owner != process) return true;
      var name = new StringBuilder(256); GetClassName(window, name, name.Capacity);
      var title = new StringBuilder(1024); GetWindowText(window, title, title.Capacity);
      windows.Add(new {
        handle = window.ToInt64(), owner = GetWindow(window, 4).ToInt64(),
        className = name.ToString(), title = title.ToString(), visible = IsWindowVisible(window),
        style = GetWindowLong(window, -16), extendedStyle = GetWindowLong(window, -20)
      });
      return true;
    }, IntPtr.Zero);
    return windows.ToArray();
  }
}
'@
ConvertTo-Json -InputObject @([PortalTestWindows]::Snapshot(${pid})) -Compress
  `));
}

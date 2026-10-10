import { app, BrowserWindow, screen } from 'electron';
import { spawn } from 'node:child_process';
import { brandingPath } from './branding';
import { refreshSystemTheme, watchSystemTheme } from './system-theme';
import { windowsEnvironment, windowsExecutable } from '../portal/windows';

// Keep the HICONs alive in one hidden worker. Electron's setIcon also replaces
// ICON_SMALL, making a white taskbar logo disappear on a light window caption.
export const taskbarIconScript = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class PortalTaskbarIcons {
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr LoadImage(IntPtr instance, string name, uint type, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr icon);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] static extern int GetSystemMetricsForDpi(int index, uint dpi);
  [DllImport("user32.dll", SetLastError=true)]
  static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr kind, IntPtr value, uint flags, uint timeout, out IntPtr result);
  static readonly Dictionary<string,IntPtr> icons = new Dictionary<string,IntPtr>();
  static readonly Dictionary<IntPtr,IntPtr> originals = new Dictionary<IntPtr,IntPtr>();
  static readonly Dictionary<IntPtr,IntPtr> applied = new Dictionary<IntPtr,IntPtr>();
  static bool Owned(IntPtr window, uint process) {
    uint owner; return GetWindowThreadProcessId(window, out owner) != 0 && owner == process;
  }
  public static string Apply(long handle, uint process, string file) {
    var window = new IntPtr(handle);
    if (!Owned(window, process)) return "closed";
    int size = GetSystemMetricsForDpi(11, GetDpiForWindow(window));
    string key = file + "|" + size;
    IntPtr icon;
    if (!icons.TryGetValue(key, out icon)) {
      icon = LoadImage(IntPtr.Zero, file, 1, size, size, 0x10);
      if (icon == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      icons.Add(key, icon);
    }
    IntPtr previous;
    if (SendMessageTimeout(window, 0x80, new IntPtr(1), icon, 2, 1000, out previous) == IntPtr.Zero)
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    if (!originals.ContainsKey(window)) originals.Add(window, previous);
    applied[window] = icon;
    return "applied";
  }
  public static void Restore(long handle, uint process) {
    var window = new IntPtr(handle);
    IntPtr original, current, ignored;
    if (originals.TryGetValue(window, out original) && Owned(window, process) &&
        SendMessageTimeout(window, 0x7f, new IntPtr(1), IntPtr.Zero, 2, 1000, out current) != IntPtr.Zero &&
        current == applied[window])
      SendMessageTimeout(window, 0x80, new IntPtr(1), original, 2, 1000, out ignored);
    originals.Remove(window); applied.Remove(window);
  }
  public static void Close(uint process) {
    foreach (var window in new List<IntPtr>(originals.Keys)) Restore(window.ToInt64(), process);
    foreach (var icon in icons.Values) DestroyIcon(icon);
    icons.Clear();
  }
}
'@
$ownerProcess=0
try {
  while ($null -ne ($line=[Console]::ReadLine())) {
    try {
      $request=$line | ConvertFrom-Json
      $ownerProcess=[uint32]$request.process
      if ($request.remove) {
        [PortalTaskbarIcons]::Restore([long]$request.remove, $ownerProcess)
      } else {
        foreach ($window in $request.windows) {
          [void][PortalTaskbarIcons]::Apply([long]$window, $ownerProcess, [string]$request.icon)
        }
      }
      [Console]::Out.WriteLine('ok')
    } catch { [Console]::Error.WriteLine($_.Exception.Message) }
  }
} finally { [PortalTaskbarIcons]::Close($ownerProcess) }
`;

export function installWindowsTaskbarIcons(report: (error: Error) => void, watchTheme = watchSystemTheme) {
  if (process.platform !== 'win32') return;
  const worker = spawn(windowsExecutable('powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(taskbarIconScript, 'utf16le').toString('base64'),
  ], { windowsHide: true, env: windowsEnvironment(process.env), stdio: ['pipe', 'pipe', 'pipe'] });
  let stopped = false, dark = true, timer: ReturnType<typeof setTimeout> | undefined;
  const windows = new Map<BrowserWindow, string>();
  const write = (data: object) => {
    if (!stopped && !worker.stdin.destroyed) worker.stdin.write(JSON.stringify({ process: process.pid, ...data }) + '\n');
  };
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => write({ windows: [...windows.values()], icon: brandingPath(dark ? 'logo-white.ico' : 'logo-black.ico') }), 75);
  };
  const track = (_event: unknown, window: BrowserWindow) => {
    const handle = window.getNativeWindowHandle();
    const id = (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString();
    windows.set(window, id);
    window.hookWindowMessage(0x001a, refreshSystemTheme);
    window.on('show', refresh);
    window.once('closed', () => { windows.delete(window); write({ remove: id }); });
    refresh();
  };
  worker.stdout.resume();
  worker.stderr.on('data', data => report(new Error(String(data).trim())));
  worker.on('error', report);
  worker.stdin.on('error', error => { if (!stopped) report(error); });
  worker.once('exit', code => { if (!stopped) report(new Error(`Taskbar icon worker exited (${code})`)); stopped = true; });
  const stopTheme = watchTheme(value => { dark = value; refresh(); });
  app.on('browser-window-created', track);
  screen.on('display-metrics-changed', refresh);
  for (const window of BrowserWindow.getAllWindows()) track(undefined, window);
  app.once('will-quit', () => {
    stopped = true; clearTimeout(timer); stopTheme();
    app.removeListener('browser-window-created', track);
    screen.removeListener('display-metrics-changed', refresh);
    worker.stdin.end();
  });
}

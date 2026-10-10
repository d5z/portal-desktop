// Inspect actual Windows HICONs without changing the user's system theme.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { launchDesktop } from './support/electron-lifecycle.mjs';

if (process.platform !== 'win32') {
  console.log('SKIP: native Windows taskbar icons');
  process.exit(0);
}
const root = await mkdtemp(path.join(os.tmpdir(), 'portal-taskbar-'));
const entry = path.join(root, 'main.cjs');
await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
  import {app,BrowserWindow} from 'electron';
  import {installWindowsTaskbarIcons} from './desktop/main/app/taskbar-icons';
  import {brandingPath} from './desktop/main/app/branding';
  app.setPath('userData', ${JSON.stringify(path.join(root, 'profile'))});
  app.setAppPath(${JSON.stringify(process.cwd())});
  app.whenReady().then(() => {
    globalThis.iconErrors=[];
    installWindowsTaskbarIcons(error=>globalThis.iconErrors.push(error.message), apply=>{
      globalThis.setIconTheme=apply; apply(true); return ()=>{};
    });
    globalThis.addIconWindow=()=>{
      const window=new BrowserWindow({show:false,icon:brandingPath('logo.png')});
      window.loadURL('data:text/html,<title>Icon fixture</title>');
      return window;
    };
    globalThis.addIconWindow();
  });
` }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: entry });

async function inspect(handles) {
  const script = String.raw`
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class IconProbe {
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
'@
$items=@(${handles.join(',')}) | ForEach-Object {
  $large=[IconProbe]::SendMessage([IntPtr][long]$_,0x7f,[IntPtr]1,[IntPtr]0)
  $small=[IconProbe]::SendMessage([IntPtr][long]$_,0x7f,[IntPtr]0,[IntPtr]0)
  if ($large -eq [IntPtr]::Zero) { throw 'Missing taskbar icon' }
  $bitmap=[Drawing.Icon]::FromHandle($large).ToBitmap()
  $total=0L; $count=0
  try {
    for($y=0;$y -lt $bitmap.Height;$y++) {
      for($x=0;$x -lt $bitmap.Width;$x++) {
        $color=$bitmap.GetPixel($x,$y)
        if($color.A -gt 128){$total+=$color.R+$color.G+$color.B;$count++}
      }
    }
    @{window=[string]$_;large=$large.ToString();small=$small.ToString();brightness=$total/[Math]::Max(1,3*$count);size=$bitmap.Width}
  } finally {$bitmap.Dispose()}
}
ConvertTo-Json -InputObject @($items) -Compress
`;
  const {stdout} = await promisify(execFile)(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')], {windowsHide:true,timeout:20000});
  return JSON.parse(stdout.trim());
}
let application;
try {
  const require = createRequire(import.meta.url);
  application = await launchDesktop({executablePath:require('electron'),args:[entry],env:{...process.env,PORTAL_DESKTOP_USER_DATA:path.join(root,'profile')}});
  const handles = () => application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().map(window => window.getNativeWindowHandle().readBigUInt64LE().toString()));
  const waitForTheme = async dark => {
    const deadline=Date.now()+20000;
    while(Date.now()<deadline) {
      assert.deepEqual(await application.evaluate(()=>globalThis.iconErrors),[]);
      const icons=await inspect(await handles());
      if(icons.every(icon=>dark ? icon.brightness>220 : icon.brightness<40)) return icons;
    }
    throw new Error('Taskbar icon did not follow the theme');
  };
  const white=await waitForTheme(true);
  assert.notEqual(white[0].small,'0');
  await application.evaluate(()=>globalThis.setIconTheme(false));
  const black=await waitForTheme(false);
  assert.equal(black[0].small,white[0].small,'Theme must not replace the caption icon');
  assert.notEqual(black[0].large,white[0].large);
  await application.evaluate(()=>{globalThis.addIconWindow();globalThis.setIconTheme(true);});
  const multiple=await waitForTheme(true);
  assert.equal(multiple.length,2);
  const first=multiple.find(icon=>icon.window===white[0].window);
  assert.equal(first.small,white[0].small);
  assert.equal(first.large,white[0].large,'Reuse the live native icon handle');
  console.log('PASS: native black/white taskbar icons, unchanged caption, new windows and persistent icon handles.');
} finally {
  await application?.close();
  assert.equal(path.dirname(root),path.resolve(os.tmpdir()));
  await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:250});
}

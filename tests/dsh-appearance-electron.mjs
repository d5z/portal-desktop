import { build } from 'esbuild';
import { build as buildRenderer } from 'vite';
import electron from 'electron';
import { launchDesktop } from './support/electron-lifecycle.mjs';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const root = process.cwd(), output = path.resolve('output/dsh-appearance');
await mkdir(output, {recursive:true});
const reused = process.env.DSH_THEME_TEST_BUILD;
const temp = reused || await mkdtemp(path.join(os.tmpdir(), 'town-dsh-appearance-'));
const profile = process.env.DSH_THEME_TEST_PROFILE || path.join(temp, 'profile');
const assets = path.join(temp, 'renderer');
if (!reused) {
  if (!process.env.DSH_THEME_PLUGIN_DIR) throw new Error('Set DSH_THEME_PLUGIN_DIR to the unmodified dsh-vscode-themes2 package directory.');
  await mkdir(path.join(temp, 'build'), {recursive:true});
  await buildRenderer({configFile:path.join(root,'vite.renderer.config.ts'),logLevel:'warn',build:{outDir:assets}});
  await build({entryPoints:['desktop/main/main.ts'],outfile:path.join(temp,'build/main.js'),bundle:true,platform:'node',format:'cjs',external:['electron'],loader:{'.py':'text','.ps1':'text'},plugins:[{name:'isolated-assets',setup(b){b.onLoad({filter:/main\/main\.ts$/},async args=>({loader:'ts',contents:(await readFile(args.path,'utf8')).replace("path.resolve('desktop/generated')",JSON.stringify(assets))}));}}],define:{MAIN_WINDOW_VITE_DEV_SERVER_URL:'""',MAIN_WINDOW_VITE_NAME:'"main_window"',PORTAL_DESKTOP_BUILD:'"theme-test"',PORTAL_DESKTOP_UPDATE_REPOSITORY:'"fixture/repo"'}});
  await build({entryPoints:['desktop/preload/preload.ts'],outfile:path.join(temp,'build/preload.js'),bundle:true,platform:'node',format:'cjs',external:['electron']});
}
await writeFile(path.join(output,'profile.json'), JSON.stringify({temp,profile},null,2));
const app = await launchDesktop({executablePath:electron,args:[path.join(temp,'build/main.js')],cwd:root,env:{...process.env,PORTAL_DESKTOP_USER_DATA:profile,PORTAL_DESKTOP_TEST_MOCK_KEYCHAIN:'1'}});
const page = await app.firstWindow();
page.setDefaultTimeout(15000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const settings = async () => {
  await page.locator('#options-trigger').click();await page.locator('#client-settings-button').click();
};
const manager = async () => { await settings();await page.getByRole('tab',{name:'插件',exact:true}).click();await page.getByRole('tab',{name:'DeepSeek Harness 插件',exact:true}).click(); };
const themes = async () => { await manager();await page.getByRole('button',{name:'配置 dsh-vscode-themes2',exact:true}).click(); };
const closeManager = async () => { await page.waitForFunction(()=>!document.querySelector('#third-party-plugins')?.hasAttribute('aria-busy')); await page.getByRole('button',{name:'关闭客户端设置',exact:true}).click(); await page.locator('#client-settings-dialog').waitFor({state:'hidden'}); };
const appearance = async () => { await settings();await page.getByRole('tab',{name:'外观与阅读',exact:true}).click(); };
const palette = () => page.evaluate(() => {
  const body=getComputedStyle(document.body), rail=getComputedStyle(document.querySelector('.workspace-rail'));
  const keys=['--bg','--surface','--control','--text','--secondary','--selected','--line'];
  return {scheme:document.documentElement.dataset.theme,dsDark:document.body.hasAttribute('data-ds-dark-theme'),colorScheme:getComputedStyle(document.documentElement).colorScheme,
    rail:rail.backgroundColor,tokens:Object.fromEntries(keys.map(k=>[k,body.getPropertyValue(k).trim()]))};
});
try {
  await page.locator('#client-main').waitFor();
  if (!reused) {
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
    await manager();await page.getByRole('navigation',{name:'插件管理导航'}).getByRole('button',{name:'安装插件',exact:true}).click();await page.locator('#dsh-source').fill(process.env.DSH_THEME_PLUGIN_DIR);
    await page.getByRole('button',{name:'安装',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('#third-party-plugins').hasAttribute('aria-busy'),null,{timeout:90000});
    await closeManager();
  }
  for (const [name,scheme,sidebar,control] of [['Dracula','dark','rgb(33, 34, 44)','rgb(40, 42, 54)'],['GitHub Light','light','rgb(246, 248, 250)','rgb(246, 248, 250)']]) {
    await themes();await page.getByText(name,{exact:true}).click();
    await page.waitForFunction(s=>document.documentElement.dataset.theme===s,scheme);
    // Card controls belong to the community plugin; Town does not override private selectors.
    await page.screenshot({path:path.join(output,`${scheme}-plugin.png`)});
    await closeManager();
    await page.evaluate(()=>{const frame=document.querySelector('#chat-frame');frame.src='beings://chat/?name=fixture&revision=theme-fixture';frame.hidden=false;document.querySelector('#welcome').hidden=true;});
    const chat=await (await page.locator('#chat-frame').elementHandle()).contentFrame();
    await chat.waitForFunction(()=>document.documentElement.hasAttribute('data-plugin-theme'));
    await appearance();
    const before=await palette();
    await page.locator('#reading-size').focus();await page.locator('#reading-size').press('End');
    await page.getByText('21 px',{exact:true}).waitFor();
    const after=await palette();
    await page.screenshot({path:path.join(output,`${scheme}-reading-21.png`)});
    console.log('PALETTE',name,JSON.stringify({before,after}));
    assert.deepEqual(after,before,'reading size must not switch scheme or palette');
    assert.equal(after.scheme,scheme);assert.equal(after.dsDark,scheme==='dark');
    assert.equal(after.colorScheme,scheme);
    assert.equal(await chat.evaluate(()=>document.documentElement.dataset.theme),scheme);
    assert.equal(await chat.evaluate(()=>document.documentElement.style.getPropertyValue('--bg')),after.tokens['--bg']);
    assert.equal(await page.locator('#theme-'+scheme).getAttribute('aria-pressed'),'true');
    assert.equal(after.rail,sidebar,'sidebar must use the chosen theme');
    assert.equal(await page.locator('#client-settings-dialog').evaluate(el=>getComputedStyle(el).backgroundColor),control,'settings must use the chosen theme');
    await page.locator('#reading-size').press('Home');await page.getByText('13 px',{exact:true}).waitFor();
    assert.deepEqual(await palette(),before);
    await page.getByRole('button',{name:'关闭客户端设置',exact:true}).click();
    await page.getByRole('button',{name:'篝火',exact:true}).click();
    assert.deepEqual(await palette(),before,'navigation must not reset the active theme');
    await page.getByRole('button',{name:'对话',exact:true}).click();
    await page.reload();await page.waitForFunction(s=>document.documentElement.dataset.theme===s&&document.body.hasAttribute('data-town-dsh-theme'),scheme);
    assert.deepEqual(await palette(),before,'theme must survive restart');
    console.log('PASS',name,'reading 13/21, selection indicator, navigation, palette surfaces and reload');
  }
  // Return to a built-in palette; clearing the same light scheme must also work.
  await appearance();await page.locator('#theme-light').click();
  await page.waitForFunction(()=>!document.body.hasAttribute('data-town-dsh-theme'));
  await page.evaluate(()=>{const frame=document.querySelector('#chat-frame');frame.src='beings://chat/?name=fixture&revision=theme-fixture-reset';frame.hidden=false;document.querySelector('#welcome').hidden=true;});
  const resetChat=await (await page.locator('#chat-frame').elementHandle()).contentFrame();
  // A new chat frame initially restores its cached palette; wait for the shell's
  // appearance response to clear that palette, not just the already-light scheme.
  await resetChat.waitForFunction(()=>document.documentElement.dataset.theme==='light' && !document.documentElement.hasAttribute('data-plugin-theme'));
  assert.equal(await resetChat.evaluate(()=>document.documentElement.style.getPropertyValue('--bg')),'');
  await page.getByRole('button',{name:'恢复默认',exact:true}).click();
  assert.equal(await page.locator('#reading-size').inputValue(),'16');
  await page.getByRole('button',{name:'关闭客户端设置',exact:true}).click();
  // A plugin may restore its own preference on startup. Disable it to test Town's own persistence.
  await manager();
  await page.getByRole('button',{name:'配置 dsh-vscode-themes2',exact:true}).click();await page.getByRole('button',{name:'停用',exact:true}).click();
  await closeManager();
  await page.reload();await appearance();
  assert.equal(await page.evaluate(()=>document.body.hasAttribute('data-town-dsh-theme')),false);
  assert.equal(await page.locator('#theme-light').getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'关闭客户端设置',exact:true}).click();
  await manager();
  await page.getByRole('button',{name:'配置 dsh-vscode-themes2',exact:true}).click();await page.getByRole('button',{name:'启用',exact:true}).click();
  await closeManager();
  await themes();await page.getByText('Dracula',{exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await closeManager();
  assert.deepEqual(errors,[]);
  console.log('PASS explicit built-in theme selection clears plugin palette and persists without plugin overrides; re-enabled plugin can select its theme');
} catch(error) { console.log('PAGE_ERRORS',errors);console.log('FRAMES',await Promise.all(page.frames().map(f=>f.evaluate(()=>({url:location.href,theme:document.documentElement.dataset.theme,plugin:document.documentElement.hasAttribute('data-plugin-theme'),colors:document.documentElement.style.cssText,body:document.body?.innerText.slice(0,500)})).catch(()=>null))));await page.screenshot({path:path.join(output,reused?'before-failure.png':'failure.png')}).catch(()=>{}); throw error; }
finally { await app.close();console.log('PROFILE',temp); }

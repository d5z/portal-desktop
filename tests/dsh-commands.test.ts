import { Context } from '@deepseek-ai/cordis';
import { expect, it } from 'vitest';
import { LocalCommands } from '../desktop/main/plugins/dsh/commands';

it('executes local commands with Unicode arguments and removes them with their plugin', async () => {
  const ctx = new Context();
  const commands = new LocalCommands(ctx);
  const plugin = ctx.plugin({ inject: ['commands'], apply(child: any) {
    child.commands.register({ name: 'pet', description: '选择宠物', handler: ({ rawInput }: {rawInput: string}) => ({kind:'success',text:rawInput}) });
  } });
  await plugin.await();
  expect(commands.list()).toEqual([{ name:'pet',description:'选择宠物',input:undefined }]);
  expect(await commands.execute('', '/pet 小鱼 🌱')).toEqual({kind:'success',text:'小鱼 🌱'});
  await expect(commands.execute('', '/unknown')).rejects.toThrow('未知插件命令');
  await expect(commands.execute('', '/pet', [{}])).rejects.toThrow('仅支持文本');
  await plugin.dispose();
  expect(commands.list()).toEqual([]);
});

it('cleans up plugin command UI, sidebar tabs and shortcuts on unload', async () => {
  const { installInteractions } = await import('../desktop/renderer/plugins/dsh/interactions');
  const { vi } = await import('vitest');
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', { platform: 'MacIntel' });
  vi.stubGlobal('document', { querySelector: () => null });
  vi.stubGlobal('Element', class {});
  const ctx = new Context();
  const runtime = { sidebarTabs: [], activeSidebarTab: undefined, changed: vi.fn(), closeRightbar: vi.fn() };
  const commandUi = installInteractions(ctx, runtime as any);
  const run = vi.fn();
  try {
    const plugin = ctx.plugin({ inject: ['commandUi','sidebarRightTabs','shortcuts'], apply(child: any) {
      child.commandUi.decorate({ name:'pet',ui:{kind:'popupSelect',options:async()=>[],onSelect:async()=>{}} });
      child.sidebarRightTabs.register({ id:'pet-chat',kind:'pet-chat',title:()=> '桌宠对话' });
      child.shortcuts.register({ id:'example.open',label:()=> '桌宠对话',defaults:{'desktop:macos':{code:'KeyP',modifiers:['primary','alt']}},resolve:()=>({status:'handled',run}) });
    } });
    await plugin.await();
    expect(commandUi.decorations.has('pet')).toBe(true);
    expect(runtime.sidebarTabs).toHaveLength(1);
    expect((ctx.get('shortcuts') as any).catalog.getSnapshot()).toHaveLength(1);
    const key = new Event('keydown', { cancelable: true });
    Object.assign(key, { code:'KeyP',metaKey:true,ctrlKey:false,shiftKey:false,altKey:true });
    window.dispatchEvent(key);
    expect(run).toHaveBeenCalledOnce();
    expect(key.defaultPrevented).toBe(true);
    const conflict = ctx.plugin({inject:['shortcuts'],apply(child: any) { child.shortcuts.register({id:'another.open',label:()=> '另一个命令',defaults:{'desktop:macos':{code:'KeyP',modifiers:['primary','shift']}},resolve:()=>({status:'handled',run})}); }});
    await conflict.await();
    expect((ctx.get('shortcuts') as any).catalog.getSnapshot().find((row: any)=>row.id==='another.open')).toMatchObject({keys:[],conflicts:['Town 命令面板']});
    await conflict.dispose();
    await plugin.dispose();
    expect(commandUi.decorations.size).toBe(0);
    expect(runtime.sidebarTabs).toHaveLength(0);
    expect((ctx.get('shortcuts') as any).catalog.getSnapshot()).toHaveLength(0);
  } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals(); }
});

it('uses public theme registration uniformly and never rewrites plugin-owned preferences', async () => {
  const { vi } = await import('vitest');
  const { installPresentationServices } = await import('../desktop/renderer/plugins/dsh/services');
  const values = new Map([['third-party.selection','saved-theme']]);
  const read = vi.fn((key: string)=>values.get(key) ?? null), write = vi.fn((key: string,value: string)=>values.set(key,value));
  vi.stubGlobal('localStorage',{getItem:read,setItem:write});
  vi.stubGlobal('matchMedia',()=>Object.assign(new EventTarget(),{matches:false}));
  vi.stubGlobal('document',{documentElement:{dataset:{theme:'light'}},body:{hasAttribute:()=>false}});
  vi.stubGlobal('navigator',{languages:['zh-CN'],language:'zh-CN'});
  const ctx = new Context();
  try {
    installPresentationServices(ctx);
    const theme = ctx.get('theme') as any;
    for (const id of ['custom-theme','vscode-example']) {
      const release=theme.register({id,colorScheme:'dark',tokens:{'--bg':'#111'}});
      theme.setTheme(id); expect(theme.getTheme().preference).toBe(id);
      theme.setTheme('light'); expect(theme.getTheme().active.tokens).toEqual({});
      release();
    }
    expect(read.mock.calls.every(([key])=>key.startsWith('town.dsh.'))).toBe(true);
    expect(write.mock.calls.every(([key])=>key.startsWith('town.dsh.'))).toBe(true);
    expect(values.get('third-party.selection')).toBe('saved-theme');
  } finally { await ctx.fiber.dispose(); vi.unstubAllGlobals(); }
});

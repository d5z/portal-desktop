import { Context } from '@deepseek-ai/cordis';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { stringify } from 'smol-toml';
import { resolveSubagentModel } from '../desktop/main/plugins/dsh/subagent-model';
import { inspectBeingModel, resolvePluginModel } from '../desktop/main/plugins/dsh/being-model';
import { installModelServices } from '../desktop/main/plugins/dsh/model-services';
import type { Settings } from '../desktop/shared/types';
import type { TownDshHostServices } from '../plugins/sdk/dsh';
const directories: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function fixture(model?: Record<string, unknown>, enabled = true) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-subagent-')); directories.push(dir);
  if (model) await writeFile(path.join(dir, 'subagent-portal.toml'), stringify({ subagent: { enabled, model } }));
  return dir;
}
it('uses the existing custom subagent endpoint/key for independent streaming and reflects model changes', async () => {
  const dir = await fixture({ provider:'portal-custom', model:'vision-local', api:'openai-completions', base_url:'http://127.0.0.1:8888/v1/', api_key:'fixture-secret' });
  const model = await resolveSubagentModel(dir, {} as Settings, {});
  expect(model.compatibility.supported).toBe(true);
  expect(JSON.stringify(model.compatibility)).not.toContain('fixture-secret');
  expect(model.services?.baseUrl).toBe('http://127.0.0.1:8888/v1');
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response('data: {"choices":[{"delta":{"content":"可用"}}]}\n\ndata: [DONE]\n'));
  vi.stubGlobal('fetch', fetcher);
  const ctx = new Context();
  try {
    await installModelServices(ctx, model.services!, dir, () => model.compatibility);
    const llm = ctx.get('llm') as TownDshHostServices['llm'];
    expect(llm.listModels('openai-compatible')).toEqual([{id:'vision-local',name:'vision-local'}]);
    const events = [];
    for await (const event of llm.stream({provider:'openai-compatible',model:'vision-local',system:'plugin only',messages:[{role:'user',content:[{type:'text',text:'hello'}]}]})) events.push(event);
    expect(events).toEqual([{type:'text-delta',index:0,text:'可用'}]);
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:8888/v1/chat/completions');
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toMatchObject({authorization:'Bearer fixture-secret'});
    expect(JSON.parse(init.body as string).messages[0]).toEqual({role:'system',content:'plugin only'});
    model.services!.model='changed';
    expect(ctx.get('agentDefaultModel').currentSelection().model).toBe('changed');
    const notice=vi.spyOn(process as { send(message: unknown): boolean },'send').mockImplementation(()=>true);
    model.compatibility={supported:false,message:'subagent 已停用'};
    expect(llm.listProviders()).toEqual([]);
    await expect(async()=>{for await(const _ of llm.stream({provider:'openai-compatible',model:'changed',messages:[]})) {}}).rejects.toThrow('subagent 已停用');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith({type:'model-unavailable'});
    notice.mockRestore();
  } finally { await ctx.fiber.dispose(); }
});
it.each(['anthropic-messages','openai-responses','google-generative-ai'])('explicitly rejects unsupported %s rather than calling the wrong API', async api => {
  const dir=await fixture({provider:'portal-custom',model:'test',api,base_url:'https://example.test/v1',api_key:'secret'});
  const result=await resolveSubagentModel(dir,{} as Settings,{});
  expect(result.compatibility.supported).toBe(false); expect(result.compatibility.message).toContain(api); expect(result.services).toBeUndefined();
});
it('does not reuse a disabled model and allows local APIs without a key',async()=>{
  const model={provider:'portal-custom',model:'local',api:'openai-completions',base_url:'http://localhost:11434/v1'};
  expect((await resolveSubagentModel(await fixture(model,false),{} as Settings,{})).compatibility.message).toContain('已停用');
  expect((await resolveSubagentModel(await fixture(model),{} as Settings,{})).compatibility.supported).toBe(true);
  expect((await resolveSubagentModel(await fixture(),{} as Settings,{})).compatibility.message).toContain('尚未配置');
});
it('uses the configured Portal file and provider-specific environment key without exposing it in status',async()=>{
  const dir=await fixture({provider:'openrouter',model:'vendor/model'});
  const result=await resolveSubagentModel('/unused',{portalConfigPath:path.join(dir,'subagent-portal.toml')} as Settings,{OPENROUTER_API_KEY:'test-secret'});
  expect(result.services).toMatchObject({baseUrl:'https://openrouter.ai/api/v1',apiKey:'test-secret'});
  expect(JSON.stringify(result.compatibility)).not.toContain('test-secret');
  expect((await resolveSubagentModel(dir,{} as Settings,{})).compatibility.message).toContain('OAuth');
});
it('reports Being contract incompatibility without creating a conversational turn',async()=>{
  const request=vi.fn(async(_input: Request)=>Response.json({model:'being-current'}));
  expect((await inspectBeingModel(false,request)).supported).toBe(false); expect(request).not.toHaveBeenCalled();
  expect((await inspectBeingModel(true,request)).message).toContain('尚不支持插件独立生成');
  expect(request).toHaveBeenCalledTimes(1); expect(request.mock.calls[0][0].method).toBe('GET');
  expect(request.mock.calls[0][0].url).toBe('beings://chat/api/llm/config');
});

it('checks Being before reading the fallback configuration and reports the selected source',async()=>{
  const dir=await fixture();
  const request=vi.fn(async()=>{
    await writeFile(path.join(dir,'subagent-portal.toml'),stringify({subagent:{enabled:true,model:{provider:'portal-custom',api:'openai-completions',model:'fallback-after-being',base_url:'http://localhost:1234/v1'}}}));
    return Response.json({model:'being-first'});
  });
  const resolved=await resolvePluginModel(dir,{} as Settings,true,request);
  expect(request).toHaveBeenCalledTimes(1);
  expect(resolved.services?.model).toBe('fallback-after-being');
  expect(resolved.compatibility.supported).toBe(true);
  expect(resolved.compatibility.message).toMatch(/being-first.*已回退到 subagent.*fallback-after-being/);
});
it('explains both unavailable sources when Being lookup fails and subagent is absent',async()=>{
  const result=await resolvePluginModel(await fixture(),{} as Settings,true,async()=>new Response(null,{status:503}));
  expect(result.compatibility.supported).toBe(false);
  expect(result.compatibility.message).toContain('HTTP 503');
  expect(result.compatibility.message).toContain('尚未配置 subagent');
  expect(result.services).toBeUndefined();
});

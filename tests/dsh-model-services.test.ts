import { Context } from '@deepseek-ai/cordis';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { installModelServices } from '../desktop/main/plugins/dsh/model-services';
import type { TownDshHostServices } from '../plugins/sdk/dsh';

it('streams split UTF-8 SSE with image bytes and cancels when the consumer stops', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'town-dsh-model-'));
  const ctx = new Context();
  let cancelled = false;
  const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"想"}}]}\n\ndata: {"choices":[{"delta":{"content":"你好"}}]}\n\n');
  const fetchMock = vi.fn(async () => new Response(new ReadableStream({
    start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); },
    cancel() { cancelled = true; },
  })));
  vi.stubGlobal('fetch', fetchMock);
  try {
    await installModelServices(ctx, { provider:'openai-compatible', baseUrl:'https://example.test/v1', model:'vision', apiKey:'fixture' }, home);
    const attachments = ctx.get('attachments') as TownDshHostServices['attachments'];
    const [image] = await attachments.saveImages([{data:new Uint8Array([1,2,3]),mediaType:'image/png'}]);
    expect(image.attachmentId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(() => attachments.imageHostPath({attachmentId:'sha256:../../outside'})).toThrow('无效图片附件引用');
    const speech = ctx.get('speechToText') as TownDshHostServices['speechToText'];
    expect(speech.listProviders()).toEqual([]);
    await expect(speech.transcribe({audio:new Uint8Array([1])})).rejects.toThrow('未提供插件语音转写能力');
    expect(fetchMock).not.toHaveBeenCalled();
    const llm = ctx.get('llm') as TownDshHostServices['llm'];
    const stream = llm.stream({provider:'openai-compatible', model:'vision',messages:[{role:'user',content:[{type:'text',text:'描述图片'},{type:'image',attachment:image}]}]});
    const output = [];
    for await (const event of stream) { output.push(event); if (output.length === 2) break; }
    expect(output).toEqual([{type:'reasoning-delta',index:1,text:'想'},{type:'text-delta',index:0,text:'你好'}]);
    expect(cancelled).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).messages[0].content[1].image_url.url).toBe('data:image/png;base64,AQID');
    fetchMock.mockImplementationOnce(async () => new Response('private provider error', {status:401}));
    const notice = vi.spyOn(process as { send(message: unknown): boolean }, 'send').mockImplementation(() => true);
    await expect(async () => { for await (const _ of llm.stream({provider:'openai-compatible',model:'vision',messages:[]})) {} }).rejects.toThrow('HTTP 401');
    expect(notice).toHaveBeenCalledWith({type:'model-error',message:'插件模型鉴权失败（HTTP 401），请在 subagent 设置中填写或更新当前服务的 API Key。'});
    expect(JSON.stringify(notice.mock.calls)).not.toContain('private provider error');
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); await ctx.fiber.dispose(); await rm(home,{recursive:true,force:true}); }
});

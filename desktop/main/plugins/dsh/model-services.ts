import type { Context } from '@deepseek-ai/cordis';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DshServiceConfig, DshModelCompatibility } from '../../../shared/dsh-plugins';

/** Generic model services use the host-selected configuration, including the existing subagent model. */
export async function installModelServices(ctx: Context, config: DshServiceConfig, home: string, compatibility?: () => DshModelCompatibility | undefined) {
  const provided = new Set(['attachments', 'agentDefaultModel', 'credentials', 'llm', 'speechToText'].filter(name => !ctx.get(name)));
  const imageDirectory = path.join(home, 'attachments');
  await mkdir(imageDirectory, { recursive: true, mode: 0o700 });
  const imageHostPath = (ref: { attachmentId: string }) => {
    if (!/^sha256:[a-f0-9]{64}$/.test(ref.attachmentId)) throw new Error('无效图片附件引用');
    return path.join(imageDirectory, ref.attachmentId.slice(7));
  };
  if (provided.has('attachments')) ctx.provide('attachments', {
    imageLimits: { maxImageBytes: 10 * 1024 * 1024 }, imageHostPath,
    async saveImages(images: { data: Uint8Array; mediaType: string }[]) {
      return Promise.all(images.map(async image => {
        if (!(image.data instanceof Uint8Array) || image.data.length > 10 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image.mediaType)) throw new Error('图片类型或大小不受支持');
        const ref = { attachmentId: `sha256:${createHash('sha256').update(image.data).digest('hex')}`, mediaType: image.mediaType, bytes: image.data.length };
        await writeFile(imageHostPath(ref), image.data, { mode: 0o600 }); return ref;
      }));
    },
  });
  const configured = () => !!(config.baseUrl && config.model);
  const selection = () => {
    const status = compatibility?.();
    if (status && !status.supported) {
      process.send?.({ type: 'model-unavailable' });
      throw new Error(status.message);
    }
    if (!configured()) throw new Error('当前没有可用模型，请检查客户端现有的 subagent 配置。');
    return { provider: config.provider, model: config.model };
  };
  if (provided.has('agentDefaultModel')) ctx.provide('agentDefaultModel', { currentSelection: selection });
  if (provided.has('credentials')) ctx.provide('credentials', { resolve(ref: string) {
    selection();
    if (ref !== 'OPENAI_API_KEY' || !config.apiKey) throw new Error(`未配置插件凭证：${ref}`);
    return { value: config.apiKey };
  } });
  if (provided.has('llm')) ctx.provide('llm', {
    listProviders: () => compatibility?.()?.supported !== false && configured() ? [{ id: config.provider, name: '当前宿主模型' }] : [],
    listModels: (provider: string) => compatibility?.()?.supported !== false && configured() && provider === config.provider ? [{ id: config.model, name: config.model }] : [],
    resolveModelInfo: () => ({ reasoning: { efforts: [] } }),
    async *stream(options: { provider: string; model: string; messages: { role: string; content: any[] }[]; system?: string; temperature?: number; signal?: AbortSignal; tools?: unknown[] }) {
      selection();
      const current = { ...config };
      if (options.provider !== current.provider || options.model !== current.model) throw new Error('此模型供应商未配置插件 API。');
      if (options.tools?.length) throw new Error('Town DSH 模型适配暂不支持工具调用。');
      const messages: unknown[] = options.system ? [{ role: 'system', content: options.system }] : [];
      for (const message of options.messages) {
        const content = [];
        for (const block of message.content) {
          if (block.type === 'text') content.push({ type: 'text', text: block.text });
          else if (block.type === 'image') {
            const data = await readFile((ctx.get('attachments') as { imageHostPath(ref: { attachmentId: string }): string }).imageHostPath(block.attachment));
            content.push({ type: 'image_url', image_url: { url: `data:${block.attachment.mediaType};base64,${data.toString('base64')}` } });
          } else throw new Error(`模型适配不支持消息块：${block.type}`);
        }
        messages.push({ role: message.role, content: message.role === 'assistant' ? content.map((part: any) => part.text || '').join('') : content });
      }
      const response = await fetch(current.baseUrl + '/chat/completions', { method: 'POST', redirect: 'error',
        headers: { ...(current.apiKey ? { authorization: `Bearer ${current.apiKey}` } : {}), 'content-type': 'application/json' }, signal: options.signal,
        body: JSON.stringify({ model: options.model, messages, stream: true, ...(options.temperature === undefined ? {} : { temperature: options.temperature }) }),
      });
      if (!response.ok) {
        const message = response.status === 401
          ? '插件模型鉴权失败（HTTP 401），请在 subagent 设置中填写或更新当前服务的 API Key。'
          : `插件模型 API 返回 HTTP ${response.status}；请检查地址、密钥和模型。`;
        process.send?.({ type: 'model-error', message });
        throw new Error(message);
      }
      if (!response.body) throw new Error('插件模型未返回响应流');
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done });
          const lines = buffer.split('\n'); buffer = chunk.done ? '' : lines.pop()!;
          for (const raw of lines) {
            const line = raw.trim(); if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim(); if (data === '[DONE]') return;
            const event = JSON.parse(data);
            if (event.error) throw new Error('插件模型服务返回生成错误，请检查模型配置。');
            const delta = event.choices?.[0]?.delta;
            if (delta?.tool_calls?.length) throw new Error('Town DSH 模型适配暂不支持工具调用。');
            if (typeof delta?.content === 'string') yield { type: 'text-delta', index: 0, text: delta.content };
            if (typeof delta?.reasoning_content === 'string') yield { type: 'reasoning-delta', index: 1, text: delta.reasoning_content };
          }
          if (chunk.done) break;
        }
      } finally { await reader.cancel(); }
    },
  });
  if (provided.has('speechToText')) ctx.provide('speechToText', {
    listProviders: () => [],
    resolve(input: { audio: Uint8Array; language?: string }) {
      if (!(input.audio instanceof Uint8Array) || !input.audio.length || input.audio.length > 25 * 1024 * 1024 || (input.language !== undefined && typeof input.language !== 'string')) throw new Error('无效语音输入');
      return input;
    },
    async transcribe() { throw new Error('当前 subagent / Being 配置未提供插件语音转写能力。'); },
  });
  return provided;
}

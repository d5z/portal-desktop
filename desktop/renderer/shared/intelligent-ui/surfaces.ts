import { marked } from 'marked';
import { UIStream } from './stream';
import type { UIDocument, Value } from './runtime';

export type AppSelections = Record<string, { title: string; values: Record<string, Value> }>;
export interface UIInteraction {
  surfaceId: string;
  revision: number;
  title: string;
  action: 'continue';
  summary?: string;
  apps?: AppSelections;
  values: Record<string, Value>;
}
export interface SurfaceVersion { revision: number; doc: UIDocument }
export interface Surface {
  id: string;
  scope: string;
  owner: string;
  versions: SurfaceVersion[];
}
export interface SurfaceBlock {
  surface: Surface;
  owner: boolean;
  pending: boolean;
  error: string;
}
export interface AnswerBlock { type: 'text' | 'ui'; content: string; id: string }
export function answerBlocks(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let count = 0;
  for (const token of marked.lexer(text, { gfm: true, breaks: true })) {
    if (token.type === 'code' && token.lang?.trim().toLowerCase() === 'intelligent-ui') blocks.push({ type: 'ui', content: token.text, id: `ui-${count++}` });
    else if (blocks.at(-1)?.type === 'text') blocks.at(-1)!.content += token.raw;
    else blocks.push({ type: 'text', content: token.raw, id: `text-${count}` });
  }
  return blocks;
}
// Read just the complete first object; handles multiline begin and quoted braces.
function header(source: string): any {
  let depth = 0, quoted = false, escaped = false;
  const text = source.trimStart();
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(text.slice(0, i + 1)); } catch { return {}; } }
  }
  return {};
}
const blockKey = (message: string, block: string) => JSON.stringify([message, block]);
export { blockKey };

/** Rebuild surfaces from durable messages; never rewrite the original history. */
export class SurfaceTimeline {
  private previous: { id: string; identity: string; scope: string; text: string; streaming: boolean }[] = [];
  private result = new Map<string, SurfaceBlock>();
  private cache = new Map<string, { text: string; blocks: AnswerBlock[] }>();
  private parsed = new Map<string, { source: string; streaming: boolean; base?: UIDocument; parser: UIStream; result: ReturnType<UIStream['update']> }>();
  build(messages: { id: string; identity: string; scope: string; text: string; streaming: boolean }[]) {
    // Ordinary prose cannot define a surface. Keep the context identity stable
    // while typing or streaming unrelated prose so saved controls do not rerender.
    messages = messages.filter(message => /intelligent-ui/i.test(message.text));
    if (messages.length === this.previous.length && messages.every((message, index) => {
      const previous = this.previous[index];
      return message.id === previous.id && message.identity === previous.identity && message.scope === previous.scope &&
        message.text === previous.text && message.streaming === previous.streaming;
    })) return this.result;
    this.previous = messages.map(message => ({ ...message }));
    const surfaces = new Map<string, Surface>(), blocks = new Map<string, SurfaceBlock>();
    const alive = new Set<string>(), parsedAlive = new Set<string>();
    for (const message of messages) {
      alive.add(message.id);
      let cached = this.cache.get(message.id);
      if (!cached || cached.text !== message.text) {
        cached = { text: message.text, blocks: answerBlocks(message.text) };
        this.cache.set(message.id, cached);
      }
      for (const block of cached.blocks) {
        if (block.type !== 'ui') continue;
        const begin = header(block.content);
        // Older untagged artifacts remain usable and receive a stable local identity.
        const id = typeof begin.surfaceId === 'string' ? begin.surfaceId : `legacy-${message.identity.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 90)}-${block.id}`;
        const key = JSON.stringify([message.scope, id]), entryKey = blockKey(message.id, block.id);
        const existing = surfaces.get(key);
        const surface: Surface = existing || { id, scope: message.scope, owner: entryKey, versions: [] };
        const base = surface.versions.at(-1);
        let error = '';
        if (existing) {
          if (!base) error = '原界面尚未成功保存，不能基于它更新。请用新的 surfaceId 输出完整界面。';
          else if (begin.baseRevision === undefined) error = `更新缺少 baseRevision。此 surfaceId 已有第 ${base.revision} 版；修改原界面请在 begin 中填写 baseRevision:${base.revision}，新建界面请使用新的 surfaceId。`;
          else if (!Number.isSafeInteger(begin.baseRevision) || begin.baseRevision < 1) error = `baseRevision 必须是数字形式的正整数；当前界面为第 ${base.revision} 版。协议 version:2 与界面版本号不同。`;
          else if (begin.baseRevision !== base.revision) error = `更新基于第 ${begin.baseRevision} 版，但当前界面为第 ${base.revision} 版。为避免覆盖已有修改，已保留原界面；请基于当前版本重新生成更新。`;
        }
        if (!existing && (begin.mode === 'patch' || begin.baseRevision !== undefined)) error = '找不到要更新的界面，请重新输出完整界面并使用新的 surfaceId。';
        const baseDoc = begin.mode === 'patch' ? base?.doc : undefined;
        parsedAlive.add(entryKey);
        let parsed = this.parsed.get(entryKey);
        if (!parsed || parsed.source !== block.content || parsed.streaming !== message.streaming || parsed.base !== baseDoc) {
          // The decoder already tracks its consumed prefix. Keep it for the
          // active stream instead of replaying all prior JSON events per chunk.
          const parser = parsed?.streaming && parsed.base === baseDoc ? parsed.parser : new UIStream(baseDoc);
          parsed = { source: block.content, streaming: message.streaming, base: baseDoc, parser,
            result: parser.update(block.content, message.streaming) };
          this.parsed.set(entryKey, parsed);
        }
        error ||= parsed.result.error;
        // Updates commit atomically; malformed or unfinished updates leave the previous UI intact.
        if (!error && !message.streaming && parsed.result.doc) {
          surface.versions.push({ revision: (base?.revision || 0) + 1, doc: parsed.result.doc });
        }
        if (!existing) surfaces.set(key, surface);
        blocks.set(entryKey, { surface, owner: !existing, pending: message.streaming, error });
      }
    }
    for (const key of this.cache.keys()) if (!alive.has(key)) this.cache.delete(key);
    for (const key of this.parsed.keys()) if (!parsedAlive.has(key)) this.parsed.delete(key);
    this.result = blocks;
    return blocks;
  }
}

/** A self-contained repair draft also works when per-message UI context is off. */
export function surfaceRepairPrompt(surface: Surface, error: string): string {
  const latest = surface.versions.at(-1);
  if (!latest) return `请修正未成功保存的界面「${surface.id}」。客户端报告：${error}。保留原任务和有效内容，请使用新的唯一 surfaceId 输出完整 intelligent-ui 界面，省略 baseRevision，以 commit 结束。`;
  const begin = { op: 'begin', version: 2, surfaceId: surface.id, title: latest.doc.title, mode: 'replace', baseRevision: latest.revision };
  return `请修正界面 ${surface.id} 的更新。客户端报告：${error}\n当前已保存的是第 ${latest.revision} 版；协议 version 固定为 2，与 baseRevision 不同。\n请使用 intelligent-ui 代码围栏，第一条事件为：\n${JSON.stringify(begin)}\n然后输出完整的 state/node 事件，最后输出 {"op":"commit"}。保留原任务内容、稳定节点 id 和状态键，客户端会保留用户选择。不要省略 baseRevision，也不要为更新重复创建新 surfaceId。`;
}

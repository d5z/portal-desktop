import type { TownChannel, TownLiveState, TownQuery } from '../../shared/types';
import { TOWN_ORIGIN } from './client';
import { townDisplayName, validTownIdentity } from '../../shared/town-identity';

type Data = Record<string, unknown>;
const object = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
const id = (value: unknown) => typeof value === 'string' && /^[\w-]{1,160}$/.test(value) ? value : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : '';
const key = (type: string, data: Data) => {
  const message = id(type === 'dm' ? data.id : data.seq);
  if (!message) return '';
  if (type === 'fireside') return id(data.fireside_id) ? `f:${id(data.fireside_id)}:${message}` : '';
  return type === 'dm' ? `d:${message}` : type === 'bonfire' ? `b:${message}` : '';
};

// Only identity and change counters leave the main process. No event bodies or tokens.
export class TownLive {
  state: TownLiveState = { phase: 'unpaired', generation: 0, revision: 0, sync: 0, message: '尚未配对 Town', versions: { bonfire: 0, mail: 0, firesides: 0 }, firesideVersions: {} };
  private controller?: AbortController;
  private retry?: ReturnType<typeof setTimeout>;
  private seen = new Set<string>();
  private attempts = 0;
  constructor(private getToken: () => string, private getExpectedBeing: () => string, private publish: (state: TownLiveState) => void, private fetcher: typeof fetch = fetch, private origin = TOWN_ORIGIN, private getDisplay: () => string = () => '') {}
  private update(patch: Partial<TownLiveState>) {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    this.publish(this.state);
  }
  dispose() { clearTimeout(this.retry); this.controller?.abort(); this.controller = undefined; }
  restart() {
    this.dispose(); this.seen.clear(); this.attempts = 0;
    this.update({ generation: this.state.generation + 1, sync: 0, beingId: undefined, display: undefined, versions: { bonfire: 0, mail: 0, firesides: 0 }, firesideVersions: {}, phase: this.getToken() ? 'connecting' : 'unpaired', message: this.getToken() ? '正在确认 Town 身份' : '尚未配对 Town' });
    if (this.getToken()) void this.connect(this.state.generation);
  }
  rejectAuth() {
    if (this.state.phase === 'auth-error') return;
    this.dispose();
    this.update({ phase: 'auth-error', beingId: undefined, display: undefined, message: 'Town 凭据无效或已失效；已加载内容仍可阅读，请重新配对后刷新。' });
  }
  private rememberKey(value: string) {
    if (!value || this.seen.has(value)) return false;
    this.seen.add(value);
    if (this.seen.size > 5000) this.seen.delete(this.seen.values().next().value!);
    return true;
  }
  remember(query: TownQuery, data: Data) {
    const type = query.kind === 'bonfire' ? 'bonfire' : query.kind === 'inbox' || query.kind === 'sent' ? 'dm' : query.kind === 'fireside' ? 'fireside' : '';
    if (!type || !Array.isArray(data.messages)) return;
    for (const value of data.messages) this.rememberKey(key(type, { ...object(value), ...(type === 'fireside' ? { fireside_id: query.id } : {}) }));
  }
  private async connect(generation: number) {
    const controller = new AbortController(); this.controller = controller;
    const current = () => this.controller === controller && this.state.generation === generation && !controller.signal.aborted;
    let timeout = setTimeout(() => controller.abort(), 20000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let fatal = false, hello = false;
    let failure = "网络连接失败";
    try {
      const token = this.getToken();
      const url = new URL('/api/client/stream', this.origin); url.searchParams.set('token', token);
      const response = await this.fetcher(url.href, { headers: { Accept: 'text/event-stream' }, credentials: 'omit', redirect: 'error', signal: controller.signal });
      if (!current()) { await response.body?.cancel(); return; }
      if ([401, 403].includes(response.status)) {
        await response.body?.cancel(); fatal = true; this.rejectAuth(); return;
      }
      if (!response.ok) {
        failure = `SSE 请求返回 HTTP ${response.status}`;
        await response.body?.cancel();
        throw new Error('sse-http');
      }
      if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
        failure = '服务器未返回 SSE 流';
        await response.body?.cancel();
        throw new Error('sse-format');
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '', event = '', lines: string[] = [], size = 0;
      const dispatch = () => {
        if (!lines.length) { event = ''; size = 0; return; }
        const type = event; let data: Data;
        try { data = object(JSON.parse(lines.join('\n'))); } catch { throw new Error('event'); }
        event = ''; lines = []; size = 0;
        if (type === 'hello') {
          const beingId = typeof data.town_id === 'string' ? data.town_id : typeof data.being_id === 'string' ? data.being_id : '';
          const expected = this.getExpectedBeing();
          const matchesExpected = !expected || expected === beingId || (!expected.startsWith('t_') && expected === data.being_id);
          if (data.anonymous !== false || data.token_kind !== 'client' || !validTownIdentity(beingId) || data.town_id !== undefined && !beingId.startsWith('t_') || !matchesExpected || this.state.beingId && this.state.beingId !== beingId) {
            failure = expected && expected !== beingId ? 'SSE hello 身份与配对 Being 不一致' : 'SSE hello 未确认 client 身份';
            fatal = true; this.rejectAuth(); throw new Error('identity');
          }
          if (!hello) {
            hello = true; this.attempts = 0;
            const display = townDisplayName(
              data.display_name || data.speaker_name || data.display || this.getDisplay(),
              beingId,
            ) || undefined;
            this.update({ phase: 'connected', beingId, display, sync: this.state.sync + 1, message: `Town 已连接 · ${display || '@' + beingId}` });
          }
          return;
        }
        if (!hello) { failure = 'SSE 未先返回 hello 身份事件'; throw new Error('missing-hello'); }
        const channel: TownChannel | undefined = type === 'bonfire' ? 'bonfire' : type === 'dm' ? 'mail' : type === 'fireside' ? 'firesides' : undefined;
        if (channel && this.rememberKey(key(type, data))) {
          const firesideId = type === 'fireside' ? id(data.fireside_id) : '';
          this.update({
            versions: { ...this.state.versions, [channel]: this.state.versions[channel] + 1 },
            ...(firesideId ? {
              firesideVersions: {
                ...this.state.firesideVersions,
                [firesideId]: (this.state.firesideVersions?.[firesideId] || 0) + 1,
              },
            } : {}),
          });
        }
      };
      while (current()) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!current()) return;
        if (hello) { clearTimeout(timeout); timeout = setTimeout(() => controller.abort(), 75000); }
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 256 * 1024) throw new Error('size');
        // Handle CR, LF and CRLF, including a CRLF split across chunks.
        while (true) {
          const position = buffer.search(/[\r\n]/);
          if (position < 0 || buffer[position] === '\r' && position === buffer.length - 1) break;
          const line = buffer.slice(0, position);
          buffer = buffer.slice(position + (buffer[position] === '\r' && buffer[position + 1] === '\n' ? 2 : 1));
          if (!line) { dispatch(); if (!current()) return; continue; }
          if (line.startsWith(':')) continue;
          size += line.length; if (size > 256 * 1024) throw new Error('size');
          const colon = line.indexOf(':');
          const field = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
          if (field === 'event') event = value;
          else if (field === 'data') lines.push(value);
        }
        if (hello) { clearTimeout(timeout); timeout = setTimeout(() => controller.abort(), 75000); }
      }
    } catch { /* Network errors may contain the credential URL; never surface them. */ }
    finally {
      clearTimeout(timeout); await reader?.cancel().catch(() => {});
      // Timed-out attempts reconnect; superseded and disposed attempts do not.
      if (!fatal && this.controller === controller && this.state.generation === generation) {
        controller.abort();
        this.update({ phase: 'reconnecting', message: `Town SSE ${failure}，正在重连；已加载内容仍可阅读。` });
        const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempts++, 5)) + Math.floor(Math.random() * 500);
        this.retry = setTimeout(() => { void this.connect(generation); }, delay);
      }
    }
  }
}

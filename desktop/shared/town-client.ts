import type { TownPost, TownQuery, TownResult } from './types';
import { normalizeTownDisplay, normalizeTownIdentity, validTownIdentity } from './town-identity';

export const TOWN_ORIGIN = 'https://beings.town';
const idPattern = /^[a-zA-Z0-9_-]{1,160}$/;
const traceIdPattern = /^(?!0{32}$)[0-9a-f]{32}$/;

export interface TownRequestEvent {
  traceId: string;
  spanId: string;
  requestedAt: string;
  method: string;
  route: string;
  durationMs: number;
  status?: number;
  bytes?: number;
  failure?: string;
  error?: string;
}

function randomNonZeroHex(length: number) {
  const bytes = new Uint8Array(length);
  do { globalThis.crypto.getRandomValues(bytes); } while (bytes.every(value => value === 0));
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

export const createTownTraceId = () => randomNonZeroHex(16);
export const createTownSpanId = () => randomNonZeroHex(8);
export const validTownTraceId = (value: unknown): value is string => typeof value === 'string' && traceIdPattern.test(value);
export function townTraceparent(traceId = createTownTraceId()) {
  if (!validTownTraceId(traceId)) throw new Error('无效的 Town Trace ID。');
  const spanId = createTownSpanId();
  return { traceId, spanId, value: `00-${traceId}-${spanId}-01` };
}

class TownRequestFailure extends Error {
  constructor(readonly traceId: string, readonly status: number | undefined, readonly reason: unknown) {
    super(reason instanceof Error ? reason.message : String(reason));
    this.name = 'TownRequestFailure';
  }
}

function tracedFailure(result: TownResult, traceId: string): TownResult {
  if (result.ok) return result;
  return { ...result, traceId, message: `${result.message}\nTrace ID：${traceId}` };
}

function requestFailure(error: unknown, status?: number) {
  if (status !== undefined && (status < 200 || status >= 300)) return `http-${status}`;
  if (error instanceof TownReadError) return error.kind;
  if (isTimeout(error)) return 'timeout';
  return status === undefined ? 'network' : 'response';
}
export function townRoute(query: TownQuery, beingId = ''): { route: string; private: boolean } {
  if (!query || typeof query !== 'object') throw new Error('无效的 Town 请求。');
  const offset = query.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new Error('无效的分页。');
  switch (query.kind) {
    case 'home': return { route: '/api', private: false };
    case 'announcements': {
      if (query.category !== undefined && !['', 'update', 'rule', 'event', 'general'].includes(query.category)) throw new Error('无效的公告分类。');
      if (query.includeExpired !== undefined && typeof query.includeExpired !== 'boolean') throw new Error('无效的公告历史筛选。');
      const params = new URLSearchParams({ limit: '24', offset: String(offset) });
      if (query.category) params.set('category', query.category);
      if (query.includeExpired) params.set('include_expired', 'true');
      return { route: '/api/announcements?' + params, private: false };
    }
    case 'announcement': {
      if (typeof query.id !== 'string' || !idPattern.test(query.id) || ['help', 'mentions', 'subscribe'].includes(query.id)) throw new Error('无效的公告编号。');
      return { route: `/api/announcements/${query.id}`, private: false };
    }
    case 'contacts': return { route: '/api/contacts', private: false };
    case 'seeds': {
      const params = new URLSearchParams({ limit: '24', offset: String(offset) });
      for (const field of ['q', 'domain', 'tag', 'kit', 'lifecycle'] as const) {
        const value = query[field];
        if (value === undefined || value === '') continue;
        if (typeof value !== 'string' || value.length > 300 || /[\u0000-\u001f]/.test(value)) throw new Error('无效的种子筛选条件。');
        if (field === 'lifecycle' && !['seed', 'stale', 'superseded'].includes(value)) throw new Error('无效的种子状态。');
        if (value.trim()) params.set(field, value.trim());
      }
      return { route: '/api/seeds?' + params, private: false };
    }
    case 'seed': case 'seed-lineage': case 'seed-absorbs': {
      if (typeof query.id !== 'string' || !idPattern.test(query.id) || query.id === 'help') throw new Error('无效的种子编号。');
      const suffix = query.kind === 'seed-lineage' ? '/lineage' : query.kind === 'seed-absorbs' ? '/absorb' : '';
      return { route: `/api/seeds/${query.id}${suffix}`, private: false };
    }
    case 'bonfire': {
      const limit = query.limit ?? 100;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('篝火加载条数应为 1–200。');
      return { route: `/api/bonfire/hear?limit=${limit}`, private: true };
    }
    case 'firesides': return { route: '/api/fireside/list', private: true };
    case 'fireside': case 'fireside-members': {
      if (typeof query.id !== 'string' || !/^\d{1,16}$/.test(query.id)) throw new Error('无效的围炉编号。');
      return { route: query.kind === 'fireside'
        ? `/api/fireside/hear?fireside_id=${query.id}&limit=50`
        : `/api/fireside/members?fireside_id=${query.id}`, private: true };
    }
    case 'inbox': return { route: '/api/messages?with=received', private: true };
    case 'sent': return { route: '/api/messages?with=sent', private: true };
    case 'embers': return { route: `/api/embers?limit=24&offset=${offset}`, private: false };
    case 'scrolls': case 'my-scrolls': {
      const kind = query.scrollKind || '';
      if (typeof kind !== 'string' || kind && !['note', 'procedure', 'lesson', 'pattern', 'guide', 'skill'].includes(kind)) throw new Error('无效的卷轴类型。');
      if (query.kind === 'my-scrolls' && !validTownIdentity(beingId)) throw new Error('请先配对 Being，以查看我的卷轴。');
      const scope = query.kind === 'my-scrolls' ? `${beingId.startsWith('t_') ? 'author' : 'being_id'}=${beingId}` : 'visibility=public';
      return { route: `/api/scrolls?${scope}&limit=24&offset=${offset}${kind ? '&kind=' + kind : ''}`, private: true };
    }
    case 'grove': {
      if (query.groveStatus !== undefined && !['', 'grown', 'growing', 'sprouting'].includes(query.groveStatus)) throw new Error('无效的 Grove 成长阶段。');
      return { route: `/api/grove?limit=24&offset=${offset}${query.groveStatus ? '&status=' + query.groveStatus : ''}`, private: false };
    }
    case 'kit-comments':
      if (typeof query.id !== 'string' || !idPattern.test(query.id)) throw new Error('无效的内容编号。');
      return { route: `/api/grove/${query.id}/comments`, private: false };
    case 'kit': case 'ember': case 'scroll': {
      if (typeof query.id !== 'string' || !idPattern.test(query.id)) throw new Error('无效的内容编号。');
      const resource = { kit: 'grove', ember: 'embers', scroll: 'scrolls' }[query.kind];
      return { route: `/api/${resource}/${query.id}${query.kind === 'kit' ? '' : '?limit=10000&offset=' + offset}`, private: query.kind === 'scroll' };
    }
    default: throw new Error('不支持的 Town 请求。');
  }
}

export class TownClient {
  private conditionalCache = new Map<string,{etag:string;modified:string;data:Record<string,unknown>}>();
  private cacheIdentity = '';

  constructor(private getToken: () => string, private fetcher: typeof fetch = fetch, private origin = TOWN_ORIGIN, private getBeingId: () => string = () => '', private reportRequest?: (event: TownRequestEvent) => void) {}
  private report(event: TownRequestEvent) {
    try { this.reportRequest?.(event); } catch { /* Diagnostics must not change request behavior. */ }
  }
  private async request<T>(route: string, init: RequestInit, consume: (response: Response) => Promise<T>, traceId = createTownTraceId()) {
    const trace = townTraceparent(traceId);
    const requestedAt = new Date().toISOString();
    const started = Date.now();
    let status: number | undefined;
    try {
      const response = await this.fetcher(this.origin + route, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), traceparent: trace.value },
      });
      status = response.status;
      const value = await consume(response);
      this.report({
        traceId: trace.traceId, spanId: trace.spanId, requestedAt,
        method: init.method || 'GET', route, status, durationMs: Date.now() - started,
        ...(!response.ok && response.status!==304 ? { failure: `http-${status}`, error: `HTTP ${status}` } : {}),
      });
      return { value, traceId: trace.traceId };
    } catch (error) {
      const failure = requestFailure(error, status);
      this.report({
        traceId: trace.traceId, spanId: trace.spanId, requestedAt,
        method: init.method || 'GET', route, ...(status === undefined ? {} : { status }),
        durationMs: Date.now() - started,
        ...(error instanceof TownReadError && error.bytes !== undefined ? { bytes: error.bytes } : {}),
        failure, error: failure,
      });
      throw new TownRequestFailure(trace.traceId, status, error);
    }
  }
  async pair(input: { beingId: string; code: string }, signal?: AbortSignal, traceId?: string): Promise<{ token: string; beingId: string; display?: string }> {
    if (!input || typeof input.beingId !== 'string' || typeof input.code !== 'string') throw new Error('请输入 Being 名和配对码。');
    const beingId = normalizeTownIdentity(input.beingId), code = input.code.trim().toUpperCase();
    if (!validTownIdentity(beingId) || !/^[A-Z0-9]{6}$/.test(code)) throw new Error('请输入有效的 Town ID 或 Being 名；配对码须为 6 位字母或数字。');
    const townIdInput = beingId.startsWith('t_');
    try {
      const request = await this.request('/api/client/pair/confirm', {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ [townIdInput ? 'town_id' : 'being_id']: beingId, code }), credentials: 'omit', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      }, async response => {
        if (!response.ok) {
          const detail = await townErrorDetail(response, [this.getToken(), code]);
          const label = response.status === 429 ? '配对尝试过于频繁，请稍后重试。' : `配对失败（HTTP ${response.status}），请核对 Town ID 或 Being 名与配对码。`;
          throw new Error(detail ? `${label} ${detail}` : label);
        }
        let data: Record<string, unknown>;
        try { data = await readTownJson(response); } catch { throw new Error('配对响应格式不正确，请稍后重试。'); }
        if (data.ok !== true || typeof data.token !== 'string' || !/^[a-zA-Z0-9._~-]{16,2048}$/.test(data.token)) throw new Error('配对未成功，请核对 Being 名与配对码。');
        if (data.town_id !== undefined && (!validTownIdentity(data.town_id) || !data.town_id.startsWith('t_'))) throw new Error('配对返回的 Town ID 无效。');
        // The server resolves a unique, case-sensitive Town ID prefix. Store its full ID.
        if (townIdInput ? typeof data.town_id !== 'string' || !data.town_id.startsWith(beingId) : data.being_id !== undefined && data.being_id !== beingId) throw new Error('配对返回的 Being 身份不匹配。');
        const display = normalizeTownDisplay(data.display_name || data.speaker_name || data.display);
        return { token: data.token, beingId: typeof data.town_id === 'string' ? data.town_id : beingId, ...(display ? { display } : {}) };
      }, traceId);
      return request.value;
    } catch (error) {
      if (!(error instanceof TownRequestFailure)) throw error;
      const message = error.status === undefined
        ? '配对请求未完成，请检查网络；若配对码已失效，请获取新码。'
        : error.reason instanceof Error ? error.reason.message : '配对请求失败。';
      throw new Error(`${message}\nTrace ID：${error.traceId}`);
    }
  }
  async send(input: TownPost, traceId?: string): Promise<TownResult> {
    const token = this.getToken();
    if (!token) return { ok: false, code: 'auth', message: '请先配对 Town。' };
    if (!input || typeof input.content !== 'string' || !input.content.trim()) throw new Error('请输入要发送的内容。');
    const limit = input.kind === 'bonfire' ? 4000 : 32000;
    if ([...input.content].length > limit) throw new Error(`内容不能超过 ${limit} 字。`);
    let route: string, body: Record<string, unknown>;
    if (input.replyTo !== undefined) {
      if (input.kind === 'dm' ? typeof input.replyTo !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(input.replyTo) : typeof input.replyTo !== 'number' || !Number.isSafeInteger(input.replyTo) || input.replyTo < 1) throw new Error('回复目标无效，请重新选择消息。');
    }
    if (input.kind === 'bonfire') { route = '/api/bonfire/speak'; body = { message: input.content }; }
    else if (input.kind === 'dm') {
      if (typeof input.recipient !== 'string' || !input.recipient.trim() || input.recipient.length > 160) throw new Error('请输入收件 Being 的 Town ID 或准确显示名。');
      if (input.recipient.trim() === this.getBeingId()) throw new Error('不能给当前 Being 自己发送私信，请选择其他收件人。');
      route = '/api/messages'; body = { recipient: input.recipient.trim(), content: input.content };
    } else if (input.kind === 'fireside') {
      if (typeof input.firesideId !== 'string' || !/^\d{1,16}$/.test(input.firesideId) || !Number.isSafeInteger(Number(input.firesideId)) || Number(input.firesideId) < 1) throw new Error('请选择有效的围炉。');
      route = '/api/fireside/speak'; body = { fireside_id: Number(input.firesideId), message: input.content };
    } else throw new Error('不支持的发送请求。');
    if (input.replyTo !== undefined) body.reply_to = input.replyTo;
    try {
      const request = await this.request(route, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000) }, async response => {
        if (!response.ok) return await townError(response, token);
        const data = await readTownJson(response);
        if (data.ok !== true) throw new Error('unconfirmed');
        const warnings = Array.isArray(data.mention_warnings)
          ? data.mention_warnings.slice(0, 20).map(value => cleanTownDetail(townWarning(value), [token])).filter(Boolean)
          : [];
        return { ok: true, data, fetchedAt: new Date().toISOString(), ...(warnings.length ? { warnings } : {}) } as TownResult;
      }, traceId);
      return tracedFailure(request.value, request.traceId);
    } catch (error) {
      const id = error instanceof TownRequestFailure ? error.traceId : validTownTraceId(traceId) ? traceId : createTownTraceId();
      return tracedFailure({ ok: false, code: 'network', message: '未收到发送确认。消息可能已送达，请刷新内容核对后再决定是否重发。' }, id);
    }
  }
  async query(query: TownQuery, traceId?: string, signal?: AbortSignal): Promise<TownResult> {
    if (query?.kind === 'my-scrolls' && (!this.getToken() || !this.getBeingId())) return { ok: false, code: 'auth', message: '请先用 Being 名和配对码连接 Town，再查看我的卷轴。' };
    const route = townRoute(query, this.getBeingId());
    const headers: Record<string, string> = { Accept: 'application/json' };
    const identity=this.getToken();
    if (identity!==this.cacheIdentity) {this.conditionalCache.clear();this.cacheIdentity=identity;}
    const cacheable=['scrolls','my-scrolls','embers','seeds','scroll','ember','seed'].includes(query.kind);
    const cached=cacheable ? this.conditionalCache.get(route.route) : undefined;
    if (cached?.etag) headers['If-None-Match']=cached.etag;
    else if (cached?.modified) headers['If-Modified-Since']=cached.modified;
    // Loom/relay credentials are never used here. Public content needs no credentials.
    const url = new URL(this.origin + route.route);
    const token = this.getToken();
    if (route.private && token) {
      headers.Authorization = `Bearer ${token}`;
    }
    try {
      const request = await this.request(url.pathname + url.search, {
        headers, method: 'GET', credentials: 'omit', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      }, async response => {
        if (response.status===304 && cached) return {ok:true,data:cached.data,fetchedAt:new Date().toISOString()} as TownResult;
        if (!response.ok) return await townError(response, token);
        const data = query.kind === 'fireside-members'
          ? await readTownMembersJson(response)
          : await readTownJson(response);
        if (cacheable && identity===this.getToken()) {
          const etag=response.headers.get('etag') || '', modified=response.headers.get('last-modified') || '';
          this.conditionalCache.delete(route.route);
          const noStore = /(?:^|,)\s*no-store\s*(?:,|$)/i.test(response.headers.get('cache-control') || '');
          if (!noStore && (etag || modified)) {
            this.conditionalCache.set(route.route,{etag,modified,data});
            if (this.conditionalCache.size>24) this.conditionalCache.delete(this.conditionalCache.keys().next().value!);
          }
        }
        return { ok: true, data, fetchedAt: new Date().toISOString() } as TownResult;
      }, traceId);
      return tracedFailure(request.value, request.traceId);
    } catch (error) {
      const reason = error instanceof TownRequestFailure ? error.reason : error;
      const failure = reason instanceof TownReadError ? reason.kind : isTimeout(reason) ? 'timeout' : 'network';
      const message = failure === 'timeout'
        ? '读取 Town 超时（20 秒），请稍后重试。'
        : failure === 'too-large'
          ? 'Town 返回的消息过大，客户端已停止读取。请减少返回条数或联系服务端限制响应大小。'
          : failure === 'format'
            ? 'Town 返回的数据格式不正确，请稍后重试。'
            : '未能读取 Town。请检查网络后重试。';
      const id = error instanceof TownRequestFailure ? error.traceId : validTownTraceId(traceId) ? traceId : createTownTraceId();
      return tracedFailure({ ok: false, code: failure, message }, id);
    }
  }
}

class TownReadError extends Error {
  constructor(readonly kind: 'format' | 'too-large', readonly bytes?: number) { super(kind); this.name = 'TownReadError'; }
}
function isTimeout(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'name' in error &&
    ((error as { name?: unknown }).name === 'TimeoutError' || (error as { name?: unknown }).name === 'AbortError'));
}

async function readTownJsonValue(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); throw new TownReadError('format'); }
  const reader = response.body?.getReader();
  if (!reader) throw new TownReadError('format');
  const chunks: Uint8Array[] = []; let bytes = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw new TownReadError('too-large', bytes); }
    chunks.push(value);
  }
  try { return JSON.parse(new TextDecoder().decode(joinBytes(chunks, bytes))) as unknown; }
  catch { throw new TownReadError('format', bytes); }
}

async function readTownJson(response: Response): Promise<Record<string, unknown>> {
  const data = await readTownJsonValue(response);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('format');
  return data as Record<string, unknown>;
}

async function readTownMembersJson(response: Response): Promise<Record<string, unknown>> {
  const data = await readTownJsonValue(response);
  if (Array.isArray(data)) return { members: data };
  if (data && typeof data === 'object') {
    const object = data as Record<string, unknown>;
    if (Array.isArray(object.members)) return object;
  }
  throw new Error('format');
}

const townObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const townText = (value: unknown) => typeof value === 'string' ? value.slice(0, 400) : '';
function townWarning(value: unknown): string {
  const warning = townObject(value);
  const candidates = Array.isArray(warning.candidates) ? warning.candidates.slice(0, 8).map(value => {
    const candidate = townObject(value);
    const townId = typeof value === 'string' ? value : candidate.town_id;
    if (!validTownIdentity(townId) || !townId.startsWith('t_')) return '';
    const name = townText(candidate.display || candidate.display_name || candidate.name);
    return name ? `${name} · ${townId}` : townId;
  }).filter(Boolean) : [];
  return [townText(warning.token), townText(warning.reason), townText(warning.hint), candidates.length ? `候选：${candidates.join('；')}` : ''].filter(Boolean).join(' · ');
}
function cleanTownDetail(detail: string, secrets: string[]): string {
  for (const secret of secrets) if (secret) detail = detail.split(secret).join('[凭据已隐藏]');
  return detail.replace(/[a-f0-9]{64}/gi, '[凭据已隐藏]').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 1600);
}
async function townErrorDetail(response: Response, secrets: string[]): Promise<string> {
  try {
    const data = await readTownJson(response);
    return cleanTownDetail([townText(data.error), townText(data.hint), townWarning(data.recipient_warning), townWarning({ candidates: data.candidates })].filter(Boolean).join(' · '), secrets);
  } catch { return ''; }
}
async function townError(response: Response, token: string): Promise<TownResult> {
  const status = response.status;
  const code = status === 401 ? 'auth' : status === 403 ? 'forbidden' : status === 404 ? 'not-found' : 'http';
  const label = status === 401 ? 'Town 凭据无效或已失效，请重新配对。' : status === 403 ? '当前 Being 无权访问此内容或执行此操作。' : status === 404 ? '内容或收件 Being 不存在，请核对后重试。' : `Town 请求失败（HTTP ${status}）。`;
  const detail = await townErrorDetail(response, [token]);
  return { ok: false, code, message: detail ? `${label} ${detail}` : label };
}

function joinBytes(chunks: Uint8Array[], length: number) {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

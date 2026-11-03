import { net, type Session } from 'electron';
import WebSocket from 'ws';
import { HOME_ORIGIN } from './protocol';
import type { BrowserInput, BrowserState, ViewerEvent } from '../../shared/home-viewer';
const MAX_PACKET = 16 * 1024 * 1024;
export class ViewerExpired extends Error {}
export function validateInput(value: unknown, state: BrowserState): BrowserInput {
  if (!value || typeof value !== 'object') throw new Error('无效操作。');
  const p = value as Record<string, unknown>;
  const prefix = state.view_mode === 'native' ? 'native_' : '';
  const point = () => {
    const width = state.view_mode === 'native' ? state.frame_width : 1280;
    const height = state.view_mode === 'native' ? state.frame_height : 720;
    if (!Number.isSafeInteger(p.x) || !Number.isSafeInteger(p.y) || (p.x as number) < 0 || (p.y as number) < 0 ||
      (p.x as number) >= width || (p.y as number) >= height) throw new Error('画面尺寸已变化，请重新操作。');
    return { x: p.x as number, y: p.y as number };
  };
  if (p.action === prefix + 'click') {
    if (p.button !== undefined && ![1, 2, 3].includes(p.button as number)) throw new Error('无效鼠标操作。');
    return { action: p.action as 'click', ...point(), ...(p.button ? { button: p.button as number } : {}) };
  }
  if (p.action === prefix + 'scroll' && typeof p.delta_y === 'number' && Number.isFinite(p.delta_y) && Math.abs(p.delta_y) <= 1800)
    return { action: p.action as 'scroll', ...(prefix ? point() : {}), delta_y: p.delta_y };
  if (p.action === prefix + 'type' && typeof p.text === 'string' && p.text.length > 0 && p.text.length <= 4000)
    return { action: p.action as 'type', text: p.text };
  if (p.action === prefix + 'key' && typeof p.key === 'string' && p.key.length > 0 && p.key.length <= 40 &&
    Number.isInteger(p.modifiers) && (p.modifiers as number) >= 0 && (p.modifiers as number) <= 15)
    return { action: p.action as 'key', key: p.key, modifiers: p.modifiers as number };
  throw new Error('不支持的浏览器操作。');
}
/** Private desktop-cookie protocol. Only this trusted layer can see credentials. */
export class HomeTransport {
  private closed = false;
  private abort = new AbortController();
  private socket?: WebSocket;
  private streamId = 0;
  private sequence = 0;
  private outstanding = new Map<number, number>();
  private bytes = 0;
  private ackTimer?: ReturnType<typeof setTimeout>;
  private state?: BrowserState;
  private leaseDeadline = 0;
  private leaseAllowed = false;
  private controlVersion = 0;
  private active = false;
  private inputVersion = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private base: string;
  constructor(private jar: Session, id: string, private emit: (event: ViewerEvent) => void,
    private expired: () => void, private origin = HOME_ORIGIN) {
    if (!/^[\w-]+$/.test(id)) throw new Error('无效电脑标识。');
    this.base = `${origin}/desktop/${id}/browser/`;
  }
  async exchange(url: string) {
    const target = new URL(url);
    if (target.origin !== this.origin || target.pathname !== '/desktop/connect' || !target.searchParams.get('ticket')) throw new Error('无效票据地址。');
    // Electron fetch rejects a manually cancelled redirect. Consume only the
    // exchange headers with net.request; never follow it to remote HTML.
    const exchange = await new Promise<{ status: number; location: string }>((resolve, reject) => {
      const request = net.request({ url, session: this.jar, redirect: 'manual', useSessionCookies: true });
      let settled = false;
      const finish = () => { settled = true; clearTimeout(timer); this.abort.signal.removeEventListener('abort', cancel); };
      const cancel = () => { if (!settled) { finish(); request.abort(); reject(new Error('连接已取消。')); } };
      const timer = setTimeout(cancel, 15_000);
      this.abort.signal.addEventListener('abort', cancel, { once: true });
      request.on('redirect', (status, _method, location) => {
        if (settled) return;
        finish(); resolve({ status, location }); request.abort();
      });
      request.on('response', () => { if (!settled) { finish(); request.abort(); reject(new ViewerExpired('查看会话已过期。')); } });
      request.on('error', () => { if (!settled) { finish(); reject(new Error('无法连接云电脑。')); } });
      request.end();
    });
    if (![302, 303].includes(exchange.status) || new URL(exchange.location, this.origin).href !== this.base.replace(/browser\/$/, ''))
      throw new ViewerExpired('电脑状态已变化。');
    const cookies = await this.jar.cookies.get({ url: this.base });
    if (!cookies.some(cookie => cookie.name === 'bh_desktop' && cookie.httpOnly && cookie.secure && cookie.sameSite === 'strict' && (cookie.expirationDate ?? 0) > Date.now() / 1000)) throw new ViewerExpired('无法建立查看会话。');
    if (this.closed) throw new ViewerExpired('查看会话已关闭。');
  }
  private async request(route: string, body?: unknown): Promise<Response> {
    if (this.closed) throw new ViewerExpired('查看会话已关闭。');
    const response = await this.jar.fetch(this.base + route, {
      credentials: 'include', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15_000)]),
      headers: { Origin: this.origin, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    });
    if (this.closed) throw new ViewerExpired('查看会话已关闭。');
    if ([401, 403, 410].includes(response.status)) { this.expired(); throw new ViewerExpired('查看会话已过期，请重新打开。'); }
    if (!response.ok) {
      if (body) this.cancelInput();
      throw new Error(response.status === 409 ? '控制状态已变化，请确认画面后重新接管。' : '连接暂时中断，请查看画面后重试。');
    }
    return response;
  }
  private accept(raw: any): BrowserState {
    if (!raw || typeof raw.ready !== 'boolean' || typeof raw.can_control !== 'boolean') throw new Error('无法读取浏览器状态。');
    // Do not send tab URLs or any server-provided arbitrary fields across IPC.
    this.state = { ready: raw.ready, can_control: raw.can_control, controlled_elsewhere: raw.controller === 'human' && !raw.can_control, controller: String(raw.controller),
      lease_remaining_seconds: Number(raw.lease_remaining_seconds) || 0, view_mode: raw.view_mode === 'native' ? 'native' : 'page',
      frame_width: Number(raw.frame_width), frame_height: Number(raw.frame_height),
      ...(raw.live_view !== undefined ? { live_view: { available: raw.live_view?.available === true, protocol: String(raw.live_view?.protocol) } } : {}) };
    if (!this.state.can_control) this.cancelInput();
    this.leaseDeadline = Date.now() + Math.max(0, Math.min(120, this.state.lease_remaining_seconds)) * 1000;
    return { ...this.state, can_control: this.state.can_control && this.leaseAllowed && this.active };
  }
  async read() {
    const version = this.controlVersion;
    try {
      const raw = await (await this.request('state')).json();
      if (version !== this.controlVersion && this.state) return { ...this.state, can_control: this.state.can_control && this.leaseAllowed && this.active };
      return this.accept(raw);
    } catch (error) { this.cancelInput(); throw error; }
  }
  async control(action: unknown) {
    if (!['claim', 'renew', 'release'].includes(action as string) || (action !== 'release' && !this.active)) throw new Error('请先展开放大画面。');
    if (action === 'renew' && !this.leaseAllowed) throw new Error('请重新接管浏览器。');
    const version = ++this.controlVersion;
    // A renewal extends an existing lease; it must not discard typing already
    // queued by this viewer. Claims/releases deliberately invalidate old input.
    if (action !== 'renew') this.cancelInput();
    try {
      const raw = await (await this.request('control', { action })).json();
      if (version !== this.controlVersion || (action !== 'release' && !this.active)) {
        if (!this.closed && !this.active && action !== 'release' && raw.can_control)
          await this.request('control', { action: 'release' }).catch(() => {});
        throw new Error('控制操作已取消。');
      }
      this.leaseAllowed = action !== 'release' && raw.can_control === true;
      return this.accept(raw);
    } catch (error) { if (version === this.controlVersion) this.cancelInput(); throw error; }
  }
  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active;
    if (!active) {
      this.controlVersion++;
      const release = this.state?.can_control;
      this.cancelInput();
      if (release) void this.control('release').catch(() => {});
    }
  }
  private cancelInput() { this.inputVersion++; this.leaseAllowed = false; }
  async input(value: unknown) {
    if (!this.active || !this.leaseAllowed || !this.state?.can_control || this.leaseDeadline <= Date.now()) throw new Error('请先接管浏览器。');
    if (this.queued >= 32) { this.cancelInput(); throw new Error('输入过快，请确认画面后重新接管。'); }
    const input = validateInput(value, this.state), version = this.inputVersion;
    this.queued++;
    const next = this.queue.catch(() => {}).then(async () => {
      if (this.closed || version !== this.inputVersion || !this.active || !this.leaseAllowed || this.leaseDeadline <= Date.now()) throw new Error('输入已取消。');
      const raw = await (await this.request('action', input)).json();
      if (version !== this.inputVersion || !this.active) throw new Error('输入已取消。');
      return this.accept(raw);
    }).catch(error => { this.cancelInput(); throw error; }).finally(() => { this.queued--; });
    this.queue = next; return next;
  }
  async frame() {
    if (!this.state || this.state.live_view !== undefined) throw new Error('当前实例应使用实时画面流。');
    const response = await this.request('frame');
    if (!response.headers.get('content-type')?.startsWith('image/jpeg')) throw new Error('无效兼容画面。');
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength > MAX_PACKET) throw new Error('画面过大。');
    return data;
  }
  async connect() {
    this.disconnect();
    const id = this.streamId;
    if (!this.state?.ready || !this.state.live_view?.available || this.state.live_view.protocol !== 'rfb') throw new Error('实时画面暂不可用。');
    const cookies = await this.jar.cookies.get({ url: this.base });
    if (this.closed || id !== this.streamId) throw new Error('连接已取消。');
    const cookie = cookies.filter(c => c.name === 'bh_desktop').map(c => `${c.name}=${c.value}`).join('; ');
    if (!cookie) { this.expired(); throw new ViewerExpired('查看会话已过期。'); }
    const socket = new WebSocket(this.base.replace(/^https:/, 'wss:') + 'stream', {
      headers: { Cookie: cookie, Origin: this.origin, 'Sec-Fetch-Site': 'same-origin' },
      maxPayload: MAX_PACKET, handshakeTimeout: 15_000, perMessageDeflate: false, followRedirects: false,
    });
    this.socket = socket;
    const current = () => !this.closed && this.socket === socket && this.streamId === id;
    socket.on('open', () => { if (current()) this.emit({ type: 'stream', id, kind: 'open' }); });
    socket.on('message', (raw, binary) => {
      if (!current()) return;
      const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      if (!binary || this.bytes + data.byteLength > MAX_PACKET) { socket.close(1009); return; }
      const sequence = ++this.sequence;
      this.outstanding.set(sequence, data.byteLength); this.bytes += data.byteLength;
      if (this.bytes >= 2 * 1024 * 1024) socket.pause();
      if (!this.ackTimer) this.ackTimer = setTimeout(() => { if (current()) socket.terminate(); }, 15_000);
      this.emit({ type: 'stream', id, kind: 'data', sequence, data: new Uint8Array(data) });
    });
    socket.on('unexpected-response', (_request, response) => {
      if (current() && [401, 403, 410].includes(response.statusCode || 0)) this.expired();
      response.destroy(); socket.terminate();
    });
    socket.on('error', () => { /* close carries the credential-free result */ });
    socket.on('close', code => {
      if (!current()) return;
      this.cancelInput(); this.clearPending();
      if (code === 4001) this.expired();
      else this.emit({ type: 'stream', id, kind: 'close', code });
    });
    return id;
  }
  send(id: number, data: unknown) {
    if (id !== this.streamId || this.socket?.readyState !== WebSocket.OPEN) return;
    if (!(data instanceof Uint8Array) || data.byteLength > 64 * 1024 || this.socket.bufferedAmount > 256 * 1024) { this.disconnect(); return; }
    this.socket.send(data);
  }
  ack(id: number, sequence: number) {
    if (id !== this.streamId) return;
    const size = this.outstanding.get(sequence); if (size === undefined) return;
    this.outstanding.delete(sequence); this.bytes -= size;
    clearTimeout(this.ackTimer); this.ackTimer = undefined;
    if (this.bytes) this.ackTimer = setTimeout(() => this.socket?.terminate(), 15_000);
    if (this.bytes < 2 * 1024 * 1024) this.socket?.resume();
  }
  private clearPending() { this.outstanding.clear(); this.bytes = 0; clearTimeout(this.ackTimer); this.ackTimer = undefined; }
  disconnect() {
    this.streamId++; this.cancelInput();
    const socket = this.socket; this.socket = undefined; socket?.terminate(); this.clearPending();
  }
  async close() {
    if (this.closed) return;
    const release = this.state?.can_control;
    this.closed = true; this.active = false; this.controlVersion++; this.abort.abort(); this.disconnect();
    if (release) await this.jar.fetch(this.base + 'control', {
      method: 'POST', credentials: 'include', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(3000),
      headers: { Origin: this.origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'release' }),
    }).catch(() => {});
  }
}

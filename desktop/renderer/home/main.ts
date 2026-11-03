import RFB from '@novnc/novnc/lib/rfb.js';
import type { BrowserState, BrowserInput, ViewerAPI, ViewerEvent } from '../../shared/home-viewer';
import { framePoint, keyModifiers } from './input';
const api = (window as unknown as { homeViewer: ViewerAPI }).homeViewer;
const screen = document.querySelector<HTMLDivElement>('#screen')!;
const viewport = document.querySelector<HTMLDivElement>('#viewport')!;
const frame = document.querySelector<HTMLImageElement>('#frame')!;
const loader = document.querySelector<HTMLDivElement>('#loading')!;
const loadingText = document.querySelector<HTMLSpanElement>('#loading-text')!;
const status = document.querySelector<HTMLSpanElement>('#status')!;
const control = document.querySelector<HTMLButtonElement>('#control')!;
const keyboard = document.querySelector<HTMLTextAreaElement>('#keyboard')!;
const notice = document.querySelector<HTMLDivElement>('#notice')!;
let state: BrowserState | undefined;
let preview = true, visible = false, live = false, composing = false, busy = false, stopped = false;
let rfb: RFB | undefined, channel: Channel | undefined;
let reconnect: ReturnType<typeof setTimeout> | undefined, pollTimer: ReturnType<typeof setTimeout> | undefined;
let retry = 0, epoch = 0, lastRenew = 0, frameURL: string | undefined;
let mode: 'stream' | 'snapshot' | 'unavailable' | undefined;
let inputEpoch = 0;
let fitFrame = 0;
// Reparenting a native view can coalesce resize notifications. Reapply noVNC's
// public fit API after layout settles, including presentation and zoom changes.
function fitViewport() {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => { if (rfb) rfb.scaleViewport = true; });
}
const viewportResize = new ResizeObserver(fitViewport);
viewportResize.observe(viewport);
window.addEventListener('resize', fitViewport);
class Channel {
  id = -1; readyState = 0; protocol = ''; binaryType = 'arraybuffer';
  onopen = (_event: Event) => {}; onclose = (_event: CloseEvent) => {};
  onerror = (_event: Event) => {}; onmessage = (_event: MessageEvent) => {};
  private pending: Extract<ViewerEvent, { type: 'stream' }>[] = [];
  constructor() {
    void api.request('connect').then(id => {
      if (this.readyState === 3) return;
      this.id = id;
      for (const event of this.pending) this.receive(event);
      this.pending = [];
    }).catch(() => this.finish());
  }
  receive(event: Extract<ViewerEvent, { type: 'stream' }>) {
    if (this.id === -1) { this.pending.push(event); return; }
    if (event.id !== this.id || this.readyState === 3) return;
    if (event.kind === 'open') { this.readyState = 1; this.onopen(new Event('open')); }
    if (event.kind === 'close') this.finish();
    if (event.kind === 'data' && event.data) {
      try { this.onmessage(new MessageEvent('message', { data: new Uint8Array(event.data).buffer })); }
      finally { api.ack(this.id, event.sequence!); }
    }
  }
  send(data: Uint8Array) { if (this.readyState === 1) api.send(this.id, new Uint8Array(data)); }
  close() { if (this.readyState === 3) return; void api.request('disconnect').catch(() => {}); this.finish(); }
  private finish() { if (this.readyState === 3) return; this.readyState = 3; this.onclose(new CloseEvent('close', { code: 1006 })); }
}
function clearInput() { inputEpoch++; composing = false; keyboard.value = ''; keyboard.blur(); }
function render() {
  const controlling = !!state?.can_control && !preview && visible && live;
  document.body.classList.toggle('controlling', controlling);
  control.textContent = controlling ? '交还 Being' : '接管浏览器';
  control.disabled = busy || !state?.ready || !live || !!state.controlled_elsewhere;
  status.textContent = controlling ? '由你接管' : state?.controlled_elsewhere ? '其他窗口接管中' : '仅观看';
  keyboard.disabled = !controlling;
}
function loading(text: string) {
  live = false; clearInput(); loader.hidden = false; loadingText.textContent = text; render();
}
function painted() { live = true; retry = 0; loader.hidden = true; notice.hidden = true; void api.request('painted'); render(); }
function showError() { notice.textContent = '操作未确认，请查看画面后重试。'; notice.hidden = false; clearInput(); }
function background() { return getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(); }
function stopStream() {
  epoch++; clearTimeout(reconnect); reconnect = undefined;
  const previous = rfb; rfb = undefined; previous?.disconnect(); channel?.close(); channel = undefined;
  screen.replaceChildren(); frame.hidden = true; frame.removeAttribute('src');
  if (frameURL) URL.revokeObjectURL(frameURL); frameURL = undefined;
  live = false; clearInput();
}
function startStream() {
  if (stopped || rfb || reconnect || mode !== 'stream') return;
  loading(retry ? '正在重新连接…' : '正在连接…');
  const current = epoch;
  channel = new Channel();
  const viewer = new RFB(screen, channel, { shared: true });
  rfb = viewer;
  viewer.viewOnly = true; viewer.focusOnClick = false; viewer.scaleViewport = true;
  viewer.resizeSession = false; viewer.showDotCursor = false; viewer.background = background();
  viewer.addEventListener('connect', () => {
    if (current !== epoch || rfb !== viewer) return;
    const canvas = screen.querySelector('canvas');
    if (canvas) { canvas.tabIndex = -1; canvas.setAttribute('aria-hidden', 'true'); }
    fitViewport(); painted();
  });
  viewer.addEventListener('disconnect', () => {
    if (current !== epoch || rfb !== viewer) return;
    rfb = undefined; screen.replaceChildren(); loading('正在重新连接…');
    reconnect = setTimeout(() => { reconnect = undefined; void poll(); }, Math.min(15_000, 1000 * 2 ** Math.min(retry++, 4)));
  });
}
async function snapshot(current: number) {
  if (stopped || current !== epoch || mode !== 'snapshot') return;
  try {
    const data = await api.request('frame');
    if (current !== epoch) return;
    const next = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'image/jpeg' }));
    const image = new Image(); image.src = next;
    try { await image.decode(); } catch (error) { URL.revokeObjectURL(next); throw error; }
    if (current !== epoch) { URL.revokeObjectURL(next); return; }
    frame.src = next; frame.hidden = false;
    if (frameURL) URL.revokeObjectURL(frameURL); frameURL = next; painted();
  } catch { if (current === epoch) loading('正在重新连接…'); }
  if (current === epoch) reconnect = setTimeout(() => { reconnect = undefined; void snapshot(current); }, live ? 500 : 3000);
}
function accept(next: BrowserState) {
  state = next;
  if (!next.can_control) clearInput();
  const nextMode = !next.ready ? 'unavailable' : next.live_view === undefined ? 'snapshot'
    : next.live_view.available && next.live_view.protocol === 'rfb' ? 'stream' : 'unavailable';
  if (nextMode !== mode) { stopStream(); mode = nextMode; if (mode === 'snapshot') void snapshot(epoch); }
  if (mode === 'stream') startStream();
  if (mode === 'unavailable') loading('正在准备画面…');
  render();
}
let polling = false;
async function poll() {
  if (stopped || polling) return;
  polling = true; clearTimeout(pollTimer);
  try {
    accept(await api.request('state'));
    if (!preview && visible && live && state?.can_control && Date.now() - lastRenew > 25_000) {
      accept(await api.request('control', 'renew')); lastRenew = Date.now();
    }
  } catch { stopStream(); mode = undefined; loading('正在重新连接…'); }
  finally { polling = false; if (!stopped) pollTimer = setTimeout(() => void poll(), visible ? 2000 : 10_000); }
}
control.addEventListener('click', async () => {
  if (busy) return; busy = true; render();
  try { accept(await api.request('control', state?.can_control ? 'release' : 'claim')); lastRenew = Date.now(); }
  catch { showError(); await poll(); }
  finally { busy = false; render(); }
});
document.querySelector('#expand')!.addEventListener('click', () => void api.request('expand'));
api.subscribe(event => {
  if (event.type === 'stream') { channel?.receive(event); return; }
  const changed = preview !== event.preview || visible !== event.visible;
  preview = event.preview; visible = event.visible;
  document.body.classList.toggle('preview', preview);
  document.documentElement.dataset.theme = event.dark ? 'dark' : 'light';
  if (rfb) rfb.background = background();
  fitViewport();
  if (changed) { clearInput(); if (state) state.can_control = false; void poll(); }
  render();
});
function input(value: BrowserInput) {
  if (!visible || preview || !live || !state?.can_control) return;
  const version = inputEpoch;
  void api.request('input', value).then(next => { if (version === inputEpoch) accept(next); }).catch(() => { showError(); void poll(); });
}
function point(event: MouseEvent) {
  const surface = mode === 'stream' ? screen.querySelector('canvas') : frame;
  if (!surface || !state) return null;
  const bounds = surface.getBoundingClientRect();
  return framePoint(event.clientX, event.clientY, bounds, state, {
    width: surface instanceof HTMLImageElement ? surface.naturalWidth : surface.width,
    height: surface instanceof HTMLImageElement ? surface.naturalHeight : surface.height,
  });
}
viewport.addEventListener('click', event => {
  if (!state?.can_control || preview) return;
  const p = point(event); if (!p) return;
  input({ action: state.view_mode === 'native' ? 'native_click' : 'click', ...p });
  keyboard.focus({ preventScroll: true });
});
viewport.addEventListener('contextmenu', event => {
  event.preventDefault(); if (!state?.can_control || state.view_mode !== 'native') return;
  const p = point(event); if (p) input({ action: 'native_click', button: 3, ...p });
  keyboard.focus({ preventScroll: true });
});
let scrollTimer: ReturnType<typeof setTimeout> | undefined, delta = 0, scrollPoint: { x: number; y: number } | null;
viewport.addEventListener('wheel', event => {
  if (!state?.can_control || preview || !live) return;
  event.preventDefault(); scrollPoint = point(event); if (!scrollPoint) return;
  delta = Math.max(-1800, Math.min(1800, delta + event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1)));
  if (!scrollTimer) {
    const version = inputEpoch;
    scrollTimer = setTimeout(() => {
      scrollTimer = undefined;
      if (version === inputEpoch && scrollPoint) input({ action: state?.view_mode === 'native' ? 'native_scroll' : 'scroll', ...scrollPoint, delta_y: Math.round(delta) });
      delta = 0;
    }, 80);
  }
}, { passive: false });
function sendText(value: string) {
  if (value.length > 4000) {
    notice.textContent = '一次最多输入 4000 个字符，请分段粘贴。'; notice.hidden = false;
    return;
  }
  if (value) input({ action: state?.view_mode === 'native' ? 'native_type' : 'type', text: value });
}
function text() {
  const value = keyboard.value; keyboard.value = '';
  sendText(value);
}
keyboard.addEventListener('compositionstart', () => { composing = true; });
keyboard.addEventListener('compositionend', () => { composing = false; text(); });
keyboard.addEventListener('input', event => { if (!composing && !(event as InputEvent).isComposing) text(); });
keyboard.addEventListener('keydown', event => {
  if (event.isComposing || ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
  if ((((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') || (event.shiftKey && event.key === 'Insert')) && !event.altKey) return;
  if (event.key.length > 1 || event.ctrlKey || event.metaKey || event.altKey) {
    event.preventDefault(); event.stopPropagation();
    input({ action: state?.view_mode === 'native' ? 'native_key' : 'key', key: event.key, modifiers: keyModifiers(event, state?.view_mode === 'native') });
  }
});
keyboard.addEventListener('paste', event => {
  event.preventDefault(); const value = event.clipboardData?.getData('text/plain');
  if (value) sendText(value);
});
window.addEventListener('pagehide', () => { viewportResize.disconnect(); cancelAnimationFrame(fitFrame); stopped = true; clearTimeout(pollTimer); clearTimeout(scrollTimer); stopStream(); });
void api.request('ready').then(() => poll());

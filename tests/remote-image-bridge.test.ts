import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerRemoteImageBridge, requestRemoteImage } from '../desktop/renderer/shared/services/remote-image-bridge';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const src = 'https://images.example/image?token=original';

describe('generated image transfer between chat and shell', () => {
  it('fetches once for duplicate cards, validates the active sender and transfers original bytes', async () => {
    const parent = {}, window = Object.assign(new EventTarget(), { parent });
    vi.stubGlobal('window', window); vi.stubGlobal('location', {search:'?revision=current'});
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([137,80,78,71]), {headers:{'Content-Type':'image/png'}}));
    vi.stubGlobal('fetch', fetcher);
    const release = registerRemoteImageBridge(src), releaseDuplicate = registerRemoteImageBridge(src);
    const send = (data = {}, envelope = {}) => {
      const port = {postMessage:vi.fn(),close:vi.fn(),onmessage:null};
      const event = Object.assign(new Event('message'), {source:parent,origin:'http://localhost:5173',ports:[port],
        data:{type:'beings:remote-image-content',src,revision:'current',...data},...envelope});
      window.dispatchEvent(event); return port;
    };
    try {
      send({revision:'stale'}); send({src:'https://other.example/image'}); send({}, {origin:'https://untrusted.example'}); send({}, {source:{}});
      expect(fetcher).not.toHaveBeenCalled();
      const port = send();
      await vi.waitFor(() => expect(port.close).toHaveBeenCalled());
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toBe('/api/remote-image?' + new URLSearchParams({url:src}));
      const blob = port.postMessage.mock.calls[0][0].blob;
      expect(blob.type).toBe('image/png'); expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([137,80,78,71]));
      release(); release(); send(); expect(fetcher).toHaveBeenCalledTimes(2);
      releaseDuplicate(); send(); expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { release(); releaseDuplicate(); }
  });

  function setup() {
    vi.useFakeTimers();
    let channel: any;
    vi.stubGlobal('MessageChannel', class {
      port1 = {postMessage:vi.fn(),close:vi.fn(),onmessage:null,onmessageerror:null};
      port2 = {close:vi.fn()};
      constructor() { channel = this; }
    });
    const frame = {src:'beings://chat/?revision=current',contentWindow:{postMessage:vi.fn()}} as unknown as HTMLIFrameElement;
    const controller = new AbortController();
    const result = requestRemoteImage(frame, src, controller.signal);
    return {frame,controller,result,channel};
  }

  it('receives a validated image blob and releases the message channel', async () => {
    const {frame,result,channel} = setup();
    const blob = new Blob(['image bytes'], {type:'image/png'});
    channel.port1.onmessage({data:{blob}});
    expect(await result).toBe(blob); expect(channel.port1.close).toHaveBeenCalled();
    expect(frame.contentWindow!.postMessage).toHaveBeenCalledWith({type:'beings:remote-image-content',src,revision:'current'}, 'beings://chat', [channel.port2]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels in-flight image loading when the viewer closes', async () => {
    const {result,controller,channel} = setup();
    const rejected = expect(result).rejects.toMatchObject({name:'AbortError'});
    controller.abort(); await rejected;
    expect(channel.port1.postMessage).toHaveBeenCalledWith('abort'); expect(vi.getTimerCount()).toBe(0);
  });

  it('times out when a chat frame or card disappears', async () => {
    const {result,channel} = setup();
    const rejected = expect(result).rejects.toThrow('图片加载超时');
    await vi.advanceTimersByTimeAsync(65000); await rejected;
    expect(channel.port1.close).toHaveBeenCalled();
  });

  it('rejects non-image data returned over the bridge', async () => {
    const {result,channel} = setup();
    const rejected = expect(result).rejects.toThrow('图片暂时无法加载');
    channel.port1.onmessage({data:{blob:new Blob(['<script>'],{type:'text/html'})}}); await rejected;
    expect(channel.port1.close).toHaveBeenCalled();
  });
});

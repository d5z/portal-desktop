import { MAX_REMOTE_IMAGE_BYTES, REMOTE_IMAGE_MIME, remoteImageSource } from '../../../shared/remote-image';

const listeners = new Map<string, { count: number; receive(event: MessageEvent): void }>();

/** Read in the chat origin, then transfer bytes to the shell (including the Vite shell). */
export function registerRemoteImageBridge(src: string) {
  let entry = listeners.get(src);
  if (!entry) {
    const receive = (event: MessageEvent) => {
      const data = event.data, port = event.ports[0];
      if (event.source !== window.parent || !['beings://desktop', 'http://localhost:5173'].includes(event.origin) ||
          data?.type !== 'beings:remote-image-content' || data.src !== src || !port ||
          data.revision !== new URLSearchParams(location.search).get('revision')) return;
      const controller = new AbortController();
      port.onmessage = event => { if (event.data === 'abort') controller.abort(); };
      void fetch(remoteImageSource(src, true), { signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error('Image unavailable');
        const blob = await response.blob();
        if (!controller.signal.aborted) port.postMessage({ blob });
      }).catch(() => {
        if (!controller.signal.aborted) port.postMessage({ error: '图片暂时无法加载，请重试' });
      }).finally(() => port.close());
    };
    entry = { count: 0, receive }; listeners.set(src, entry); window.addEventListener('message', receive);
  }
  entry.count++;
  let released = false;
  return () => { if (released) return; released = true; if (--entry.count === 0) { window.removeEventListener('message', entry.receive); listeners.delete(src); } };
}

export function requestRemoteImage(frame: HTMLIFrameElement, src: string, signal: AbortSignal): Promise<Blob> {
  if (!frame.contentWindow || signal.aborted) return Promise.reject(new Error('图片预览已关闭'));
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); channel.port1.close(); channel.port2.close(); };
    const fail = (error: Error) => { channel.port1.postMessage('abort'); cleanup(); reject(error); };
    const abort = () => fail(new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => fail(new Error('图片加载超时，请重试')), 65000);
    signal.addEventListener('abort', abort, { once: true });
    channel.port1.onmessage = event => {
      const blob = event.data?.blob;
      if (!(blob instanceof Blob) || !REMOTE_IMAGE_MIME.test(blob.type) || blob.size > MAX_REMOTE_IMAGE_BYTES) {
        fail(new Error('图片暂时无法加载，请重试')); return;
      }
      cleanup(); resolve(blob);
    };
    channel.port1.onmessageerror = () => fail(new Error('无法读取图片，请重试'));
    try {
      frame.contentWindow!.postMessage({ type: 'beings:remote-image-content', src,
        revision: new URL(frame.src).searchParams.get('revision') }, 'beings://chat', [channel.port2]);
    } catch { fail(new Error('图片请求失败，请重试')); }
  });
}

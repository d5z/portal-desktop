import { net } from 'electron';
import type { Readable } from 'node:stream';

/** Preserve Chromium's proxy support while exposing redirects to the bundle allowlist. */
export const downloadFetch: typeof fetch = async (input, init) => {
  if (init?.redirect !== 'manual') return net.fetch(input as string, init);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if ((init.method || 'GET') !== 'GET' || init.body) throw new Error('安装包下载仅支持 GET。');
  const signal = init.signal;
  signal?.throwIfAborted();
  return new Promise<Response>((resolve, reject) => {
    // net.fetch rejects manual redirects instead of returning the 3xx response.
    // Return the redirect without following it; downloadBundle validates each hop.
    const request = net.request({ url, method: 'GET', redirect: 'manual', credentials: 'omit' });
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let finished = false;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const fail = (error: Error) => {
      if (finished) return;
      finished = true; cleanup();
      if (controller) controller.error(error);
      else reject(error);
      request.abort();
    };
    const abort = () => fail(signal?.reason || new DOMException('下载已取消。', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    request.on('error', fail);
    request.on('redirect', (status, _method, location) => {
      if (finished) return;
      finished = true; cleanup();
      resolve(new Response(null, { status, headers: { location } }));
      request.abort();
    });
    request.on('response', response => {
      if (finished) return;
      // Electron implements a Node Readable but its declarations omit these methods.
      const readable = response as typeof response & Readable;
      const headers = new Headers();
      for (const [key, values] of Object.entries(response.headers)) {
        for (const value of Array.isArray(values) ? values : [values]) if (value !== undefined) headers.append(key, value);
      }
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          controller = stream;
          response.on('end', () => { if (!finished) { finished = true; cleanup(); stream.close(); } });
          response.on('error', fail);
          response.on('aborted', () => fail(new Error('安装包下载中断。')));
          response.on('data', chunk => {
            if (finished) return;
            stream.enqueue(new Uint8Array(chunk));
            if ((stream.desiredSize || 0) <= 0) readable.pause();
          });
        },
        pull() { readable.resume(); },
        cancel() { finished = true; cleanup(); request.abort(); },
      });
      // Fetch Response forbids bodies for these statuses.
      if ([204, 205, 304].includes(response.statusCode)) {
        void body.cancel();
        resolve(new Response(null, { status: response.statusCode, headers }));
      } else resolve(new Response(body, { status: response.statusCode, headers }));
    });
    new Headers(init.headers).forEach((value, key) => request.setHeader(key, value));
    request.end();
  });
};

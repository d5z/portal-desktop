import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { remoteImage } from '../desktop/main/chat/remote-image';
import { MAX_REMOTE_IMAGE_BYTES, remoteImageName, remoteImageURL } from '../desktop/shared/remote-image';
import { Markdown } from '../desktop/renderer/shared/components/markdown';

const source = 'https://images.example/assets/123/view?token=signed&variant=original';
const request = (url = source, method = 'GET') => new Request('beings://desktop/api/remote-image?' + new URLSearchParams({ url }), { method });

describe('generated image previews', () => {
  it('makes Markdown images keyboard-accessible preview controls and preserves signed URLs', () => {
    const html = renderToStaticMarkup(createElement(Markdown, {
      content: `![生成的图片](${source.replace('&', '&amp;')})`, chat: true,
    }));
    expect(html).toContain('aria-label="预览 生成的图片"');
    expect(html).toContain('data-slot="image-thumbnail"');
    expect(html).toContain(`src="${source.replace('&', '&amp;')}"`);
  });

  it('keeps unsafe image protocols and raw HTML out of the rendering path', () => {
    for (const content of ['![x](javascript:alert%281%29)', '![x](file:///etc/passwd)', '<img src=x onerror=alert(1)>']) {
      expect(renderToStaticMarkup(createElement(Markdown, { content, chat: true }))).not.toContain('<img');
    }
  });

  it('returns original bytes through an HTTPS redirect without forwarding credentials', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/original.png?signature=abc' } }))
      .mockResolvedValueOnce(new Response(bytes, { headers: { 'Content-Type': 'image/png' } }));
    const response = await remoteImage(request(), fetcher);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([source, 'https://images.example/original.png?signature=abc']);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'manual', credentials: 'omit', headers: { Accept: 'image/*' } });
  });

  it.each(['http://images.example/a', 'file:///tmp/image.png', 'https://user:secret@images.example/a', 'data:image/png;base64,abc'])('rejects unsafe source %s before fetching', async url => {
    const fetcher = vi.fn();
    expect(remoteImageURL(url)).toBeUndefined();
    expect((await remoteImage(request(url), fetcher)).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects non-GET operations and unsafe redirects', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'file:///tmp/image.png' } }));
    expect((await remoteImage(request(source, 'POST'), fetcher)).status).toBe(405);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await remoteImage(request(), fetcher)).status).toBe(502);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each<Record<string, string>>([
    { 'Content-Type': 'text/html' },
    { 'Content-Type': 'image/svg+xml' },
    { 'Content-Type': 'image/png', 'Content-Length': String(MAX_REMOTE_IMAGE_BYTES + 1) },
  ])('rejects unsupported or oversized image responses', async headers => {
    const response = await remoteImage(request(), vi.fn<typeof fetch>().mockResolvedValue(new Response('not an image', { headers })));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('signed');
  });

  it('caps streamed bodies even when the server omits Content-Length', async () => {
    const cancel = vi.fn(), chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream({ pull(controller) { controller.enqueue(chunk); }, cancel });
    const response = await remoteImage(request(), vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'image/png' } })));
    expect(response.status).toBe(502);
    expect(cancel).toHaveBeenCalled();
  });

  it('uses the actual image type for a safe downloadable filename', () => {
    expect(remoteImageName('骑手/夜景.png', 'image/jpeg')).toBe('骑手_夜景.jpg');
    expect(remoteImageName('', 'image/webp')).toBe('图片.webp');
  });
});

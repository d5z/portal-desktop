import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { localFileReference } from '../desktop/shared/local-file';
import { LocalFilePreviews } from '../desktop/main/app/local-file-preview';
import { LocalFileAction } from '../desktop/renderer/shared/components/local-file-link';
import { Markdown } from '../desktop/renderer/shared/components/markdown';
import { stripClientMessageContext } from '../desktop/renderer/chat/services/local-file-context';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'being-preview-')); directories.push(root);
  const workspace = path.join(root, 'workspace'); await mkdir(workspace);
  return { root, workspace, previews: new LocalFilePreviews(() => workspace) };
}

describe('local file references', () => {
  it.each([
    ['/Users/test/页面 demo.html', '/Users/test/页面 demo.html'], ['reports/demo.html', 'reports/demo.html'],
    ['file:///Users/test/%E9%A1%B5%E9%9D%A2%20demo.html', '/Users/test/页面 demo.html'],
    ['C:\\Users\\test\\demo.html', 'C:\\Users\\test\\demo.html'], ['file:///C:/demo.html', 'C:/demo.html'],
    ['/tmp/demo.ts:12:4', '/tmp/demo.ts'], ['/tmp/demo.md#L12', '/tmp/demo.md'],
  ])('recognizes %s', (input, expected) => expect(localFileReference(input)).toBe(expected));
  it.each(['https://example.com/a.html', 'javascript:evil.html', 'data:text/html,a.html', '//host/a.html', '\\\\host\\a.html', 'file://server/a.html', '/tmp/a%00.html', 'hello', '/folder/', 'x\ny.html'])('rejects %s', input => expect(localFileReference(input)).toBeUndefined());
  it('does not decode literal percent filenames repeatedly across the bridge', () => {
    const path = localFileReference('file:///tmp/100%2525.html')!;
    expect(path).toBe('/tmp/100%25.html');
    expect(localFileReference(path)).toBe(path);
    expect(localFileReference('/tmp/demo%20page.html', true)).toBe('/tmp/demo page.html');
  });
  it('keeps paths inert until the host confirms availability, preserving ordinary web links', () => {
    const markdown = createElement(Markdown, { chat: true, content: '[预览](</tmp/页面 demo.html>) 和 `/tmp/report.md` [网络](https://example.com/a.html)' });
    const html = renderToStaticMarkup(createElement(LocalFileAction.Provider, { value: () => {} }, markdown));
    expect(html).not.toContain('data-local-file');
    expect(html).toContain('页面 demo.html');
    expect(html).toContain('/tmp/report.md');
    expect(html.match(/<code>/g)).toHaveLength(1);
    expect(html).toContain('href="https://example.com/a.html"');
    expect(renderToStaticMarkup(markdown)).not.toContain('data-local-file');
  });
  it('strips legacy preview instructions from history without altering ordinary messages', () => {
    const wire = '把页面改成蓝色\n\n[客户端本地文件预览]\n旧版客户端说明\n[/客户端本地文件预览]';
    expect(stripClientMessageContext(wire)).toBe('把页面改成蓝色');
    expect(stripClientMessageContext('普通消息')).toBe('普通消息');
  });
});

describe('local preview capabilities', () => {
  it('reveals real paths with spaces/Unicode independently of preview size and format', async () => {
    const { workspace, previews } = await fixture();
    const showItem = vi.fn();
    const file = path.join(workspace, '奇门遁甲 demo.html');
    await writeFile(file, 'a'.repeat(2 * 1024 * 1024 + 1));
    expect(await previews.available([file])).toEqual([false]);
    expect(await previews.reveal(pathToFileURL(file).href, showItem)).toEqual({ ok: true });
    expect(showItem).toHaveBeenLastCalledWith(await realpath(file));
    await writeFile(path.join(workspace, 'config.toml'), '');
    expect(await previews.reveal('config.toml', showItem)).toEqual({ ok: true });
    await rm(file);
    showItem.mockClear();
    expect(await previews.reveal(file, showItem)).toEqual({ ok: false, reason: 'missing' });
    expect(await previews.reveal('https://example.com/page.html', showItem)).toEqual({ ok: false, reason: 'invalid-path' });
    expect(showItem).not.toHaveBeenCalled();
    await expect(previews.reveal('config.toml', () => { throw new Error('OS failure'); })).rejects.toThrow('OS failure');
  });
  it('only enables existing readable supported regular files within size limits', async () => {
    const {workspace,previews}=await fixture();
    await writeFile(path.join(workspace,'exists.html'),'<h1>Ready</h1>');
    await mkdir(path.join(workspace,'folder.html'));
    await writeFile(path.join(workspace,'.portal-connection.url'),'not-previewable');
    await writeFile(path.join(workspace,'large.txt'),'a'.repeat(2*1024*1024+1));
    await symlink(path.join(workspace,'missing.html'),path.join(workspace,'broken.html'));
    expect(await previews.available(['exists.html','missing.html','folder.html','.portal-connection.url','large.txt','broken.html','https://example.com/file.html'])).toEqual([true,false,false,false,false,false,false]);
    await rm(path.join(workspace,'exists.html'));
    expect(await previews.available(['exists.html'])).toEqual([false]);
    await writeFile(path.join(workspace,'exists.html'),'New file');
    expect(await previews.available(['exists.html'])).toEqual([true]);
    await expect(previews.available(Array(65).fill('exists.html'))).rejects.toThrow();
  });
  it('reads real local files and the latest edits without downloading or executing them', async () => {
    const { workspace, previews } = await fixture();
    const file = path.join(workspace, '页面 demo.html'); await writeFile(file, '<h1>First</h1>');
    const first = await previews.preview(pathToFileURL(file).href);
    expect(first.text).toBe('<h1>First</h1>'); expect(first.path).toBe(await realpath(file));
    const response = await previews.resource(new Request(first.url!));
    expect(response.status).toBe(200); expect(await response.text()).toContain(first.text);
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox allow-scripts');
    await writeFile(file, '<h1>Second</h1>');
    expect((await previews.preview('页面 demo.html')).text).toBe('<h1>Second</h1>');
    previews.release(first.id);
    expect((await previews.resource(new Request(first.url!))).status).toBe(404);
  });
  it('permits sibling assets but rejects traversal, symlink escapes and unrelated file types', async () => {
    const { root, workspace, previews } = await fixture();
    await writeFile(path.join(workspace, 'index.html'), '<h1>Preview</h1>');
    await writeFile(path.join(workspace, 'style.css'), 'body{color:red}');
    await writeFile(path.join(workspace, 'private.json'), '{"secret":true}');
    await writeFile(path.join(root, 'outside.html'), 'outside');
    await symlink(path.join(root, 'outside.html'), path.join(workspace, 'escape.html'));
    const file = await previews.preview('index.html'); const base = file.url!.slice(0, file.url!.lastIndexOf('/') + 1);
    expect((await previews.resource(new Request(base + 'style.css'))).status).toBe(200);
    for (const name of ['..%2Foutside.html', 'escape.html', 'private.json']) expect((await previews.resource(new Request(base + name))).status).toBe(403);
    expect((await previews.resource(new Request(base + 'index.html', { method: 'POST' }))).status).toBe(405);
    expect((await previews.resource(new Request('beings://preview/unknown/index.html'))).status).toBe(404);
  });
  it('reports missing, unsupported and oversized files', async () => {
    const { workspace, previews } = await fixture();
    await expect(previews.preview('missing.html')).rejects.toThrow('不存在');
    await writeFile(path.join(workspace, 'large.txt'), 'a'.repeat(2 * 1024 * 1024 + 1));
    await expect(previews.preview('large.txt')).rejects.toThrow('过大');
    await writeFile(path.join(workspace, 'app.exe'), 'fake');
    await expect(previews.preview('app.exe')).rejects.toThrow('暂不支持');
  });
});

import { describe, expect, it } from 'vitest';
import { homeFileReference, parseBeingFiles, beingFileBlocks } from '../desktop/shared/being-files';
const path = 'artifacts/报告 #100%.html';
const url = 'https://home.beings.town/v1/me/files/content?' + new URLSearchParams({ path });
const file = { path, url, name: '文件交付链路测试', size: 5446, content_type: 'text/html', sha256: 'e'.repeat(64), caption: '云电脑生成 · 自包含 · 无外链' };
const receipt = (files: unknown[] = [file], version = 1) => JSON.stringify({ type: 'being.files', version, files });
describe('being.files receipt boundary', () => {
  it('accepts one or multiple files with optional metadata and decodes paths once', () => {
    expect(parseBeingFiles(receipt())?.files).toEqual([file]);
    expect(parseBeingFiles(receipt([file, { path, url, name: '另一份交付' }]))?.files).toHaveLength(2);
    expect(homeFileReference(url)).toEqual({ path });
    expect(homeFileReference('https://home.beings.town/v1/me/files/content?path=a/b.html')).toEqual({ path: 'a/b.html' });
    expect(homeFileReference('https://home.beings.town/v1/me/files/content?path=a%2Fb.html')).toEqual({ path: 'a/b.html' });
  });
  it('leaves ordinary JSON and prose intact', () => {
    expect(parseBeingFiles('{"type":"example","nested":{"type":"being.files"}}')).toBeNull();
    expect(parseBeingFiles('说明：' + receipt())).toBeNull();
    expect(parseBeingFiles('{"result":123}')).toBeNull();
  });
  it('keeps partial/invalid/unknown receipts non-actionable', () => {
    expect(parseBeingFiles(receipt().slice(0, -1))?.error).toContain('不完整');
    expect(parseBeingFiles(receipt([], 2))?.error).toContain('版本');
    expect(parseBeingFiles(receipt([]))?.error).toContain('空');
    expect(parseBeingFiles(receipt([{ ...file, size: -1 }]))?.error).toBeTruthy();
    expect(parseBeingFiles(receipt([{ ...file, path: 'other.html' }]))?.error).toContain('不匹配');
  });
  it.each([
    'https://example.com/v1/me/files/content?path=a.html',
    'https://home.beings.town.evil.test/v1/me/files/content?path=a.html',
    'http://home.beings.town/v1/me/files/content?path=a.html',
    'https://me:secret@home.beings.town/v1/me/files/content?path=a.html',
    'https://home.beings.town/v1/me/files/content?path=../a.html',
    'https://home.beings.town/v1/me/files/content?path=/a.html',
    'https://home.beings.town/v1/me/files/content?path=a.html&path=b.html',
    'https://home.beings.town/v1/me/files/content?path=a.html&token=leaked',
    'https://home.beings.town/v1/me/files/content?path=a.html#fragment',
  ])('never creates an actionable file from %s', address => {
    expect(parseBeingFiles(receipt([{ ...file, url: address }]))?.error).toBeTruthy();
  });
  it('distinguishes malformed private URLs from ordinary browser links', () => {
    expect(homeFileReference('https://example.com/')).toBeNull();
    expect(homeFileReference('https://home.beings.town/v1/me/files/content')).toEqual({});
  });
});


describe('file receipts embedded in conversation prose', () => {
  it('replaces the full JSON range on the same line as prose, preserving surrounding Markdown', () => {
    const before = '已生成 **小镇介绍页**。\n\n下面是文件信息： ';
    const after = '\n\n下载后可以离线查看。';
    const blocks = beingFileBlocks(before + receipt() + after);
    expect(blocks.map(block => block.kind)).toEqual(['text', 'files', 'text']);
    expect(blocks[0].text).toBe(before);
    expect(blocks[2].text).toBe(after);
    expect(blocks[1].kind === 'files' && blocks[1].receipt.files).toEqual([file]);
  });
  it.each(['```json', '~~~json', '```'])('replaces JSON fences including delimiters: %s', fence => {
    const close = fence.startsWith('~') ? '~~~' : '```';
    const blocks = beingFileBlocks('前文\n\n' + fence + '\n' + receipt() + '\n' + close + '\n后文');
    expect(blocks.map(block => block.kind)).toEqual(['text', 'files', 'text']);
    expect(blocks[1].text).toBe(receipt() + '\n');
    expect(blocks[2].text).toBe('后文');
  });
  it('handles multiple objects, braces and escaped quotes in captions', () => {
    const special = receipt([{ ...file, caption: '示例 { 页面 } 与 "引号" 和反斜杠 \\ 结束' }]);
    const blocks = beingFileBlocks(special + '\n第二份：' + receipt());
    expect(blocks.filter(block => block.kind === 'files')).toHaveLength(2);
    expect(blocks[0].text).toBe(special);
  });
  it('preserves unrelated JSON, inline code, quoted examples and non-JSON code fences', () => {
    for (const source of [JSON.stringify({ example: JSON.parse(receipt()) }), '`' + receipt() + '`', '```js\n' + receipt() + '\n```', '> ' + receipt()])
      expect(beingFileBlocks(source)).toEqual([]);
    expect(beingFileBlocks('普通文字')).toEqual([]);
  });
  it('recognizes incomplete mixed streams without actionable files', () => {
    const blocks = beingFileBlocks('文件正在生成：' + receipt().slice(0, -1));
    expect(blocks[1].kind === 'files' && blocks[1].receipt.error).toContain('不完整');
  });
});

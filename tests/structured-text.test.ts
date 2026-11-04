import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../desktop/renderer/shared/components/markdown';
import { detectStructuredText, formatJSON } from '../desktop/renderer/shared/lib/structured-text';

describe('structured chat content', () => {
  it('recognizes complete JSON and JSONL without interpreting ordinary text', () => {
    expect(detectStructuredText(' {"标题":"菜单","人数":4} ')).toBe('json');
    expect(detectStructuredText('[1, {"a": true}]')).toBe('json');
    expect(detectStructuredText('{"op":"state"}\r\n{"op":"commit"}')).toBe('jsonl');
    for (const text of ['普通消息', '[链接](https://example.com)', '{"a":', '{"a":1}\n解释', '42', 'null']) {
      expect(detectStructuredText(text)).toBeUndefined();
    }
  });

  it('formats whitespace without losing number precision, key order or string escapes', () => {
    const text = '{"id":9007199254740993123,"a":{},"a":[],"str":"x, { \\\" y","n":1e+30}';
    const result = formatJSON(text)!;
    expect(result).toContain('9007199254740993123');
    expect(result).toContain('1e+30');
    expect(result).toContain('"a": {},\n  "a": []');
    expect(JSON.parse(result)).toEqual(JSON.parse(text));
    expect(formatJSON('{"a":')).toBeUndefined();
  });

  it('renders raw JSON safely as highlighted source with copy and format controls', () => {
    const html = renderToStaticMarkup(createElement(Markdown, { content: '{"html":"<script>alert(1)</script>","enabled":true}', chat: true }));
    expect(html).toContain('lang-json');
    expect(html).toContain('hljs-attr');
    expect(html).toContain('复制代码');
    expect(html).toContain('格式化');
    expect(html).not.toContain('<script>');
  });

  it('renders rich code in social replies without enabling remote images or raw HTML', () => {
    const html = renderToStaticMarkup(createElement(Markdown, { content: '```json\n{"人数":4}\n```\n\n<img src=x onerror=alert(1)>\n\n![图片](https://example.com/a.png)', richCode: true }));
    expect(html).toContain('hljs-attr');
    expect(html).toContain('复制代码');
    expect(html).not.toContain('<img');
  });

  it('keeps JSONL and incomplete fenced JSON visible without a format action', () => {
    for (const content of ['{"a":1}\n{"b":2}', '```json\n{"a":']) {
      const html = renderToStaticMarkup(createElement(Markdown, { content, chat: true }));
      expect(html).toContain('<pre><code');
      expect(html).toContain('复制代码');
      expect(html).not.toContain('>格式化<');
    }
  });
});

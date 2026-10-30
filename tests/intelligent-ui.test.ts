import { describe, expect, it, vi } from 'vitest';
import { marked } from 'marked';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileUI, evaluate, reconcileState } from '../desktop/renderer/shared/intelligent-ui/runtime';
import { demoSource } from '../desktop/renderer/shared/intelligent-ui/examples';
import { Markdown } from '../desktop/renderer/shared/components/markdown';
import { IntelligentAnswer } from '../desktop/renderer/shared/intelligent-ui/answer';

describe('local intelligent UI', () => {
  it('lexes ordinary answers once and retains forward reference links', () => {
    const text = '## 回复\n\n请参阅[说明][guide]。\n\n- 第一项\n- 第二项\n\n[guide]: https://example.com/guide';
    const lexer = vi.spyOn(marked.Lexer.prototype, 'lex');
    try {
      const html = renderToStaticMarkup(createElement(IntelligentAnswer, { text, streaming: true }));
      expect(html).toContain('href="https://example.com/guide"');
      expect(html).toContain('<li>第一项</li>');
      expect(lexer.mock.calls.filter(([input]) => input === text)).toHaveLength(1);
    } finally { lexer.mockRestore(); }
  });
  it('retains references across prose and an intelligent UI block', () => {
    const text = '[说明][guide]\n\n```intelligent-ui\n' + demoSource + '\n```\n\n[guide]: https://example.com/guide';
    const html = renderToStaticMarkup(createElement(IntelligentAnswer, { text, streaming: false }));
    expect(html).toContain('href="https://example.com/guide"');
    expect(html).toContain('type="range"');
  });
  it('calculates price from local state and handles arithmetic failures', () => {
    const doc = compileUI(demoSource);
    const total = doc.body.find(n => n.id === 'total')!.value;
    expect(evaluate(total, doc.state)).toBe(232);
    expect(evaluate(total, { seats: 10, plan: '专业版', annual: true })).toBe(472);
    expect(evaluate({ op: 'div', args: [1, 0] }, {})).toBeNull();
  });
  it('preserves keyed state while respecting new constraints', () => {
    const doc = compileUI(demoSource);
    expect(reconcileState(doc, { seats: 100, plan: 'removed', annual: true, obsolete: 1 })).toEqual({ seats: 50, plan: '标准版', annual: true });
  });
  it.each([
    { id: 'x', type: 'script', value: 'alert(1)' },
    { id: 'x', type: 'text', value: { op: 'constructor', args: [] } },
    { id: 'x', type: 'text', value: { state: '__proto__' } },
    { id: 'x', type: 'text', onClick: 'fetch("https://example.com")' },
    { id: 'x', type: 'slider', bind: 'seats', min: 10, max: 1 },
    { id: 'x', type: 'button', action: 'openUrl' },
    { id: 'x', type: 'table', columns: ['a'], rows: [[1, 2]] },
  ])('rejects unsafe or invalid components: %j', node => {
    expect(() => compileUI(JSON.stringify({ version: 1, title: '', state: { seats: 8 }, body: [node] }))).toThrow();
  });
  it('bounds source, node count and expression nesting', () => {
    expect(() => compileUI(' '.repeat(100001))).toThrow();
    const doc = JSON.parse(demoSource);
    doc.body = Array.from({ length: 201 }, (_, i) => ({ id: `n${i}`, type: 'text', value: 'x' }));
    expect(() => compileUI(JSON.stringify(doc))).toThrow();
    let expr: any = 1;
    for (let i = 0; i < 22; i++) expr = { op: 'round', args: [expr] };
    doc.body = [{ id: 'a', type: 'text', value: expr }];
    expect(() => compileUI(JSON.stringify(doc))).toThrow();
  });
  it('renders only when explicitly enabled and escapes generated text', () => {
    const content = '```intelligent-ui\n' + demoSource + '\n```';
    const html = renderToStaticMarkup(createElement(Markdown, { content, chat: true, intelligentUI: true }));
    expect(html).toContain('type="range"');
    expect(html).toContain('232');
    expect(renderToStaticMarkup(createElement(Markdown, { content, chat: true }))).not.toContain('type="range"');
    const malicious = demoSource.replace('团队预算计算器', '<script>alert(1)</script>');
    expect(renderToStaticMarkup(createElement(Markdown, { content: '```intelligent-ui\n' + malicious + '\n```', intelligentUI: true }))).not.toContain('<script>');
  });
  it('keeps malformed output readable and handles incomplete streams', () => {
    const content = '```intelligent-ui\n{"version":';
    expect(renderToStaticMarkup(createElement(Markdown, { content, intelligentUI: true, streaming: true }))).toContain('正在接收界面描述');
    expect(renderToStaticMarkup(createElement(Markdown, { content, intelligentUI: true }))).toContain('界面未更新');
  });
});

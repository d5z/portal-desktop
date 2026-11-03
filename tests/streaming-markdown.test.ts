import { describe, expect, it } from 'vitest';
import { marked, type Token } from 'marked';
import { StreamingMarkdown } from '../desktop/renderer/shared/components/streaming-markdown';

const parse = (source: string) => marked.lexer(source, { gfm: true, breaks: true });
const tree = (tokens: Token[]) => JSON.parse(JSON.stringify(tokens));

describe('incremental Markdown frontier', () => {
  const fixtures = [
    '开头 **粗体**。\n\n第二段。\n\n第三段。\n\n第四段\n===\n\n结尾',
    'a\n\nb\n\n| name | value |\n| --- | --- |\n| a | 1 |\n| b | 2 |\n\nend',
    'a\n\nb\n\n- first\n\n- second\n  - nested\n\n    continued\n\nend',
    'a\n\nb\n\n> quoted\n>\n> - item\n>   more\n\nend',
    'a\n\nb\n\n```javascript\nconst x = 1;\n\n// not a paragraph\n```\n\nend',
    'a\n\nb\n\n~~~md\n# heading\n~~~\n\nend',
    '[later][target]\n\na\n\nb\n\nc\n\n[target]: https://example.com "title"\n',
    '[later][target]\n\na\n\nb\n\nc\n\n> [target]: https://example.com\n',
    'a\n\nb\n\nc\n\n    indented\n\n    code\n\nend',
    'a\r\n\r\nb\r\n\r\nc\r\n\r\nend',
    'a\n\nb\n\nc\n\n<div>\nunsafe HTML\n</div>\n\nend',
    'a\n\nb\n\nc\n\n- [ ] todo\n- [x] done\n\nend',
  ];
  it.each(fixtures)('matches a full parse at every character: %s', source => {
    const parser = new StreamingMarkdown(parse);
    for (let end = 1; end <= source.length; end++) {
      const prefix = source.slice(0, end);
      expect(tree(parser.update(prefix)), `prefix ${JSON.stringify(prefix)}`).toEqual(tree(parse(prefix)));
    }
  });

  it('invalidates frozen blocks on history replacement, truncation, and reset', () => {
    const parser = new StreamingMarkdown(parse);
    for (const source of ['a\n\nb\n\nc\n\nd', 'edited\n\nb\n\nc\n\nd', 'edited', '', 'new\n\nreply']) {
      expect(tree(parser.update(source))).toEqual(tree(parse(source)));
    }
  });

  it('keeps stable identities and bounds lexed source to the frontier', () => {
    let parsed = 0, full = 0, source = '';
    const parser = new StreamingMarkdown(text => { parsed += text.length; return parse(text); });
    parser.update('first\n\nsecond\n\nthird\n\n');
    const first = parser.update('first\n\nsecond\n\nthird\n\nfourth')[0];
    expect(parser.update('first\n\nsecond\n\nthird\n\nfourth!')[0]).toBe(first);
    for (let i = 0; i < 1000; i++) {
      source += `段落 ${i} **content**。\n\n`;
      full += source.length;
      parser.update(source);
    }
    expect(parsed).toBeLessThan(full / 100);
    expect(tree(parser.update(source))).toEqual(tree(parse(source)));
  });
});

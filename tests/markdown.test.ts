import { readFileSync } from "node:fs";
import hljs from "highlight.js";
import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Markdown } from "../desktop/renderer/shared/components/markdown";

// React/DOM serialization uses LF; normalize checkouts that preserve CRLF.
const markdown = readFileSync(new URL("./fixtures/markdown-code.md", import.meta.url), "utf8").replace(/\r\n?/g, "\n").trimEnd();
const renderCode = (text: string, language: string, closed = true) =>
  renderToStaticMarkup(createElement(Markdown, {
    content: `\`\`\`\`${language}\n${text}${closed ? "\n````" : ""}`,
    chat: true,
    previewMarkdownCode: false,
  }));
function expectCompleteCode(html: string, text: string) {
  const body = html.match(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/)?.[1];
  expect(body?.replace(/<\/?span\b[^>]*>/g, "")).toBe(
    renderToStaticMarkup(createElement(Fragment, null, text)),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("chat code blocks", () => {
  it.each(["markdown", "md", "mkdown", "mkd", "Markdown", "MD"])("previews %s documents by default", language => {
    const html = renderToStaticMarkup(createElement(Markdown, {
      content: `\`\`\`\`${language}\n${markdown}\n\`\`\`\``,
      chat: true,
    }));
    expect(html).toContain('<h1>客户端 Markdown 验证</h1>');
    expect(html).toContain('<table>');
    expect(html).toContain('<strong>完整显示</strong>');
    expect(html).toContain('aria-label="Markdown 预览"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>预览<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>源码<\/button>/);
    expect(html).not.toContain('<script>');
    expectCompleteCode(html, 'const message = "<script>never()</script>";\nconsole.log(message);');
  });

  it("keeps Markdown examples inside a preview as source", () => {
    const html = renderToStaticMarkup(createElement(Markdown, {
      content: '````markdown\n# 外层标题\n\n```md\n## 代码示例\n```\n````',
      chat: true,
    }));
    expect(html.match(/aria-label="Markdown 显示模式"/g)).toHaveLength(1);
    expect(html).toContain('<h1>外层标题</h1>');
    expectCompleteCode(html, '## 代码示例');
    expect(html).not.toContain('<h2>代码示例</h2>');
  });

  it("previews links and raw HTML through the existing safe renderer", () => {
    const html = renderToStaticMarkup(createElement(Markdown, {
      content: '```md\n# 预览\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[危险](javascript:alert(1))\n\n[正常](https://example.com)\n```',
      chat: true,
    }));
    expect(html).not.toMatch(/<script|<img|href="javascript:/);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('href="https://example.com/"');
  });

  it("leaves non-chat Markdown code blocks as source", () => {
    const html = renderToStaticMarkup(createElement(Markdown, {
      content: '```markdown\n# 原文\n```',
    }));
    expectCompleteCode(html, '# 原文');
    expect(html).not.toContain('Markdown 显示模式');
  });

  it.each(["markdown", "md", "mkdown", "mkd"])("renders all Markdown source for %s", language => {
    const html = renderCode(markdown, language);
    expectCompleteCode(html, markdown);
    expect(html).toContain('class="hljs-section"');
    expect(html).toContain('class="hljs-bullet"');
    expect(html).toContain('class="hljs-strong"');
    expect(html).not.toMatch(/<table|<script|<placeholder|href=/);
  });

  it.each([
    ["javascript", 'const message = "<img onerror=alert(1)>";\nconsole.log(message); // 完整末尾'],
    ["json", '{"title": "中文", "nested": {"enabled": true}, "last": 42}'],
    ["html", '<style>p { color: red; }</style>\n<script>const message = "中文";</script>\n<p>末尾</p>'],
    ["", "# 未标注语言\n\n**内容** 与 `代码`\n末尾"],
    ["unknown-language", "# 未知语言\n\n**内容** 与 `代码`\n末尾"],
    ["plaintext", "  <tag> &amp;\n\t缩进\n\n末尾  "],
    ["markdown", ""],
  ])("preserves the complete %s code block", (language, text) => {
    expectCompleteCode(renderCode(text, language), text);
  });

  it("preserves incomplete fences and syntax while streaming", () => {
    for (const text of ["#", "# 标题\n\n- **尚未结束", markdown]) {
      expectCompleteCode(renderCode(text, "markdown", false), text);
    }
  });

  it.each(["errorRaised", "illegal", "throw"])("falls back to full source on a highlighter %s", failure => {
    const partial = hljs.highlight("prefix", { language: "plaintext" });
    const highlight = vi.spyOn(hljs, "highlight");
    if (failure === "throw") highlight.mockImplementationOnce(() => { throw new Error("highlight failed"); });
    else highlight.mockReturnValueOnce({
      ...partial,
      ...(failure === "illegal" ? { illegal: true } : { errorRaised: new Error("highlight failed") }),
    });
    const text = 'prefix\n<script>alert("must stay text")</script>\n完整末尾';
    const html = renderCode(text, "markdown");
    expectCompleteCode(html, text);
    expect(html).not.toContain("<script>");
  });
});

it('keeps streaming code readable without repeated highlighting, then highlights the completed source', () => {
  const content = '```javascript\nconst result = 42;\n```';
  const live = renderToStaticMarkup(createElement(Markdown, { content, chat: true, streaming: true }));
  const done = renderToStaticMarkup(createElement(Markdown, { content, chat: true, streaming: false }));
  expect(live).toContain('const result = 42;');
  expect(live).not.toContain('hljs-keyword');
  expect(done).toContain('hljs-keyword');
  expect(done).toContain('result');
});


it('defers JSON formatting work until the streamed code is complete', () => {
  const source = JSON.stringify({performance: Array.from({length:200}, (_, i) => ({id:i, text:'流式数据'}))});
  const parse = vi.spyOn(JSON, 'parse');
  for (const text of [source.slice(0,100), source.slice(0,source.length/2), source]) {
    const html = renderToStaticMarkup(createElement(Markdown, {
      content: '```json\n' + text + '\n```', chat:true, streaming:true,
    }));
    expectCompleteCode(html, text);
    expect(html).not.toContain('格式化');
    expect(parse.mock.calls.some(([value]) => value === text)).toBe(false);
  }
  const html = renderToStaticMarkup(createElement(Markdown, {
    content: '```json\n' + source + '\n```', chat:true, streaming:false,
  }));
  expectCompleteCode(html, source);
  expect(html).toContain('格式化');
  expect(parse.mock.calls.some(([value]) => value === source)).toBe(true);
});

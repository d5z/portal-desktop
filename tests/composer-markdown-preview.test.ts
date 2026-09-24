import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComposerField } from "../desktop/renderer/chat/components/composer-field";
import {
  COMPOSER_TYPOGRAPHY,
  composerTypographyStyle,
} from "../desktop/renderer/chat/composer-typography";
import { Markdown } from "../desktop/renderer/shared/components/markdown";

const preview = (content: string) =>
  renderToStaticMarkup(
    createElement(Markdown, {
      content,
      chat: true,
      composerPreview: true,
      previewMarkdownCode: false,
      className: "composer-preview-markdown",
    }),
  );

describe("composer markdown preview", () => {
  it("renders headings without hash markers", () => {
    const html = preview("# 标题\n## 二级\n### 三级");
    expect(html).toContain('<h1 class="composer-preview-heading">标题</h1>');
    expect(html).toContain('<h2 class="composer-preview-heading">二级</h2>');
    expect(html).toContain('<h3 class="composer-preview-heading">三级</h3>');
    expect(html).not.toMatch(/#\s*标题/);
  });

  it("renders unordered lists as bullets", () => {
    const html = preview("- 甲\n* 乙\n+ 丙");
    expect(html.match(/<ul class="composer-preview-list">/g)).toHaveLength(3);
    expect(html).toContain("<li>甲</li>");
    expect(html).toContain("<li>乙</li>");
    expect(html).toContain("<li>丙</li>");
  });

  it("keeps ordered list numbers", () => {
    const html = preview("1. 第一项\n2. 第二项");
    expect(html).toContain('<ol class="composer-preview-list" start="1">');
    expect(html).toContain("<li>第一项</li>");
    expect(html).toContain("<li>第二项</li>");
  });

  it("nests lists when lines are indented", () => {
    const html = preview("- 父\n  - 子");
    expect(html).toContain("<ul");
    expect(html).toContain("<li>父");
    expect(html).toContain("<li>子</li>");
  });

  it("leaves unsupported markdown as source text", () => {
    const html = preview("**粗体** 和 `code`");
    expect(html).not.toContain("<strong>");
    expect(html).toContain("**粗体**");
    expect(html).toContain("`code`");
  });

  it("matches composer overlay and textarea typography constants", () => {
    const html = renderToStaticMarkup(
      createElement(ComposerField, {
        textareaRef: { current: null },
        value: "# 对齐",
        placeholder: "说点什么…",
        id: "input",
        readOnly: true,
      }),
    );
    expect(html).toContain("font-size:15px");
    expect(html).toContain("line-height:22.5px");
    expect(html).toContain("--composer-line-height:22.5px");
    expect(composerTypographyStyle.lineHeight).toBe(COMPOSER_TYPOGRAPHY.lineHeight);
    expect(html).toContain("composer-preview-markdown");
    expect(html).toContain("composer-stack");
  });

  it("tags preview blocks for shared line-height styling", () => {
    const html = preview("# 行高\n- 列表");
    expect(html).toContain('class="composer-preview-markdown"');
    expect(html).toContain('class="composer-preview-heading"');
    expect(html).toContain('class="composer-preview-list"');
  });
});

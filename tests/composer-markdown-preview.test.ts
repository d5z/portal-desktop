import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { buildComposerDecorations } from "../desktop/renderer/chat/composer-markdown";

function decorations(source: string) {
  const ranges: Array<{ from: number; to: number; className?: string; replacement: boolean }> = [];
  const doc = Text.of(source.split("\n"));
  buildComposerDecorations(doc).between(0, doc.length, (from, to, value) => {
    ranges.push({
      from,
      to,
      className: value.spec.attributes?.class,
      replacement: to > from,
    });
  });
  return ranges;
}

describe("composer Markdown decorations", () => {
  it("removes heading prefix width while keeping Markdown source positions", () => {
    const source = "# Title\n## Next\n### Third";
    const ranges = decorations(source);
    expect(ranges).toContainEqual({ from: 0, to: 0, className: "cm-composer-heading-1", replacement: false });
    expect(ranges).toContainEqual({ from: 0, to: 2, className: undefined, replacement: true });
    expect(ranges).toContainEqual({ from: 8, to: 11, className: undefined, replacement: true });
    expect(ranges).toContainEqual({ from: 16, to: 20, className: undefined, replacement: true });
    expect(source).toBe("# Title\n## Next\n### Third");
  });

  it("shows bullet widgets and leaves fenced code untouched", () => {
    const source = "- item\n```ts\n# code\n- code\n```\n* next";
    const ranges = decorations(source);
    expect(ranges.filter((range) => range.replacement)).toHaveLength(2);
    expect(ranges[0]).toMatchObject({ from: 0, to: 1 });
    expect(ranges[1]).toMatchObject({ from: source.lastIndexOf("*"), to: source.lastIndexOf("*") + 1 });
  });

  it("keeps incomplete headings and level four markers visible", () => {
    expect(decorations("#\n#### Title")).toEqual([]);
  });
});

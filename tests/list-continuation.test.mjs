import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { marked } from "marked";

const outDir = await mkdtemp(path.join(tmpdir(), "list-continuation-"));
const bundlePath = path.join(outDir, "bundle.mjs");
await build({
  entryPoints: ["desktop/renderer/chat/list-continuation.ts"],
  outfile: bundlePath,
  bundle: true,
  format: "esm",
  platform: "node",
});

const {
  parseListPrefix,
  buildContinuation,
  applyShiftEnterListContinue,
  applyLineStartTab,
  applyLineStartShiftTab,
  isInCodeFence,
  renumberOrderedLists,
  selectedOrderedIndents,
} = await import(`file://${bundlePath}`);

function contLine(line) {
  const prefix = parseListPrefix(line);
  assert.ok(prefix);
  return buildContinuation(prefix, line);
}

function shiftEnter(text, pos = text.length) {
  const result = applyShiftEnterListContinue(text, pos, pos);
  assert.ok(result, `expected list continuation at ${pos} in ${JSON.stringify(text)}`);
  return result;
}

function orderedNumbers(text) {
  return text
    .split("\n")
    .map((line) => /^(\s*)(\d+)([.)])/.exec(line))
    .filter(Boolean)
    .map((m) => Number(m[2]));
}

function assertOrderedContinuous(text) {
  const nums = orderedNumbers(text);
  for (let i = 0; i < nums.length; i += 1) {
    assert.equal(nums[i], i + 1, `expected 1..n in ${JSON.stringify(text)}`);
  }
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// §4.1 ordered list continuation
test("1. 甲 → 2. ", () => {
  assert.equal(contLine("1. 甲"), "2. ");
  let text = "1. 甲";
  for (let n = 2; n <= 5; n += 1) {
    const { text: next, selection } = shiftEnter(text);
    const lines = next.split("\n");
    assert.equal(lines.at(-1), `${n}. `);
    assert.equal(selection, next.length);
    text = `${next}项`;
  }
});

test("a deliberately numbered list keeps its start on continuation", () => {
  assert.equal(shiftEnter("7. first").text, "7. first\n8. ");
  assert.equal(shiftEnter("7. first\n8. second").text, "7. first\n8. second\n9. ");
});

// §4.2 unordered and 1) style
test("- / * / 1) continuations", () => {
  assert.equal(contLine("- 甲"), "- ");
  assert.equal(contLine("* 甲"), "* ");
  assert.equal(contLine("+ 甲"), "+ ");
  assert.equal(contLine("1) 甲"), "2) ");
});

// §4.3 nested indent inherits child marker
test("nested child bullet continues with same indent", () => {
  const text = "1. 甲\n    - 乙";
  const { text: next, selection } = shiftEnter(text);
  assert.equal(next, "1. 甲\n    - 乙\n    - ");
  assert.equal(selection, next.length);
  let tabbed = "1. 甲\n";
  const nestedLineStart = tabbed.length;
  for (let i = 0; i < 2; i += 1) {
    const tab = applyLineStartTab(tabbed, nestedLineStart, nestedLineStart);
    assert.ok(tab);
    tabbed = tab.text;
  }
  tabbed += "- 乙";
  const nested = shiftEnter(tabbed);
  assert.equal(nested.text, "1. 甲\n    - 乙\n    - ");
});

// §4.4 empty item exit / demote one level
test("single-level empty ordered item exits list", () => {
  const text = "1. 甲\n2. 乙\n3. ";
  const { text: next, selection } = shiftEnter(text);
  assert.equal(next, "1. 甲\n2. 乙\n");
  assert.equal(selection, next.length);
});

test("multi-level empty item demotes to parent marker", () => {
  const text = "1. 甲\n  2. 乙\n    3. ";
  const { text: next, selection } = shiftEnter(text);
  assert.equal(next, "1. 甲\n  1. 乙\n  2. ");
  assert.equal(selection, next.length);
});

test("empty nested item does not borrow a parent across a blank line", () => {
  assert.equal(shiftEnter("1. unrelated\n\n  - ").text, "1. unrelated\n\n- ");
});

// §4.7 ordered list renumber after managed events
test("prepend ordered item at first line start renumbers siblings", () => {
  const text = "1. a\n2. b";
  const { text: next, selection } = shiftEnter(text, 0);
  assert.equal(next, "1. \n2. a\n3. b");
  assertOrderedContinuous(next);
  assert.equal(selection, 3);
});

test("exiting an empty prepended item leaves a plain first line", () => {
  const inserted = shiftEnter("1. a\n2. b", 0);
  const exited = shiftEnter(inserted.text, inserted.selection);
  assert.deepEqual(exited, { text: "\n1. a\n2. b", selection: 0 });
});

test("insert ordered item after marker renumbers following siblings", () => {
  const text = "1. a\n2. b";
  const pos = "1. ".length;
  const { text: next } = shiftEnter(text, pos);
  assert.equal(next, "1. \n2. a\n3. b");
  assertOrderedContinuous(next);
});

test("Shift+Enter inside a list marker keeps both markers intact", () => {
  assert.equal(shiftEnter("1. item", 1).text, "1. \n2. item");
  assert.equal(shiftEnter("- item", 1).text, "- \n- item");
});

test("empty middle ordered item exit keeps numbers continuous", () => {
  const text = "1. a\n2. \n3. c";
  const pos = text.indexOf("2. ") + "2. ".length;
  const { text: next } = shiftEnter(text, pos);
  assert.equal(next, "1. a\n2. c");
  assertOrderedContinuous(next);
});

test("tab out and back keeps ordered numbers continuous at level", () => {
  let text = "1. a\n2. b";
  const line2Start = text.indexOf("2. b");
  let tab = applyLineStartTab(text, line2Start, line2Start);
  assert.ok(tab);
  text = tab.text;
  tab = applyLineStartShiftTab(text, tab.selection, tab.selection);
  assert.ok(tab);
  text = tab.text;
  assertOrderedContinuous(text);
});

test("nested ordered renumber does not change parent block", () => {
  const text = "1. parent\n  1. child\n  2. child2";
  const pos = text.indexOf("  1. child") + "  1. ".length;
  const { text: next } = shiftEnter(text, pos);
  assert.match(next, /^1\. parent/);
  const childLines = next.split("\n").slice(1);
  assert.equal(childLines.length, 3);
  assert.match(childLines[0], /^  1\. /);
  assert.match(childLines[1], /^  2\. child/);
  assert.match(childLines[2], /^  3\. child2/);
});

test("unordered list unchanged through shift-enter and tab", () => {
  const cont = shiftEnter("- a");
  assert.equal(cont.text, "- a\n- ");
  const tab = applyLineStartTab("- a\n- b", "- a\n".length, "- a\n".length);
  assert.equal(tab.text, "- a\n  - b");
  assert.ok(!orderedNumbers(tab.text).length);
});

test("editing one list leaves a separate numbered example alone", () => {
  const text = "7. keep this number\n\n- item";
  assert.equal(shiftEnter(text).text, "7. keep this number\n\n- item\n- ");
  assert.equal(shiftEnter("- \n7. keep this number", 2).text, "7. keep this number");
});

test("an ordered list continues across blank lines like the sent Markdown", () => {
  const text = "7. keep this number\n\n1. item";
  assert.equal(shiftEnter(text).text, "7. keep this number\n\n8. item\n9. ");
  const separate = "7. keep this number\n\nplain\n\n1. item";
  assert.equal(shiftEnter(separate).text, "7. keep this number\n\nplain\n\n1. item\n2. ");
});

test("indenting a middle ordered item updates only nearby siblings", () => {
  const text = "7. keep this number\n\nplain\n\n1. a\n2. b\n3. c";
  const pos = text.indexOf("2. b") + "2. b".length;
  const tab = applyLineStartTab(text, pos, pos);
  assert.ok(tab);
  assert.equal(tab.text, "7. keep this number\n\nplain\n\n1. a\n   1. b\n2. c");
  const back = applyLineStartShiftTab(tab.text, tab.selection, tab.selection);
  assert.ok(back);
  assert.equal(back.text, text);
});

test("renumbering padded markers keeps the item text intact", () => {
  const text = "01. first\n02. second";
  const pos = text.indexOf("02. second") + "02. second".length;
  const tab = applyLineStartTab(text, pos, pos);
  assert.equal(tab.text, "1. first\n    1. second");
});

test("selected ordered indents skip plain text and fenced code", () => {
  assert.deepEqual(selectedOrderedIndents("intro\n1. a\n2. b", 0, "intro\n1. a".length), [""]);
  assert.deepEqual(selectedOrderedIndents("```\n1. code\n```\n  2. item", 0, 100), ["  "]);
  const text = "  intro\n  1. a\n  2. b\n3. c";
  assert.equal(renumberOrderedLists(text, 2, "", "  intro\n  1. a\n  2. b".length).text, "  intro\n  1. a\n  2. b\n1. c");
});

test("selected lines renumber a list across blank lines", () => {
  const text = "1. a\n   1. b\n\n   1. c\n2. d";
  const from = text.indexOf("   1. b");
  const to = text.indexOf("2. d");
  assert.equal(renumberOrderedLists(text, from, [""], to).text, "1. a\n   1. b\n\n   2. c\n2. d");
});

// §4.5 Tab / Shift+Tab at line start only
test("Tab uses two spaces for plain text and the parent content column for lists", () => {
  const atStart = applyLineStartTab("hello", 0, 0);
  assert.deepEqual(atStart, { text: "  hello", selection: 2 });
  assert.deepEqual(applyLineStartTab("  - item", 2, 2), { text: "  - item", selection: 2 });
  assert.deepEqual(applyLineStartTab("2. ", 3, 3), { text: "2. ", selection: 3 });
  const child = applyLineStartTab("1. parent\n2. child", "1. parent\n".length, "1. parent\n".length);
  assert.equal(child.text, "1. parent\n   1. child");
});

test("Tab never turns an orphan list into an indented code block", () => {
  for (const source of ["- first", "1. first", "  - first", "7. first"]) {
    const tabbed = applyLineStartTab(source, source.length, source.length);
    assert.equal(tabbed.text, source);
  }
  const tabbed = applyLineStartTab("intro\n1. a\n2. b", 0, "intro\n1. a\n2. b".length);
  assert.equal(tabbed.text, "  intro\n1. a\n   1. b");
  assert.equal((marked.parse(tabbed.text).match(/<ol>/g) || []).length, 2);
});

test("Tab creates a real nested ordered list in the sent Markdown", () => {
  const text = "1. parent\n1. child";
  const pos = text.indexOf("1. child");
  const tabbed = applyLineStartTab(text, pos, pos);
  assert.equal((marked.parse(tabbed.text).match(/<ol>/g) || []).length, 2);
});

test("Tab handles longer ordered markers and repeated levels", () => {
  const source = "1000. parent\n1001. child\n1002. grandchild";
  const child = applyLineStartTab(source, source.indexOf("1001."), source.indexOf("1001."));
  assert.equal(child.text, "1000. parent\n      1. child\n1001. grandchild");
  const grandchild = applyLineStartTab(child.text, child.text.indexOf("1001. grandchild"), child.text.indexOf("1001. grandchild"));
  assert.equal(grandchild.text, "1000. parent\n      1. child\n      2. grandchild");
  assert.equal((marked.parse(grandchild.text).match(/<ol\b/g) || []).length, 2);
  const deeper = applyLineStartTab(grandchild.text, grandchild.text.indexOf("2. grandchild"), grandchild.text.indexOf("2. grandchild"));
  assert.equal((marked.parse(deeper.text).match(/<ol\b/g) || []).length, 3);
});

test("multi-line Tab and Shift+Tab keep ordered children nested", () => {
  const text = "1. parent\n2. child\n3. sibling";
  const start = text.indexOf("2. child");
  const tabbed = applyLineStartTab(text, start, text.length);
  assert.equal(tabbed.text, "1. parent\n   1. child\n   2. sibling");
  assert.equal((marked.parse(tabbed.text).match(/<ol>/g) || []).length, 2);
  assert.equal(applyLineStartShiftTab(tabbed.text, tabbed.selection, tabbed.selectionEnd).text, text);
});

test("Tab in a selected code fence keeps two-space code indentation", () => {
  const text = "```js\n1. code\n2. code\n```";
  const start = text.indexOf("1. code");
  const end = text.indexOf("\n```");
  const tabbed = applyLineStartTab(text, start, end);
  assert.equal(tabbed.text, "```js\n  1. code\n  2. code\n```");
});

test("line-start Shift+Tab returns an orphan list to the root", () => {
  const result = applyLineStartShiftTab("    - item", 0, 0);
  assert.deepEqual(result, { text: "- item", selection: 0 });
});

test("Tab and Shift+Tab keep editing focus from the middle of a line", () => {
  const tab = applyLineStartTab("hello", 5, 5);
  assert.deepEqual(tab, { text: "  hello", selection: 7 });
  assert.deepEqual(applyLineStartShiftTab(tab.text, tab.selection, tab.selection), { text: "hello", selection: 5 });
  assert.deepEqual(applyLineStartShiftTab("hello", 5, 5), { text: "hello", selection: 5 });
});

test("Tab indents code without sending focus to another control", () => {
  const text = "```js\nconst x = 1";
  const tab = applyLineStartTab(text, text.length, text.length);
  assert.deepEqual(tab, { text: "```js\n  const x = 1", selection: text.length + 2 });
});

// §4.6 code fence and non-list lines stay unchanged
test("code fence blocks list continuation", () => {
  const text = "```\n1. 甲\n";
  const pos = text.length;
  assert.equal(isInCodeFence(text, pos), true);
  assert.equal(applyShiftEnterListContinue(text, pos, pos), null);
});

test("tilde and long backtick fences keep code lists unchanged", () => {
  for (const text of [
    "~~~js\n1. code\n~~~",
    "````md\n```\n1. code\n````",
  ]) {
    const pos = text.indexOf("1. code") + "1. code".length;
    assert.equal(isInCodeFence(text, pos), true);
    assert.equal(applyShiftEnterListContinue(text, pos, pos), null);
    assert.equal(renumberOrderedLists(text, pos).text, text);
    const tab = applyLineStartTab(text, pos - "1. code".length, pos - "1. code".length);
    assert.equal(tab.text.includes("  1. code"), true);
  }
});

test("inline backticks do not open a code fence", () => {
  const text = "This is ``` inline\n1. item";
  assert.equal(isInCodeFence(text, text.length), false);
  assert.equal(shiftEnter(text).text, "This is ``` inline\n1. item\n2. ");
});

test("non-list Shift+Enter returns null", () => {
  assert.equal(applyShiftEnterListContinue("plain text", 5, 5), null);
});

await rm(outDir, { recursive: true, force: true });
console.log(`\n${passed} passed`);

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";

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

// §4.7 ordered list renumber after managed events
test("prepend ordered item at first line start renumbers siblings", () => {
  const text = "1. a\n2. b";
  const { text: next, selection } = shiftEnter(text, 0);
  assert.equal(next, "1. \n2. a\n3. b");
  assertOrderedContinuous(next);
  assert.equal(selection, 3);
});

test("insert ordered item after marker renumbers following siblings", () => {
  const text = "1. a\n2. b";
  const pos = "1. ".length;
  const { text: next } = shiftEnter(text, pos);
  assert.equal(next, "1. \n2. a\n3. b");
  assertOrderedContinuous(next);
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

// §4.5 Tab / Shift+Tab at line start only
test("line-start Tab inserts two spaces", () => {
  const atStart = applyLineStartTab("hello", 0, 0);
  assert.deepEqual(atStart, { text: "  hello", selection: 2 });
  const beforeMarker = applyLineStartTab("  - item", 2, 2);
  assert.deepEqual(beforeMarker, { text: "    - item", selection: 4 });
  const emptyListItem = applyLineStartTab("2. ", 3, 3);
  assert.deepEqual(emptyListItem, { text: "  1. ", selection: 5 });
});

test("line-start Shift+Tab removes two spaces", () => {
  const result = applyLineStartShiftTab("    - item", 0, 0);
  assert.deepEqual(result, { text: "  - item", selection: 0 });
});

test("mid-line Tab is not hijacked", () => {
  assert.equal(applyLineStartTab("ab", 1, 1), null);
});

// §4.6 code fence and non-list lines stay unchanged
test("code fence blocks list continuation", () => {
  const text = "```\n1. 甲\n";
  const pos = text.length;
  assert.equal(isInCodeFence(text, pos), true);
  assert.equal(applyShiftEnterListContinue(text, pos, pos), null);
});

test("non-list Shift+Enter returns null", () => {
  assert.equal(applyShiftEnterListContinue("plain text", 5, 5), null);
});

await rm(outDir, { recursive: true, force: true });
console.log(`\n${passed} passed`);

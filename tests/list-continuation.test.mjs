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
  assert.equal(next, "1. 甲\n  2. 乙\n  2. ");
  assert.equal(selection, next.length);
});

// §4.5 Tab / Shift+Tab at line start only
test("line-start Tab inserts two spaces", () => {
  const atStart = applyLineStartTab("hello", 0, 0);
  assert.deepEqual(atStart, { text: "  hello", selection: 2 });
  const beforeMarker = applyLineStartTab("  - item", 2, 2);
  assert.deepEqual(beforeMarker, { text: "    - item", selection: 4 });
  const emptyListItem = applyLineStartTab("2. ", 3, 3);
  assert.deepEqual(emptyListItem, { text: "  2. ", selection: 5 });
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

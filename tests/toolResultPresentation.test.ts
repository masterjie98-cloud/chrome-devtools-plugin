import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_TOOL_RESULT_DISPLAY_CHARS,
  presentToolResult,
} from "../src/sidepanel/toolResultPresentation";

test("small tool results are retained in full with exact character metadata", () => {
  const result = presentToolResult({ ok: true, items: ["alpha", "beta"] });

  assert.equal(result.meta.truncated, false);
  assert.equal(result.meta.originalCharCount, result.content.length);
  assert.equal(result.meta.displayedSourceCharCount, result.content.length);
  assert.deepEqual(JSON.parse(result.content), {
    ok: true,
    items: ["alpha", "beta"],
  });
});

test("tool results larger than the former 8k cap remain complete", () => {
  const result = presentToolResult({ text: "x".repeat(9_000) });

  assert.equal(result.meta.truncated, false);
  assert.ok(result.content.length > 8_000);
  assert.equal(result.meta.originalCharCount, result.content.length);
  assert.ok(result.content.length < MAX_TOOL_RESULT_DISPLAY_CHARS);
});

test("oversized tool results expose bounded and accurate truncation metadata", () => {
  const value = { text: "x".repeat(2_000) };
  const serialized = JSON.stringify(value, null, 2);
  const result = presentToolResult(value, 240);

  assert.equal(result.meta.truncated, true);
  assert.equal(result.meta.originalCharCount, serialized.length);
  assert.equal(result.content.length, 240);
  assert.equal(
    result.content.slice(0, result.meta.displayedSourceCharCount),
    serialized.slice(0, result.meta.displayedSourceCharCount),
  );
  assert.ok(result.meta.originalCharCount > result.content.length);
  const marker = result.content.slice(result.meta.displayedSourceCharCount);
  assert.match(marker, /工具结果显示已截断/);
  assert.match(marker, /分页\/cursor/);
});

test("unserializable tool results fail visibly without throwing", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  const result = presentToolResult(circular);

  assert.equal(result.meta.truncated, false);
  assert.match(result.content, /could not be serialized/);
  assert.match(result.content, /circular/i);
});

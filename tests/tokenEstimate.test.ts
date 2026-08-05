import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateTextTokens,
  estimateTokensFromCharacterCount,
  formatEstimatedTokenCount,
} from "../src/shared/tokenEstimate";

test("token estimation keeps CJK heavier than equal-length ASCII", () => {
  assert.ok(estimateTextTokens("测".repeat(400)) > estimateTextTokens("a".repeat(400)));
});

test("truncated result estimation preserves the observed script ratio", () => {
  const cjkEstimate = estimateTokensFromCharacterCount(8_000, "测试结果".repeat(100));
  const asciiEstimate = estimateTokensFromCharacterCount(8_000, "result".repeat(100));

  assert.ok(cjkEstimate > asciiEstimate);
  assert.equal(formatEstimatedTokenCount(8_348), "8.3k tokens");
});

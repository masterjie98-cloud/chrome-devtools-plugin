import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizeAgentToolCallForPersistence,
  sanitizeAgentToolResultForPersistence,
} from "../src/shared/agentSession";

test("persisted Agent snapshots omit tool arguments and raw results", () => {
  const rawResult = '{"cookies":[{"value":"secret-output"}]}';
  const call = sanitizeAgentToolCallForPersistence({
    id: "call-1",
    name: "browser_cookie_set",
    arguments: { name: "session", value: "secret-input" },
  });
  const result = sanitizeAgentToolResultForPersistence({
    toolCallId: "call-1",
    name: "browser_cookie_list",
    content: rawResult,
  });

  assert.deepEqual(call.arguments, {
    name: "[value omitted]",
    value: "[value omitted]",
  });
  assert.doesNotMatch(JSON.stringify(call), /secret-input/);
  assert.doesNotMatch(result.content, /secret-output/);
  assert.deepEqual(JSON.parse(result.content), {
    contentOmitted: true,
    originalCharCount: rawResult.length,
  });
});

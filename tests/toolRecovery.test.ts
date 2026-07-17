import assert from "node:assert/strict";
import test from "node:test";
import {
  executeWithMcpTransportRecovery,
  executeWithTargetRecovery,
  isRecoverableTargetError,
} from "../src/sidepanel/services/toolRecovery";
import {
  McpToolTransportError,
  isMcpToolTransportError,
} from "../src/sidepanel/services/mcpTransport";

test("target recovery retries a stale authorization once", async () => {
  const attempts: number[] = [];
  const result = await executeWithTargetRecovery(async (attempt) => {
    attempts.push(attempt);
    if (attempt === 0) {
      throw new Error(
        "STALE_CONTEXT: browser revision changed while approval was pending.",
      );
    }
    return "clicked";
  });

  assert.equal(result, "clicked");
  assert.deepEqual(attempts, [0, 1]);
});

test("target recovery does not repeat geometry or unrelated failures", async () => {
  let attempts = 0;
  await assert.rejects(
    executeWithTargetRecovery(async () => {
      attempts += 1;
      throw new Error("TRUSTED_INPUT_TARGET_NOT_VISIBLE: no usable point");
    }),
    /TARGET_NOT_VISIBLE/,
  );
  assert.equal(attempts, 1);
  assert.equal(
    isRecoverableTargetError(
      new Error("EXECUTION_GRANT_INVALID: target does not match"),
    ),
    true,
  );
});

test("transport recovery retries one explicitly safe read", async () => {
  const attempts: number[] = [];
  const result = await executeWithMcpTransportRecovery(
    async (attempt) => {
      attempts.push(attempt);
      if (attempt === 0) {
        throw new McpToolTransportError({
          toolName: "browser_query_dom",
          closeCode: 1006,
        });
      }
      return "fresh DOM";
    },
    { retrySafe: true },
  );

  assert.equal(result, "fresh DOM");
  assert.deepEqual(attempts, [0, 1]);
});

test("transport recovery never replays a call that is not proven safe", async () => {
  let attempts = 0;
  const error = new McpToolTransportError({
    toolName: "browser_click",
    closeCode: 1008,
    closeReason: "IDLE_TIMEOUT",
  });

  await assert.rejects(
    executeWithMcpTransportRecovery(
      async () => {
        attempts += 1;
        throw error;
      },
      { retrySafe: false },
    ),
    (value) => isMcpToolTransportError(value),
  );
  assert.equal(attempts, 1);
  assert.match(error.message, /MCP_TRANSPORT_CLOSED/);
  assert.match(error.message, /IDLE_TIMEOUT/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { classifyAgentFailureRecovery } from "../src/sidepanel/services/agentFailureRecovery";
import {
  getAgentToolDataLossNotice,
  isAgentToolApprovalDenied,
} from "../src/sidepanel/services/agentToolResult";

test("failure recovery classifies stale, frame, visibility and obstruction states", () => {
  assert.equal(
    classifyAgentFailureRecovery("STALE_CONTEXT: navigation changed").action,
    "fresh_observe_and_relocate",
  );
  assert.equal(
    classifyAgentFailureRecovery("FRAME_UNAVAILABLE: not registered").action,
    "wait_for_frame_then_observe",
  );
  assert.equal(
    classifyAgentFailureRecovery(
      "TRUSTED_INPUT_TARGET_NOT_VISIBLE: no point",
    ).action,
    "scroll_or_reveal_then_observe",
  );
  assert.equal(
    classifyAgentFailureRecovery("TRUSTED_INPUT_TARGET_OCCLUDED: covered")
      .action,
    "dismiss_obstruction_then_observe",
  );
});

test("failure recovery never permits replay after an ambiguous write", () => {
  const state = classifyAgentFailureRecovery(
    "MCP tool connection closed before a result was returned.",
    { mutatesBrowser: true, dispatched: true },
  );
  assert.equal(state.kind, "unknown_write_outcome");
  assert.equal(state.action, "reobserve_without_replay");
  assert.equal(state.retryAfterFreshEvidence, false);
  assert.equal(state.unknownWriteOutcome, true);
});

test("approval denial is detected from structured tool results", () => {
  assert.equal(
    isAgentToolApprovalDenied(
      JSON.stringify({
        error:
          "APPROVAL_DENIED: user denied tool approval: browser_apply_css_patch",
      }),
    ),
    true,
  );
  assert.equal(
    isAgentToolApprovalDenied(
      JSON.stringify({
        errorCode: "APPROVAL_DENIED",
        denied: true,
      }),
    ),
    true,
  );
  assert.equal(
    isAgentToolApprovalDenied(
      JSON.stringify({ error: "MCP_TRANSPORT_CLOSED" }),
    ),
    false,
  );
});

test("activity and Network data loss produce deterministic user-visible warnings", () => {
  assert.match(
    getAgentToolDataLossNotice(
      JSON.stringify({
        activity: {
          cursorStatus: "events_dropped",
          missedEvents: 350,
        },
      }),
    ) ?? "",
    /350 条事件未保留.*不能声称覆盖完整历史/,
  );
  assert.match(
    getAgentToolDataLossNotice(
      JSON.stringify({
        droppedRequestCount: 25,
        capacityReached: true,
      }),
    ) ?? "",
    /25 条较低优先级请求.*不是完整原始列表/,
  );
  assert.match(
    getAgentToolDataLossNotice(
      JSON.stringify({
        activity: {
          cursorStatus: "ok",
          transportDroppedEvents: {
            dom: 0,
            network: 18,
            console: 0,
            navigation: 0,
          },
          notableEvents: [
            {
              kind: "network",
              summary: {
                reason: "transport-queue-overflow",
                transportDroppedEvents: 18,
              },
            },
          ],
        },
      }),
    ) ?? "",
    /后台传输队列有 18 条监听事件未能保留.*不能声称覆盖完整历史/,
  );
  assert.equal(
    getAgentToolDataLossNotice(
      JSON.stringify({
        activity: { cursorStatus: "ok", missedEvents: 0 },
        droppedRequestCount: 0,
      }),
    ),
    undefined,
  );
});

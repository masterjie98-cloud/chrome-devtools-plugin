import assert from "node:assert/strict";
import test from "node:test";
import { classifyAgentFailureRecovery } from "../src/sidepanel/services/agentFailureRecovery";

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

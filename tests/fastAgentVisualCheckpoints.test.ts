import assert from "node:assert/strict";
import test from "node:test";
import type { ChatImageAttachment } from "../src/sidepanel/types";
import type {
  AiRequestedToolCall,
  AiToolResultMessage,
} from "../src/sidepanel/services/aiClient";
import {
  MAX_FAST_AGENT_VISUAL_CHECKPOINT_ATTEMPTS,
  acceptFastAgentVisualCheckpoint,
  createFastAgentVisualCheckpointState,
  planFastAgentVisualCheckpoint,
} from "../src/sidepanel/services/fastAgentVisualCheckpoints";

test("navigation and visual actions request one adaptive checkpoint", () => {
  const navigation = planFastAgentVisualCheckpoint({
    enabled: true,
    captureEnabled: true,
    state: createFastAgentVisualCheckpointState(),
    toolCalls: [call("navigate", "browser_navigate", { url: "/next" })],
    toolResults: [result("navigate", "browser_navigate", { success: true })],
  });
  assert.equal(navigation.decision?.reason, "navigation");
  assert.equal(navigation.decision?.captureAllowed, true);
  assert.equal(navigation.state.attempts, 1);

  const visualAction = planFastAgentVisualCheckpoint({
    enabled: true,
    captureEnabled: true,
    state: createFastAgentVisualCheckpointState(),
    toolCalls: [call("click", "browser_click", { selector: "#open" })],
    toolResults: [result("click", "browser_click", { matched: true })],
  });
  assert.equal(visualAction.decision?.reason, "interaction_barrier");
});

test("page changes refresh DOM without capturing before visual observation starts", () => {
  const plan = planFastAgentVisualCheckpoint({
    enabled: true,
    captureEnabled: false,
    state: createFastAgentVisualCheckpointState(),
    toolCalls: [call("click", "browser_click", { selector: "#open" })],
    toolResults: [result("click", "browser_click", { matched: true })],
  });

  assert.equal(plan.decision?.reason, "interaction_barrier");
  assert.equal(plan.decision?.captureEnabled, false);
  assert.equal(plan.decision?.captureAllowed, false);
  assert.equal(plan.state.attempts, 0);
});

test("a condition wait refreshes vision but a pure timing wait does not", () => {
  const condition = planFastAgentVisualCheckpoint({
    enabled: true,
    captureEnabled: true,
    state: createFastAgentVisualCheckpointState(),
    toolCalls: [
      call("condition", "browser_wait_for", {
        selector: "[role=dialog]",
        state: "visible",
      }),
    ],
    toolResults: [
      result("condition", "browser_wait_for", {
        waited: true,
        reason: "selector",
      }),
    ],
  });
  assert.equal(condition.decision?.reason, "async_state");

  const timing = planFastAgentVisualCheckpoint({
    enabled: true,
    captureEnabled: true,
    state: createFastAgentVisualCheckpointState(),
    toolCalls: [call("timing", "browser_wait_for", { time: 2 })],
    toolResults: [
      result("timing", "browser_wait_for", {
        waited: true,
        reason: "time",
      }),
    ],
  });
  assert.equal(timing.decision, undefined);
});

test("repeated DOM observations do not trigger an extra screenshot", () => {
  const first = planFastAgentVisualCheckpoint({
    enabled: true,
    captureEnabled: true,
    state: createFastAgentVisualCheckpointState(),
    toolCalls: [call("query-1", "browser_query_dom", { query: "main" })],
    toolResults: [
      result("query-1", "browser_query_dom", { count: 1, returnedCount: 1 }),
    ],
  });
  assert.equal(first.decision, undefined);
  assert.equal(first.state.domObservationsSinceCheckpoint, 0);

  const second = planFastAgentVisualCheckpoint({
    enabled: true,
    captureEnabled: true,
    state: first.state,
    toolCalls: [call("snapshot-2", "browser_snapshot", { limit: 50 })],
    toolResults: [
      result("snapshot-2", "browser_snapshot", { returnedCount: 20 }),
    ],
  });
  assert.equal(second.decision, undefined);
  assert.equal(second.state.domObservationsSinceCheckpoint, 0);
});

test("a large incremental DOM change requests a visual checkpoint", () => {
  const plan = planFastAgentVisualCheckpoint({
    enabled: true,
    captureEnabled: true,
    state: createFastAgentVisualCheckpointState(),
    toolCalls: [
      call("snapshot-delta", "browser_snapshot", { sinceRevision: 8 }),
    ],
    toolResults: [
      result("snapshot-delta", "browser_snapshot", {
        observation: {
          delta: {
            added: 12,
            removed: 3,
            attributes: 5,
            characterData: 1,
            truncated: false,
          },
        },
      }),
    ],
  });

  assert.equal(plan.decision?.reason, "large_dom_change");
  assert.equal(plan.decision?.captureAllowed, true);
});

test("denied writes do not capture, while uncertain failures do", () => {
  const denied = planFastAgentVisualCheckpoint({
    enabled: true,
    captureEnabled: true,
    state: createFastAgentVisualCheckpointState(),
    toolCalls: [call("denied", "browser_click", { selector: "#save" })],
    toolResults: [
      result("denied", "browser_click", {
        denied: true,
        errorCode: "APPROVAL_DENIED",
      }),
    ],
  });
  assert.equal(denied.decision, undefined);

  const uncertain = planFastAgentVisualCheckpoint({
    enabled: true,
    captureEnabled: true,
    state: createFastAgentVisualCheckpointState(),
    toolCalls: [call("uncertain", "browser_click", { selector: "#save" })],
    toolResults: [
      result("uncertain", "browser_click", {
        error: "post-click verification failed",
      }),
    ],
  });
  assert.equal(uncertain.decision?.reason, "uncertain_failure");
});

test("checkpoint budget invalidates stale vision but continues DOM refresh", () => {
  const exhausted = planFastAgentVisualCheckpoint({
    enabled: true,
    captureEnabled: true,
    state: {
      ...createFastAgentVisualCheckpointState(),
      attempts: MAX_FAST_AGENT_VISUAL_CHECKPOINT_ATTEMPTS,
    },
    toolCalls: [call("click", "browser_click", { selector: "#next" })],
    toolResults: [result("click", "browser_click", { matched: true })],
  });

  assert.equal(exhausted.decision?.reason, "interaction_barrier");
  assert.equal(exhausted.decision?.captureAllowed, false);
  assert.equal(
    exhausted.state.attempts,
    MAX_FAST_AGENT_VISUAL_CHECKPOINT_ATTEMPTS,
  );
});

test("identical adaptive images are not accepted", () => {
  const state = acceptFastAgentVisualCheckpoint(
    createFastAgentVisualCheckpointState(),
    attachment("checkpoint", "same", "fast_checkpoint"),
  ).state;
  const duplicate = acceptFastAgentVisualCheckpoint(
    state,
    attachment("checkpoint", "same", "fast_checkpoint"),
  );
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.duplicate, true);

  const fresh = acceptFastAgentVisualCheckpoint(
    state,
    attachment("checkpoint-2", "new", "fast_checkpoint"),
  );
  assert.equal(fresh.accepted, true);
  assert.notEqual(fresh.state.lastImageFingerprint, state.lastImageFingerprint);
});

function call(
  id: string,
  name: string,
  args: Record<string, unknown>,
): AiRequestedToolCall {
  return {
    id,
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
  };
}

function result(
  toolCallId: string,
  name: string,
  content: Record<string, unknown>,
): AiToolResultMessage {
  return {
    toolCallId,
    name,
    content: JSON.stringify(content),
  };
}

function attachment(
  id: string,
  payload: string,
  visualPurpose?: ChatImageAttachment["visualPurpose"],
  source: ChatImageAttachment["source"] = "screenshot",
): ChatImageAttachment {
  return {
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    dataUrl: `data:image/png;base64,${payload}`,
    createdAt: "2026-07-15T00:00:00.000Z",
    source,
    visualPurpose,
  };
}

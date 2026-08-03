import assert from "node:assert/strict";
import test from "node:test";
import { findActivityMonitorAnchorMessageId } from "../src/sidepanel/services/activityMonitorAnchor";
import type { ChatMessage } from "../src/sidepanel/types";

function toolMessage(
  id: string,
  toolName: string,
  content: string,
): ChatMessage {
  return {
    id,
    role: "tool",
    toolName,
    content,
    createdAt: "2026-08-03T00:00:00.000Z",
  };
}

function activityStartMessage(id: string, streamId: string): ChatMessage {
  return toolMessage(
    id,
    "browser_activity_start",
    JSON.stringify({
      active: true,
      activityCursor: { streamId, sequence: 1 },
    }),
  );
}

test("activity monitor remains anchored to its matching start result", () => {
  const messages = [
    activityStartMessage("start-old", "activity-old"),
    toolMessage("read-old", "browser_debug_activity", "{}"),
    activityStartMessage("start-current", "activity-current"),
    toolMessage("later-evaluate", "browser_evaluate", "{}"),
    toolMessage("later-query", "browser_query_dom", "{}"),
  ];

  assert.equal(
    findActivityMonitorAnchorMessageId(messages, {
      streamId: "activity-current",
      sequence: 57,
    }),
    "start-current",
  );
});

test("manual restart falls back to the latest start result", () => {
  const messages = [
    activityStartMessage("start-old", "activity-old"),
    activityStartMessage("start-latest", "activity-latest"),
    toolMessage("later-tool", "browser_evaluate", "{}"),
  ];

  assert.equal(
    findActivityMonitorAnchorMessageId(messages, {
      streamId: "activity-restarted-from-status-card",
      sequence: 1,
    }),
    "start-latest",
  );
});

test("activity monitor has no placement without a start result", () => {
  assert.equal(
    findActivityMonitorAnchorMessageId(
      [toolMessage("later-tool", "browser_evaluate", "{}")],
      { streamId: "activity-current", sequence: 1 },
    ),
    undefined,
  );
});

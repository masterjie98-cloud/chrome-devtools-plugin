import assert from "node:assert/strict";
import test from "node:test";
import {
  appendAgentSessionEvent,
  createAgentSessionSnapshot,
  finalizeAgentSession,
  updateAgentSessionRuntime,
} from "../src/shared/agentSession";

test("AgentRun projects durable turns, tool calls, diagnostics, and terminal state", () => {
  const startedAt = "2026-08-05T00:00:00.000Z";
  let session = createAgentSessionSnapshot(
    "run-1",
    "inspect",
    startedAt,
    {
      taskId: "task-1",
      conversationId: "conversation-1",
      target: { tabId: 7, targetId: "target-7" },
    },
    "assistant-1",
  );
  session = updateAgentSessionRuntime(
    session,
    {
      phase: "model_planning",
      status: "正在请求 AI 规划",
      progress: true,
      modelRequestDelta: 1,
    },
    "2026-08-05T00:00:01.000Z",
  );
  session = appendAgentSessionEvent(session, {
    id: "event-tools",
    type: "tool_calls",
    createdAt: "2026-08-05T00:00:02.000Z",
    summary: "one tool",
    data: {
      turnId: "turn-1",
      toolCalls: [{ id: "call-1", name: "browser_status", arguments: {} }],
    },
  });
  session = appendAgentSessionEvent(session, {
    id: "event-results",
    type: "tool_results",
    createdAt: "2026-08-05T00:00:03.000Z",
    summary: "one result",
    data: {
      turnId: "turn-1",
      toolResults: [
        { toolCallId: "call-1", name: "browser_status", content: "{\"ok\":true}" },
      ],
    },
  });
  session = finalizeAgentSession(
    session,
    "completed",
    "done",
    "2026-08-05T00:00:04.000Z",
  );

  assert.equal(session.schemaVersion, 2);
  assert.equal(session.phase, "completed");
  assert.equal(session.diagnostics?.modelRequestCount, 1);
  assert.equal(session.diagnostics?.toolCallCount, 1);
  assert.equal(session.diagnostics?.completedToolCallCount, 1);
  assert.equal(session.turns?.[0]?.id, "turn-1");
  assert.equal(session.turns?.[0]?.status, "completed");
  assert.equal(session.turns?.[0]?.toolCalls[0]?.status, "returned");
  assert.equal(session.turns?.[0]?.toolCalls[0]?.resultCharCount, 11);
  assert.deepEqual(
    session.events.map((event) => event.sequence),
    [1, 2],
  );
});

test("terminal failure events preserve the concrete runtime error summary", () => {
  let session = createAgentSessionSnapshot(
    "run-failed",
    "inspect",
    "2026-08-05T01:00:00.000Z",
  );
  session = updateAgentSessionRuntime(
    session,
    {
      phase: "failed",
      progress: true,
      errorCode: "AI_REPETITIVE_OUTPUT",
      errorSummary:
        "AI_REPETITIVE_OUTPUT: repeated unit 64 chars x 48, coverage 75%",
    },
    "2026-08-05T01:00:01.000Z",
  );
  session = appendAgentSessionEvent(session, {
    id: "event-failed",
    type: "failed",
    createdAt: "2026-08-05T01:00:02.000Z",
    summary: "Agent 执行失败。",
  });

  assert.equal(
    session.diagnostics?.lastErrorSummary,
    "AI_REPETITIVE_OUTPUT: repeated unit 64 chars x 48, coverage 75%",
  );
});

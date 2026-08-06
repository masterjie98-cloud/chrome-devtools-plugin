import assert from "node:assert/strict";
import test from "node:test";
import type { DelegatedTaskSnapshot } from "../src/shared/collaborationTasks";
import type { CollaborationJsonValue } from "../src/shared/collaborationWorkspace";
import { getDelegatedTaskPhasePresentation } from "../src/sidepanel/services/delegatedTaskPresentation";

test("blocked delegated Agent with a report is presented as partial completion", () => {
  const task = taskSnapshot("failed", {
    summary: "## Pod report\n\n- Evidence retained",
    output: { agentStatus: "blocked" },
  });

  assert.deepEqual(
    getDelegatedTaskPhasePresentation(task, { active: false, queued: false }),
    { label: "部分完成", tone: "partial" },
  );
});

test("hard delegated task failure remains a failure", () => {
  const task = taskSnapshot("failed", {
    summary: "AI request failed.",
    output: { agentStatus: "failed" },
  });

  assert.deepEqual(
    getDelegatedTaskPhasePresentation(task, { active: false, queued: false }),
    { label: "失败", tone: "failed" },
  );
});

test("completed delegated task remains completed", () => {
  const task = taskSnapshot("completed", {
    summary: "## Complete report",
    output: { agentStatus: "completed" },
  });

  assert.deepEqual(
    getDelegatedTaskPhasePresentation(task, { active: false, queued: false }),
    { label: "已完成", tone: "completed" },
  );
});

function taskSnapshot(
  phase: DelegatedTaskSnapshot["phase"],
  result: { summary: string; output: CollaborationJsonValue },
): DelegatedTaskSnapshot {
  return {
    taskId: "task_presentation_test",
    phase,
    requestItem: {
      id: "ctx_delegate_presentation_test",
      kind: "task.request",
      title: "Presentation test",
      summary: "Presentation test",
      tags: [],
      visibility: "shared",
      sensitivity: "safe",
      status: "active",
      source: { actor: "mcp_agent" },
      revision: 1,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    },
    request: {
      version: "delegated-task-v1",
      type: "request",
      taskId: "task_presentation_test",
      requestType: "task",
      instruction: "Run the test",
      acceptanceCriteria: [],
      requestFingerprint: "request-fingerprint",
    },
    events: [],
    resultItem: undefined,
    result: {
      version: "delegated-task-v1",
      type: "result",
      taskId: "task_presentation_test",
      status: phase === "completed" ? "completed" : "failed",
      summary: result.summary,
      output: result.output,
      completedAt: "2026-08-06T00:01:00.000Z",
      resultFingerprint: "result-fingerprint",
    },
  };
}

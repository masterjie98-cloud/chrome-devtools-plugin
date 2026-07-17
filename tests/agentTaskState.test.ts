import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentTaskState,
  sanitizeAgentTaskState,
  transitionAgentTaskState,
} from "../src/shared/agentTaskState";
import {
  createAgentSessionSnapshot,
  finalizeAgentSession,
  updateAgentSessionTaskState,
} from "../src/shared/agentSession";

test("task state records Observe-Plan-Execute-Verify transitions", () => {
  const observed = createAgentTaskState(
    "填写表单并提交",
    "2026-07-14T08:00:00.000Z",
  );
  const executing = transitionAgentTaskState(
    observed,
    {
      phase: "execute",
      activeAction: {
        toolNames: ["browser_fill_form", "browser_click"],
        expectedOutcome: "表单提交并显示成功状态。",
      },
      verification: { required: true, evidence: [] },
    },
    "2026-07-14T08:00:01.000Z",
  );
  const verified = transitionAgentTaskState(
    executing,
    {
      phase: "verify",
      activeAction: undefined,
      verification: {
        required: false,
        evidence: ["browser_snapshot: success message visible"],
        summary: "提交结果已通过只读页面快照验证。",
      },
    },
    "2026-07-14T08:00:02.000Z",
  );

  assert.equal(observed.phase, "observe");
  assert.equal(executing.revision, 2);
  assert.equal(executing.verification.required, true);
  assert.equal(verified.phase, "verify");
  assert.equal(verified.verification.required, false);
});

test("blocked session remains distinct from completed work and keeps progress", () => {
  const session = updateAgentSessionTaskState(
    createAgentSessionSnapshot(
      "run-1",
      "执行复杂任务",
      "2026-07-14T08:00:00.000Z",
    ),
    {
      phase: "blocked",
      observations: ["已完成前两步。"],
      blockers: ["达到本轮总安全预算。"],
      verification: {
        required: true,
        evidence: ["browser_click: result received"],
      },
    },
    "2026-07-14T08:00:01.000Z",
  );
  const blocked = finalizeAgentSession(
    session,
    "blocked",
    "任务已保留进度，尚未验证完成。",
    "2026-07-14T08:00:02.000Z",
  );

  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.taskState.verification.required, true);
  assert.deepEqual(blocked.taskState.observations, ["已完成前两步。"]);
  assert.doesNotThrow(() => sanitizeAgentTaskState(blocked.taskState));
});

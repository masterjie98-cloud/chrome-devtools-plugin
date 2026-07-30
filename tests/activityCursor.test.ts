import assert from "node:assert/strict";
import test from "node:test";
import {
  getActivityCursorUpdate,
  shouldCommitDeferredActivityCursor,
  shouldDeferActivityCursorUpdate,
} from "../src/sidepanel/services/activityCursor";
import {
  applyIncrementalActivityCursor,
  isIncrementalActivitySummaryRequest,
} from "../src/sidepanel/services/activityToolCall";

test("activity cursor advances from monitor start and incremental activity results", () => {
  assert.deepEqual(
    getActivityCursorUpdate("browser_activity_start", {
      active: true,
      activityCursor: { streamId: "activity-a", sequence: 57 },
    }),
    {
      kind: "set",
      cursor: { streamId: "activity-a", sequence: 57 },
    },
  );
  assert.deepEqual(
    getActivityCursorUpdate("browser_debug_activity", {
      activity: {
        requestedAfterSequence: 57,
        streamId: "activity-a",
        nextCursor: { streamId: "activity-a", sequence: 81 },
      },
    }),
    {
      kind: "set",
      cursor: { streamId: "activity-a", sequence: 81 },
    },
  );
  assert.deepEqual(
    getActivityCursorUpdate("browser_activity_stop", { active: false }),
    { kind: "clear" },
  );
  assert.equal(
    getActivityCursorUpdate("browser_debug_activity", {
      activity: { nextSequence: -1 },
    }),
    undefined,
  );
});

test("incremental activity cursors commit only after a completed Agent summary", () => {
  assert.equal(
    shouldDeferActivityCursorUpdate("browser_debug_activity"),
    true,
  );
  assert.equal(
    shouldDeferActivityCursorUpdate("browser_activity_start"),
    false,
  );
  assert.equal(shouldCommitDeferredActivityCursor("completed"), true);
  assert.equal(shouldCommitDeferredActivityCursor("blocked"), false);
  assert.equal(shouldCommitDeferredActivityCursor("failed"), false);
  assert.equal(shouldCommitDeferredActivityCursor("cancelled"), false);
});

test("incremental monitoring requests always use the saved conversation cursor", () => {
  const calls = applyIncrementalActivityCursor(
    [
      {
        id: "activity-read",
        name: "browser_debug_activity",
        arguments: { afterSequence: 999, includeNetwork: true },
        rawArguments: '{"afterSequence":999,"includeNetwork":true}',
      },
    ],
    "刚才这个页面发生了什么变化？只读取监听开始后的增量摘要。",
    { streamId: "activity-a", sequence: 57 },
  );

  assert.equal(isIncrementalActivitySummaryRequest("监听后发生了什么变化"), true);
  assert.deepEqual(calls[0]?.arguments, {
    afterSequence: 57,
    afterStreamId: "activity-a",
    includeNetwork: true,
  });
  assert.equal(
    calls[0]?.rawArguments,
    '{"afterSequence":57,"includeNetwork":true,"afterStreamId":"activity-a"}',
  );
});

test("legacy monitored conversations recover once from sequence zero without a full snapshot", () => {
  const calls = applyIncrementalActivityCursor(
    [
      {
        id: "activity-read",
        name: "browser_debug_activity",
        arguments: {},
        rawArguments: "{}",
      },
      {
        id: "other-read",
        name: "browser_observe",
        arguments: { mode: "interactive" },
        rawArguments: '{"mode":"interactive"}',
      },
    ],
    "读取监听开始后的增量 Network、DOM 和 Console 变化",
    undefined,
  );

  assert.deepEqual(calls[0]?.arguments, { afterSequence: 0 });
  assert.deepEqual(calls[1]?.arguments, { mode: "interactive" });
});

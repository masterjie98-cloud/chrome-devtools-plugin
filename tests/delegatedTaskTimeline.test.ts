import assert from "node:assert/strict";
import test from "node:test";
import type { DelegatedTaskSnapshot } from "../src/shared/collaborationTasks";
import {
  hasPersistedPluginReply,
  projectDelegatedTaskTimeline,
} from "../src/sidepanel/delegatedTaskTimeline";

const task = {
  taskId: "task_timeline1234",
  phase: "completed",
  requestItem: {
    id: "ctx_delegate_timeline1234",
    kind: "task.request",
    title: "检查发布状态",
    summary: "检查发布状态",
    content: {},
    tags: ["delegated-task"],
    visibility: "shared",
    sensitivity: "safe",
    status: "active",
    source: { actor: "mcp_agent" },
    revision: 1,
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
  },
  request: {
    version: "delegated-task-v1",
    type: "request",
    taskId: "task_timeline1234",
    requestType: "task",
    instruction: "检查发布状态并返回证据。",
    acceptanceCriteria: ["返回状态", "列出证据"],
    requestFingerprint: "requestFingerprint1234",
  },
  events: [
    {
      item: {
        id: "ctx_event_timeline1234_progress",
        kind: "task.state",
        title: "progress",
        summary: "正在读取状态",
        content: {},
        tags: ["delegated-task", "event"],
        visibility: "shared",
        sensitivity: "safe",
        status: "active",
        source: { actor: "extension_agent" },
        parentId: "ctx_delegate_timeline1234",
        revision: 1,
        createdAt: "2026-08-07T00:00:01.000Z",
        updatedAt: "2026-08-07T00:00:01.000Z",
      },
      content: {
        version: "delegated-task-v1",
        type: "event",
        taskId: "task_timeline1234",
        eventId: "evt_progress1234",
        eventType: "progress",
        message: "正在读取状态",
        progress: 40,
        eventFingerprint: "eventFingerprint1234",
        publishedAt: "2026-08-07T00:00:01.000Z",
      },
    },
    {
      item: {
        id: "ctx_event_timeline1234_evidence",
        kind: "task.state",
        title: "evidence",
        summary: "已找到发布记录",
        content: {},
        tags: ["delegated-task", "event"],
        visibility: "shared",
        sensitivity: "safe",
        status: "active",
        source: { actor: "mcp_agent" },
        parentId: "ctx_delegate_timeline1234",
        revision: 1,
        createdAt: "2026-08-07T00:00:03.000Z",
        updatedAt: "2026-08-07T00:00:03.000Z",
      },
      content: {
        version: "delegated-task-v1",
        type: "event",
        taskId: "task_timeline1234",
        eventId: "evt_evidence1234",
        eventType: "evidence",
        message: "已找到发布记录",
        artifactUris: ["ai-devtools://artifact/evidence-1"],
        eventFingerprint: "eventFingerprint5678",
        publishedAt: "2026-08-07T00:00:03.000Z",
      },
    },
  ],
  resultItem: {
    id: "ctx_result_timeline1234",
    kind: "task.result",
    title: "Result: 检查发布状态",
    summary: "发布正常。",
    content: {},
    tags: ["delegated-task", "result"],
    visibility: "shared",
    sensitivity: "safe",
    status: "resolved",
    source: { actor: "extension_agent" },
    parentId: "ctx_delegate_timeline1234",
    revision: 1,
    createdAt: "2026-08-07T00:00:04.000Z",
    updatedAt: "2026-08-07T00:00:04.000Z",
  },
  result: {
    version: "delegated-task-v1",
    type: "result",
    taskId: "task_timeline1234",
    status: "completed",
    summary: "发布正常。",
    completedAt: "2026-08-07T00:00:04.000Z",
    resultFingerprint: "resultFingerprint1234",
  },
} satisfies DelegatedTaskSnapshot;

test("delegated task records project into a chronological two-agent chat", () => {
  const messages = projectDelegatedTaskTimeline(task, { includeResult: true });

  assert.deepEqual(
    messages.map(({ id, source }) => [id, source]),
    [
      ["ctx_delegate_timeline1234", "mcp_ai"],
      ["ctx_event_timeline1234_progress", "extension_ai"],
      ["ctx_event_timeline1234_evidence", "mcp_ai"],
      ["ctx_result_timeline1234", "extension_ai"],
    ],
  );
  assert.match(messages[0]?.content ?? "", /检查发布状态并返回证据/);
  assert.match(messages[1]?.content ?? "", /40%/);
  assert.match(messages[2]?.content ?? "", /ai-devtools:\/\/artifact\/evidence-1/);
  assert.equal(messages.some((message) => message.delegatedTaskId), false);
});

test("a persisted plugin reply suppresses the duplicated task result bubble", () => {
  const persistedReply = {
    id: "plugin-reply",
    role: "assistant" as const,
    source: "extension_ai" as const,
    content: "发布正常。",
    createdAt: "2026-08-07T00:00:03.500Z",
  };

  assert.equal(hasPersistedPluginReply([persistedReply], task), true);
  assert.deepEqual(
    projectDelegatedTaskTimeline(task, { includeResult: false }).map(
      (message) => message.id,
    ),
    [
      "ctx_delegate_timeline1234",
      "ctx_event_timeline1234_progress",
      "ctx_event_timeline1234_evidence",
    ],
  );
});

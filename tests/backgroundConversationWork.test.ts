import assert from "node:assert/strict";
import test from "node:test";
import {
  getBackgroundConversationWork,
  listConversationApprovals,
  listConversationQueue,
} from "../src/sidepanel/services/backgroundConversationWork";
import type {
  PendingToolApproval,
  QueuedChatSubmission,
} from "../src/sidepanel/types";

const approvals: PendingToolApproval[] = [
  pendingApproval("approval-old", "chat-old"),
  pendingApproval("approval-new", "chat-new"),
];
const queued: QueuedChatSubmission[] = [
  queuedSubmission("queue-old", "chat-old"),
  queuedSubmission("queue-new", "chat-new"),
];

test("approval and queue projections never cross conversation boundaries", () => {
  assert.deepEqual(
    listConversationApprovals(approvals, "chat-new").map(
      (approval) => approval.id,
    ),
    ["approval-new"],
  );
  assert.deepEqual(
    listConversationQueue(queued, "chat-new").map(
      (submission) => submission.id,
    ),
    ["queue-new"],
  );
});

test("another conversation's active run becomes one background notification", () => {
  const work = getBackgroundConversationWork({
    activeConversationId: "chat-new",
    activeExecutionBinding: {
      taskId: "task_background1",
      conversationId: "chat-old",
      target: {
        tabId: 7,
        title: "Reports",
        url: "https://example.test/reports",
      },
    },
    conversations: [
      {
        id: "chat-old",
        title: "旧任务",
        updatedAt: "2026-07-29T00:00:00.000Z",
        messageCount: 3,
        hasDraft: false,
        forked: false,
        searchText: "",
        exportMarkdown: "",
        exportJson: "",
      },
    ],
    approvals,
    queued,
    activeDelegatedTaskId: "task_delegated1",
  });

  assert.deepEqual(work, {
    conversationId: "chat-old",
    conversationTitle: "旧任务",
    target: {
      tabId: 7,
      title: "Reports",
      url: "https://example.test/reports",
    },
    pendingApprovalCount: 1,
    queuedCount: 1,
    recoverableDelegatedTask: true,
  });
});

test("the active conversation never reports its own run as background work", () => {
  assert.equal(
    getBackgroundConversationWork({
      activeConversationId: "chat-old",
      activeExecutionBinding: {
        taskId: "task_background1",
        conversationId: "chat-old",
        target: { tabId: 7 },
      },
      conversations: [],
      approvals,
      queued,
    }),
    undefined,
  );
});

function pendingApproval(
  id: string,
  conversationId: string,
): PendingToolApproval {
  return {
    id,
    conversationId,
    toolName: "browser_apply_css_patch",
    arguments: {},
    policyClass: "reversible_write",
    approvalMode: "task_grant",
    reason: "Page write",
    allowForConversationOriginAvailable: false,
  };
}

function queuedSubmission(
  id: string,
  conversationId: string,
): QueuedChatSubmission {
  return {
    id,
    conversationId,
    input: "continue",
    attachments: [],
    createdAt: "2026-07-29T00:00:00.000Z",
  };
}

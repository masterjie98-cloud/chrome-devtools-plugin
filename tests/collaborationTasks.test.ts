import assert from "node:assert/strict";
import test from "node:test";
import { ExecutionBrokerError } from "../src/daemon/executionBroker";
import { BrowserStateHub } from "../src/mcp/browserStateHub";
import {
  cancelCollaborationTask,
  claimCollaborationTask,
  completeCollaborationTask,
  delegateCollaborationTask,
  updateCollaborationTask,
  waitForCollaborationTaskResult,
} from "../src/mcp/collaborationTaskRuntime";
import {
  DELEGATED_TASK_VERSION,
  decodeDelegatedTaskConversationKey,
  delegatedTaskClaimItemId,
  delegatedTaskConversationKey,
  delegatedTaskEventItemId,
  findDelegatedTask,
  isDelegatedTaskBoundToConversation,
  isDelegatedTaskConversationId,
  isDelegatedTaskInboxActionable,
  isDelegatedTaskOrphaned,
} from "../src/shared/collaborationTasks";

const SESSION_ID = "profile-collaboration";

test("delegated conversation keys round-trip without creating a second identity", () => {
  const conversationId = "chat-中文-🧪";
  const key = delegatedTaskConversationKey(conversationId);
  assert.equal(decodeDelegatedTaskConversationKey(key), conversationId);
  assert.equal(decodeDelegatedTaskConversationKey("conv_invalid"), undefined);
});

test("long delegated task event IDs remain bounded and collision resistant", () => {
  const taskId = `task_${"a".repeat(120)}`;
  const first = delegatedTaskEventItemId(taskId, `evt_${"b".repeat(79)}1`);
  const second = delegatedTaskEventItemId(taskId, `evt_${"b".repeat(79)}2`);

  assert.equal(first.length, 200);
  assert.equal(second.length, 200);
  assert.notEqual(first, second);
});

test("delegated tasks deduplicate by taskId and reject conflicting reuse", () => {
  const hub = createHubWithTarget();
  const first = delegateCollaborationTask(
    delegateArgs(),
    SESSION_ID,
    "codex-1",
    hub,
  );
  const retry = delegateCollaborationTask(
    delegateArgs(),
    SESSION_ID,
    "codex-2",
    hub,
  );

  assert.equal(first.data.deduplicated, false);
  assert.equal(retry.data.deduplicated, true);
  assert.equal(hub.snapshot(SESSION_ID).collaborationWorkspace.items.length, 1);
  assert.throws(
    () =>
      delegateCollaborationTask(
        { ...delegateArgs(), instruction: "Do different work." },
        SESSION_ID,
        "codex-1",
        hub,
      ),
    (error: unknown) =>
      error instanceof ExecutionBrokerError &&
      error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("a persisted result resolves current and reconnected waiters without replay", async () => {
  const hub = createHubWithTarget();
  delegateCollaborationTask(delegateArgs(), SESSION_ID, "codex", hub);
  const claim = claimCollaborationTask(
    { taskId: "task_abcdefgh", resume: false, conversationId: "chat-one" },
    SESSION_ID,
    "sidepanel-1",
    hub,
  );
  assert.equal(claim.data.claimed, true);
  assert.equal(claim.data.attempt, 1);
  const duplicateClaim = claimCollaborationTask(
    { taskId: "task_abcdefgh", resume: false, conversationId: "chat-one" },
    SESSION_ID,
    "sidepanel-2",
    hub,
  );
  assert.equal(duplicateClaim.data.claimed, false);

  const controller = new AbortController();
  const waiting = waitForCollaborationTaskResult(
    "task_abcdefgh",
    SESSION_ID,
    controller.signal,
    hub,
  );
  completeCollaborationTask(
    {
      taskId: "task_abcdefgh",
      status: "completed",
      summary: "Verified complete.",
      output: { verified: true },
      agentSessionId: "agent-1",
      conversationId: "chat-one",
    },
    SESSION_ID,
    "sidepanel-1",
    hub,
  );

  const result = await waiting;
  assert.equal(result.status, "completed");
  const restored = new BrowserStateHub();
  restored.restorePersistentState(hub.toPersistentState());
  const reconnectedResult = await waitForCollaborationTaskResult(
    "task_abcdefgh",
    SESSION_ID,
    new AbortController().signal,
    restored,
  );
  assert.equal(reconnectedResult.status, "completed");
  assert.equal(
    findDelegatedTask(
      restored.snapshot(SESSION_ID).collaborationWorkspace,
      "task_abcdefgh",
    )?.result?.summary,
    "Verified complete.",
  );
  const duplicateResult = completeCollaborationTask(
    {
      taskId: "task_abcdefgh",
      status: "completed",
      summary: "Verified complete.",
      output: { verified: true },
      agentSessionId: "agent-1",
      conversationId: "chat-one",
    },
    SESSION_ID,
    "sidepanel-2",
    restored,
  );
  assert.equal(duplicateResult.data.deduplicated, true);
  assert.throws(
    () =>
      completeCollaborationTask(
        {
          taskId: "task_abcdefgh",
          status: "failed",
          summary: "Try to replace the stored result.",
          conversationId: "chat-one",
        },
        SESSION_ID,
        "sidepanel-2",
        restored,
      ),
    (error: unknown) =>
      error instanceof ExecutionBrokerError &&
      error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("acceptance binds a task to one conversation and rejects cross-conversation resume", () => {
  const hub = createHubWithTarget();
  delegateCollaborationTask(delegateArgs(), SESSION_ID, "codex", hub);
  const pending = findDelegatedTask(
    hub.snapshot(SESSION_ID).collaborationWorkspace,
    "task_abcdefgh",
  );
  assert.ok(pending);
  assert.equal(isDelegatedTaskInboxActionable(pending), true);

  claimCollaborationTask(
    { taskId: "task_abcdefgh", resume: false, conversationId: "chat-one" },
    SESSION_ID,
    "sidepanel",
    hub,
  );
  const claimed = findDelegatedTask(
    hub.snapshot(SESSION_ID).collaborationWorkspace,
    "task_abcdefgh",
  );
  assert.ok(claimed);
  assert.equal(
    claimed.claim?.conversationKey,
    delegatedTaskConversationKey("chat-one"),
  );
  assert.equal(isDelegatedTaskBoundToConversation(claimed, "chat-one"), true);
  assert.equal(isDelegatedTaskBoundToConversation(claimed, "chat-two"), false);
  assert.equal(isDelegatedTaskInboxActionable(claimed), false);
  assert.equal(isDelegatedTaskInboxActionable(claimed, ["chat-one"]), false);
  assert.equal(isDelegatedTaskInboxActionable(claimed, []), true);
  assert.equal(JSON.stringify(claimed.claimItem).includes("REDACTED"), false);

  assert.throws(
    () =>
      completeCollaborationTask(
        {
          taskId: "task_abcdefgh",
          status: "completed",
          summary: "Do not cross conversations.",
          conversationId: "chat-two",
        },
        SESSION_ID,
        "sidepanel",
        hub,
      ),
    (error: unknown) =>
      error instanceof ExecutionBrokerError && error.code === "STALE_CONTEXT",
  );

  assert.throws(
    () =>
      claimCollaborationTask(
        { taskId: "task_abcdefgh", resume: true, conversationId: "chat-two" },
        SESSION_ID,
        "sidepanel",
        hub,
      ),
    (error: unknown) =>
      error instanceof ExecutionBrokerError && error.code === "STALE_CONTEXT",
  );
});

test("a task whose local conversation was deleted can be restored into a clean conversation", () => {
  const hub = createHubWithTarget();
  delegateCollaborationTask(delegateArgs(), SESSION_ID, "codex", hub);
  claimCollaborationTask(
    { taskId: "task_abcdefgh", resume: false, conversationId: "chat-old" },
    SESSION_ID,
    "sidepanel",
    hub,
  );
  const orphaned = findDelegatedTask(
    hub.snapshot(SESSION_ID).collaborationWorkspace,
    "task_abcdefgh",
  );
  assert.ok(orphaned);
  assert.equal(
    isDelegatedTaskOrphaned(orphaned, ["chat-current"]),
    true,
  );
  assert.equal(
    isDelegatedTaskInboxActionable(orphaned, ["chat-current"]),
    true,
  );

  const rebound = claimCollaborationTask(
    {
      taskId: "task_abcdefgh",
      resume: true,
      rebind: true,
      conversationId: "chat-clean",
    },
    SESSION_ID,
    "sidepanel",
    hub,
  );
  assert.equal(rebound.data.rebound, true);
  const restored = findDelegatedTask(
    hub.snapshot(SESSION_ID).collaborationWorkspace,
    "task_abcdefgh",
  );
  assert.ok(restored);
  assert.equal(
    isDelegatedTaskBoundToConversation(restored, "chat-clean"),
    true,
  );
  assert.equal(
    isDelegatedTaskOrphaned(restored, ["chat-clean"]),
    false,
  );
  assert.equal(restored.claim?.requiresReobservation, true);
  assert.equal(
    restored.claim?.previousConversationKey,
    delegatedTaskConversationKey("chat-old"),
  );
});

test("restoring into a clean conversation tolerates a refreshed document in the same Tab", () => {
  const hub = createHubWithTarget();
  delegateCollaborationTask(delegateArgs(), SESSION_ID, "codex", hub);
  claimCollaborationTask(
    { taskId: "task_abcdefgh", resume: false, conversationId: "chat-old" },
    SESSION_ID,
    "sidepanel-before-refresh",
    hub,
  );
  hub.setCurrentTab(
    {
      url: "https://example.test/form",
      title: "Form",
      targetId: "target-1",
      tabId: 7,
      windowId: 3,
      frameId: 0,
      documentId: "document-2",
      navigationId: "navigation-2",
    },
    SESSION_ID,
  );

  const rebound = claimCollaborationTask(
    {
      taskId: "task_abcdefgh",
      resume: true,
      rebind: true,
      conversationId: "chat-clean",
    },
    SESSION_ID,
    "sidepanel-after-refresh",
    hub,
  );

  assert.equal(rebound.data.claimed, true);
  assert.equal(rebound.data.rebound, true);
  const restored = findDelegatedTask(
    hub.snapshot(SESSION_ID).collaborationWorkspace,
    "task_abcdefgh",
  );
  assert.ok(restored?.claimItem);
  assert.equal(restored.claimItem.target?.documentId, "document-2");
  assert.equal(restored.claimItem.target?.navigationId, "navigation-2");
});

test("an orphaned claimed task can be cancelled through its original conversation binding", async () => {
  const hub = createHubWithTarget();
  delegateCollaborationTask(delegateArgs(), SESSION_ID, "codex", hub);
  claimCollaborationTask(
    { taskId: "task_abcdefgh", resume: false, conversationId: "chat-old" },
    SESSION_ID,
    "sidepanel",
    hub,
  );
  const task = findDelegatedTask(
    hub.snapshot(SESSION_ID).collaborationWorkspace,
    "task_abcdefgh",
  );
  assert.ok(task?.claim?.conversationKey);
  const boundConversationId = decodeDelegatedTaskConversationKey(
    task.claim.conversationKey,
  );
  assert.equal(boundConversationId, "chat-old");
  const waiting = waitForCollaborationTaskResult(
    "task_abcdefgh",
    SESSION_ID,
    new AbortController().signal,
    hub,
  );

  completeCollaborationTask(
    {
      taskId: "task_abcdefgh",
      status: "cancelled",
      summary: "The user closed the orphaned task from the extension inbox.",
      conversationId: boundConversationId,
    },
    SESSION_ID,
    "sidepanel",
    hub,
  );

  assert.equal((await waiting).status, "cancelled");
  assert.equal(
    findDelegatedTask(
      hub.snapshot(SESSION_ID).collaborationWorkspace,
      "task_abcdefgh",
    )?.phase,
    "cancelled",
  );
});

test("an unbound terminal task is not projected into any conversation or inbox", () => {
  const hub = createHubWithTarget();
  delegateCollaborationTask(delegateArgs(), SESSION_ID, "codex", hub);
  completeCollaborationTask(
    {
      taskId: "task_abcdefgh",
      status: "rejected",
      summary: "User rejected before accepting the task.",
    },
    SESSION_ID,
    "sidepanel",
    hub,
  );

  const rejected = findDelegatedTask(
    hub.snapshot(SESSION_ID).collaborationWorkspace,
    "task_abcdefgh",
  );
  assert.ok(rejected);
  assert.equal(rejected.phase, "rejected");
  assert.equal(isDelegatedTaskInboxActionable(rejected), false);
  assert.equal(isDelegatedTaskBoundToConversation(rejected, "chat-one"), false);
  assert.equal(isDelegatedTaskBoundToConversation(rejected, "chat-two"), false);
});

test("conversation projection fails closed for malformed local conversation IDs", () => {
  const hub = createHubWithTarget();
  delegateCollaborationTask(delegateArgs(), SESSION_ID, "codex", hub);
  const pending = findDelegatedTask(
    hub.snapshot(SESSION_ID).collaborationWorkspace,
    "task_abcdefgh",
  );
  assert.ok(pending);
  assert.equal(isDelegatedTaskConversationId("chat-safe"), true);
  assert.equal(isDelegatedTaskConversationId("chat\nunsafe"), false);
  assert.equal(isDelegatedTaskBoundToConversation(pending, "chat\nunsafe"), false);
  assert.throws(
    () => delegatedTaskConversationKey("chat\nunsafe"),
    /conversation ID is invalid/,
  );
});

test("an explicitly resumed legacy claim binds to the current conversation", () => {
  const hub = createHubWithTarget();
  delegateCollaborationTask(delegateArgs(), SESSION_ID, "codex", hub);
  const request = findDelegatedTask(
    hub.snapshot(SESSION_ID).collaborationWorkspace,
    "task_abcdefgh",
  );
  assert.ok(request);
  hub.upsertCollaborationItem(
    {
      id: delegatedTaskClaimItemId("task_abcdefgh"),
      kind: "task.state",
      title: "Legacy accepted task",
      summary: "Accepted before conversation binding existed.",
      content: {
        version: DELEGATED_TASK_VERSION,
        type: "claim",
        taskId: "task_abcdefgh",
        attempt: 1,
        resumed: false,
        requiresReobservation: false,
      },
      tags: ["delegated-task", "accepted"],
      visibility: "shared",
      sensitivity: request.requestItem.sensitivity,
      status: "active",
      parentId: request.requestItem.id,
      target: request.requestItem.target,
    },
    { actor: "extension_agent", clientId: "legacy-sidepanel" },
    SESSION_ID,
  );
  const legacy = findDelegatedTask(
    hub.snapshot(SESSION_ID).collaborationWorkspace,
    "task_abcdefgh",
  );
  assert.ok(legacy);
  assert.equal(legacy.phase, "claimed");
  assert.equal(isDelegatedTaskInboxActionable(legacy), true);

  claimCollaborationTask(
    {
      taskId: "task_abcdefgh",
      resume: true,
      conversationId: "chat-migrated",
    },
    SESSION_ID,
    "sidepanel",
    hub,
  );
  const migrated = findDelegatedTask(
    hub.snapshot(SESSION_ID).collaborationWorkspace,
    "task_abcdefgh",
  );
  assert.ok(migrated);
  assert.equal(
    isDelegatedTaskBoundToConversation(migrated, "chat-migrated"),
    true,
  );
  assert.equal(migrated.claim?.attempt, 2);
});

test("delegated tasks remain isolated to their Profile session", () => {
  const hub = createHubWithTarget();
  delegateCollaborationTask(delegateArgs(), SESSION_ID, "codex", hub);

  assert.throws(
    () =>
      claimCollaborationTask(
        {
          taskId: "task_abcdefgh",
          resume: false,
          conversationId: "other-chat",
        },
        "different-profile",
        "different-sidepanel",
        hub,
      ),
    (error: unknown) =>
      error instanceof ExecutionBrokerError && error.code === "STALE_CONTEXT",
  );
});

test("disconnect cancellation stops only the waiter and explicit resume increments the attempt", async () => {
  const hub = createHubWithTarget();
  delegateCollaborationTask(delegateArgs(), SESSION_ID, "codex", hub);
  claimCollaborationTask(
    { taskId: "task_abcdefgh", resume: false, conversationId: "chat-resume" },
    SESSION_ID,
    "sidepanel-before-reload",
    hub,
  );

  const controller = new AbortController();
  const waiting = waitForCollaborationTaskResult(
    "task_abcdefgh",
    SESSION_ID,
    controller.signal,
    hub,
  );
  controller.abort(new Error("Codex adapter disconnected"));
  await assert.rejects(waiting, /Codex adapter disconnected/);
  assert.equal(
    findDelegatedTask(
      hub.snapshot(SESSION_ID).collaborationWorkspace,
      "task_abcdefgh",
    )?.phase,
    "claimed",
  );

  const restored = new BrowserStateHub();
  restored.restorePersistentState(hub.toPersistentState());
  const resumed = claimCollaborationTask(
    { taskId: "task_abcdefgh", resume: true, conversationId: "chat-resume" },
    SESSION_ID,
    "sidepanel-after-reload",
    restored,
  );
  assert.equal(resumed.data.claimed, true);
  assert.equal(resumed.data.resumed, true);
  assert.equal(resumed.data.attempt, 2);
  const task = findDelegatedTask(
    restored.snapshot(SESSION_ID).collaborationWorkspace,
    "task_abcdefgh",
  );
  assert.equal(task?.claim?.requiresReobservation, true);
});

test("page-scoped delegation fails closed when the target changes before acceptance", () => {
  const hub = createHubWithTarget();
  delegateCollaborationTask(delegateArgs(), SESSION_ID, "codex", hub);
  hub.setCurrentTab(
    {
      url: "https://example.test/next",
      title: "Next",
      targetId: "target-2",
      tabId: 8,
      windowId: 3,
      frameId: 0,
      documentId: "document-2",
      navigationId: "navigation-2",
    },
    SESSION_ID,
  );

  assert.throws(
    () =>
      claimCollaborationTask(
        {
          taskId: "task_abcdefgh",
          resume: false,
          conversationId: "chat-stale",
        },
        SESSION_ID,
        "sidepanel",
        hub,
      ),
    (error: unknown) =>
      error instanceof ExecutionBrokerError && error.code === "STALE_CONTEXT",
  );
});

test("a stale unclaimed delegation can close as cancelled for its waiter", async () => {
  const hub = createHubWithTarget();
  delegateCollaborationTask(delegateArgs(), SESSION_ID, "codex", hub);
  const waiting = waitForCollaborationTaskResult(
    "task_abcdefgh",
    SESSION_ID,
    new AbortController().signal,
    hub,
  );
  hub.setCurrentTab(
    {
      url: "https://example.test/next",
      title: "Next",
      targetId: "target-2",
      tabId: 8,
      windowId: 3,
      frameId: 0,
      documentId: "document-2",
      navigationId: "navigation-2",
    },
    SESSION_ID,
  );

  completeCollaborationTask(
    {
      taskId: "task_abcdefgh",
      status: "cancelled",
      summary: "The delegated page changed before acceptance.",
    },
    SESSION_ID,
    "sidepanel",
    hub,
  );

  assert.equal((await waiting).status, "cancelled");
  assert.equal(
    findDelegatedTask(
      hub.snapshot(SESSION_ID).collaborationWorkspace,
      "task_abcdefgh",
    )?.phase,
    "cancelled",
  );
});

test("a fresh unclaimed delegation cannot be cancelled without acceptance", () => {
  const hub = createHubWithTarget();
  delegateCollaborationTask(delegateArgs(), SESSION_ID, "codex", hub);

  assert.throws(
    () =>
      completeCollaborationTask(
        {
          taskId: "task_abcdefgh",
          status: "cancelled",
          summary: "Do not bypass acceptance.",
        },
        SESSION_ID,
        "sidepanel",
        hub,
      ),
    (error: unknown) =>
      error instanceof ExecutionBrokerError && error.code === "ROLE_FORBIDDEN",
  );
});

test("collaboration task V2 appends idempotent progress and evidence events", () => {
  const hub = createHubWithTarget();
  delegateCollaborationTask(delegateArgs(), SESSION_ID, "codex", hub);
  claimCollaborationTask(
    { taskId: "task_abcdefgh", resume: false, conversationId: "chat-events" },
    SESSION_ID,
    "sidepanel",
    hub,
  );

  const progress = updateCollaborationTask(
    {
      taskId: "task_abcdefgh",
      eventId: "evt_progress01",
      eventType: "progress",
      message: "Observed the form.",
      progress: 40,
      conversationId: "chat-events",
    },
    SESSION_ID,
    "sidepanel",
    "extension_agent",
    hub,
  );
  const duplicate = updateCollaborationTask(
    {
      taskId: "task_abcdefgh",
      eventId: "evt_progress01",
      eventType: "progress",
      message: "Observed the form.",
      progress: 40,
      conversationId: "chat-events",
    },
    SESSION_ID,
    "sidepanel-reconnected",
    "extension_agent",
    hub,
  );
  updateCollaborationTask(
    {
      taskId: "task_abcdefgh",
      eventId: "evt_evidence01",
      eventType: "evidence",
      message: "Attached the bounded issue bundle.",
      artifactUris: ["ai-devtools://artifact/evidence-1"],
    },
    SESSION_ID,
    "codex",
    "mcp_agent",
    hub,
  );

  assert.equal(progress.data.deduplicated, false);
  assert.equal(duplicate.data.deduplicated, true);
  const task = findDelegatedTask(
    hub.snapshot(SESSION_ID).collaborationWorkspace,
    "task_abcdefgh",
  );
  assert.equal(task?.events.length, 2);
  assert.equal(task?.events[0]?.content.progress, 40);
  assert.deepEqual(task?.events[1]?.content.artifactUris, [
    "ai-devtools://artifact/evidence-1",
  ]);
  assert.throws(
    () =>
      updateCollaborationTask(
        {
          taskId: "task_abcdefgh",
          eventId: "evt_progress01",
          eventType: "progress",
          message: "Conflicting event content.",
          progress: 80,
          conversationId: "chat-events",
        },
        SESSION_ID,
        "sidepanel",
        "extension_agent",
        hub,
      ),
    (error: unknown) =>
      error instanceof ExecutionBrokerError &&
      error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("Codex can durably cancel pending delegated work", async () => {
  const hub = createHubWithTarget();
  delegateCollaborationTask(delegateArgs(), SESSION_ID, "codex", hub);
  const waiting = waitForCollaborationTaskResult(
    "task_abcdefgh",
    SESSION_ID,
    new AbortController().signal,
    hub,
  );

  cancelCollaborationTask(
    {
      taskId: "task_abcdefgh",
      reason: "The parent Codex task was cancelled.",
    },
    SESSION_ID,
    "codex",
    hub,
  );

  assert.equal((await waiting).status, "cancelled");
  assert.equal(
    findDelegatedTask(
      hub.snapshot(SESSION_ID).collaborationWorkspace,
      "task_abcdefgh",
    )?.phase,
    "cancelled",
  );
});

function createHubWithTarget(): BrowserStateHub {
  const hub = new BrowserStateHub();
  hub.setCurrentTab(
    {
      url: "https://example.test/form",
      title: "Form",
      targetId: "target-1",
      tabId: 7,
      windowId: 3,
      frameId: 0,
      documentId: "document-1",
      navigationId: "navigation-1",
    },
    SESSION_ID,
  );
  return hub;
}

function delegateArgs() {
  return {
    taskId: "task_abcdefgh",
    requestType: "task" as const,
    title: "Inspect the selected form",
    instruction: "Explain why the submit button is disabled.",
    acceptanceCriteria: ["Use current page evidence."],
    scope: "target" as const,
    sensitivity: "page_content" as const,
  };
}

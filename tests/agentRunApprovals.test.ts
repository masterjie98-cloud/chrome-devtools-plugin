import assert from "node:assert/strict";
import test from "node:test";
import {
  createConversationExecutionApproval,
  createAgentConversationOriginApprovalGrant,
  createAgentToolIdempotencyKey,
  executionApprovalModeAllows,
  getAgentConversationOriginInvalidationReason,
  getApprovalTargetOrigin,
  matchesConversationExecutionApproval,
  matchesAgentConversationOriginApproval,
} from "../src/sidepanel/agentRunApprovals";

const baseScope = {
  toolName: "browser_set_dom_value",
  policyClass: "page_action",
  approvalMode: "task_grant",
  requester: {
    role: "ui" as const,
    clientName: "chrome-extension-sidepanel",
    connectionId: "ui-connection-1",
  },
  requesterOwnedByCurrentPanel: true,
  sessionId: "profile-session-1",
  revision: 7,
  target: {
    url: "https://example.test/form",
    title: "Fixture",
    targetId: "target-1",
    tabId: 10,
    windowId: 2,
    frameId: 0,
    documentId: "document-1",
    navigationId: "navigation-1",
    revision: 7,
  },
  egressDestinations: ["AI Provider: https://provider.example"],
};

test("three execution approval modes preserve the risk boundary", () => {
  assert.equal(executionApprovalModeAllows("ask", "task_grant"), false);
  assert.equal(executionApprovalModeAllows("ask", "always"), false);
  assert.equal(executionApprovalModeAllows("agent", "task_grant"), true);
  assert.equal(executionApprovalModeAllows("agent", "decision_barrier"), false);
  assert.equal(executionApprovalModeAllows("full", "decision_barrier"), true);
  assert.equal(executionApprovalModeAllows("full", "always"), true);
  assert.equal(executionApprovalModeAllows("full", undefined), false);
  assert.equal(executionApprovalModeAllows("full", "unknown"), false);
});

test("agent approval is bound to the active chat, origin, and profile", () => {
  const approval = createConversationExecutionApproval("agent", {
    conversationId: "conversation-1",
    pageUrl: "https://example.test/form",
    sessionId: "profile-session-1",
    egressDestinations: ["AI Provider: https://provider.example"],
  });
  assert.ok(approval);
  assert.equal(
    matchesConversationExecutionApproval(approval, {
      conversationId: "conversation-1",
      targetUrl: "https://example.test/next",
      sessionId: "profile-session-1",
    }),
    true,
  );
  assert.equal(
    matchesConversationExecutionApproval(approval, {
      conversationId: "conversation-2",
      targetUrl: "https://example.test/next",
      sessionId: "profile-session-1",
    }),
    false,
  );
  assert.equal(
    matchesConversationExecutionApproval(approval, {
      conversationId: "conversation-1",
      targetUrl: "https://other.test/next",
      sessionId: "profile-session-1",
    }),
    false,
  );
  assert.equal(
    matchesConversationExecutionApproval(approval, {
      conversationId: "conversation-1",
      targetUrl: "https://example.test/next",
      sessionId: "profile-session-2",
    }),
    false,
  );
});

test("full approval follows one selected tab across cross-origin login redirects", () => {
  const approval = createConversationExecutionApproval("full", {
    conversationId: "conversation-1",
    pageUrl: "https://app.example.test/form",
    tabId: 10,
    targetId: "target-10",
    sessionId: "profile-session-1",
    egressDestinations: ["AI Provider: https://provider.example"],
  });
  assert.ok(approval);
  assert.deepEqual(approval.scope, {
    kind: "tab",
    tabId: 10,
    targetId: "target-10",
  });
  assert.equal(
    matchesConversationExecutionApproval(approval, {
      conversationId: "conversation-1",
      targetUrl: "https://login.example.test/oauth",
      targetTabId: 10,
      targetId: "target-10",
      sessionId: "profile-session-1",
    }),
    true,
  );
  assert.equal(
    matchesConversationExecutionApproval(approval, {
      conversationId: "conversation-1",
      targetUrl: "https://app.example.test/returned",
      targetTabId: 11,
      targetId: "target-11",
      sessionId: "profile-session-1",
    }),
    false,
  );
});

test("ask mode and incomplete page context cannot create persistent execution approval", () => {
  const current = {
    conversationId: "conversation-1",
    pageUrl: "https://example.test/form",
    sessionId: "profile-session-1",
    egressDestinations: [],
  };
  assert.equal(createConversationExecutionApproval("ask", current), null);
  assert.equal(
    createConversationExecutionApproval("full", {
      ...current,
      tabId: undefined,
    }),
    null,
  );
  assert.ok(
    createConversationExecutionApproval("full", {
      ...current,
      tabId: 10,
    }),
  );
  assert.equal(
    createConversationExecutionApproval("full", {
      ...current,
      sessionId: undefined,
    }),
    null,
  );
});

test("conversation-origin approval matches other eligible tools and revisions", () => {
  const grant = createAgentConversationOriginApprovalGrant(
    "conversation-1",
    baseScope,
  );

  assert.ok(grant);
  assert.equal(
    matchesAgentConversationOriginApproval(grant, "conversation-1", {
      ...baseScope,
      toolName: "browser_type",
      target: {
        ...baseScope.target,
        url: "https://example.test/another/path?step=2",
        revision: 99,
        documentId: "document-2",
      },
    }),
    true,
  );
  assert.equal(
    matchesAgentConversationOriginApproval(grant, "conversation-1", {
      ...baseScope,
      toolName: "browser_screenshot",
      policyClass: "sensitive_read",
    }),
    true,
  );
});

test("conversation-origin approval does not cross chats, origins, sessions, sidepanel instances, or providers", () => {
  const grant = createAgentConversationOriginApprovalGrant(
    "conversation-1",
    baseScope,
  );
  assert.ok(grant);

  assert.equal(
    matchesAgentConversationOriginApproval(grant, "conversation-2", baseScope),
    false,
  );
  assert.equal(
    matchesAgentConversationOriginApproval(grant, "conversation-1", {
      ...baseScope,
      target: { ...baseScope.target, url: "https://other.test/form" },
    }),
    false,
  );
  assert.equal(
    matchesAgentConversationOriginApproval(grant, "conversation-1", {
      ...baseScope,
      sessionId: "profile-session-2",
    }),
    false,
  );
  assert.equal(
    matchesAgentConversationOriginApproval(grant, "conversation-1", {
      ...baseScope,
      requester: { ...baseScope.requester, connectionId: "ui-connection-2" },
    }),
    true,
  );
  assert.equal(
    matchesAgentConversationOriginApproval(grant, "conversation-1", {
      ...baseScope,
      requester: { ...baseScope.requester, connectionId: "other-panel" },
      requesterOwnedByCurrentPanel: false,
    }),
    false,
  );
  assert.equal(
    matchesAgentConversationOriginApproval(grant, "conversation-1", {
      ...baseScope,
      egressDestinations: ["AI Provider: https://other-provider.example"],
    }),
    false,
  );
});

test("destructive, arbitrary, open-world, and unbound requests cannot be remembered", () => {
  assert.equal(
    createAgentConversationOriginApprovalGrant("conversation-1", {
      ...baseScope,
      policyClass: "destructive_write",
    }),
    null,
  );
  assert.equal(
    createAgentConversationOriginApprovalGrant("conversation-1", {
      ...baseScope,
      policyClass: "arbitrary_execution",
    }),
    null,
  );
  assert.equal(
    createAgentConversationOriginApprovalGrant("conversation-1", {
      ...baseScope,
      policyClass: "open_world",
    }),
    null,
  );
  assert.equal(
    createAgentConversationOriginApprovalGrant("conversation-1", {
      ...baseScope,
      policyClass: "unknown",
    }),
    null,
  );
  assert.equal(
    createAgentConversationOriginApprovalGrant("conversation-1", {
      ...baseScope,
      target: undefined,
    }),
    null,
  );
  assert.ok(
    createAgentConversationOriginApprovalGrant("conversation-1", {
      ...baseScope,
      requester: { ...baseScope.requester, role: "mcp" },
      requesterOwnedByCurrentPanel: false,
    }),
  );
});

test("approval target origin accepts only normalized HTTP and HTTPS origins", () => {
  assert.equal(
    getApprovalTargetOrigin("https://example.test:8443/path?q=1#hash"),
    "https://example.test:8443",
  );
  assert.equal(getApprovalTargetOrigin("chrome://extensions"), null);
  assert.equal(getApprovalTargetOrigin("not a url"), null);
});

test("active conversation-origin approval reports every automatic invalidation boundary", () => {
  const grant = createAgentConversationOriginApprovalGrant(
    "conversation-1",
    baseScope,
  );
  assert.ok(grant);
  const current = {
    conversationId: "conversation-1",
    pageUrl: "https://example.test/next",
    sessionId: "profile-session-1",
    hubConnected: true,
    egressDestinations: [...baseScope.egressDestinations],
  };

  assert.equal(
    getAgentConversationOriginInvalidationReason(grant, current),
    null,
  );
  assert.equal(
    getAgentConversationOriginInvalidationReason(grant, {
      ...current,
      conversationId: "conversation-2",
    }),
    "conversation_changed",
  );
  assert.equal(
    getAgentConversationOriginInvalidationReason(grant, {
      ...current,
      pageUrl: "https://other.test/",
    }),
    "origin_changed",
  );
  assert.equal(
    getAgentConversationOriginInvalidationReason(grant, {
      ...current,
      sessionId: "profile-session-2",
    }),
    "profile_changed",
  );
  assert.equal(
    getAgentConversationOriginInvalidationReason(grant, {
      ...current,
      egressDestinations: ["AI Provider: https://other-provider.example"],
    }),
    "provider_changed",
  );
  assert.equal(
    getAgentConversationOriginInvalidationReason(grant, {
      ...current,
      hubConnected: false,
    }),
    null,
  );
});

test("full approval invalidates on target tab but not origin or transient Hub disconnect", () => {
  const approval = createConversationExecutionApproval("full", {
    conversationId: "conversation-1",
    pageUrl: "https://app.example.test/",
    tabId: 10,
    targetId: "target-10",
    sessionId: "profile-session-1",
    egressDestinations: [...baseScope.egressDestinations],
  });
  assert.ok(approval);
  const current = {
    conversationId: "conversation-1",
    pageUrl: "https://login.example.test/oauth",
    tabId: 10,
    targetId: "target-10",
    sessionId: "profile-session-1",
    hubConnected: false,
    egressDestinations: [...baseScope.egressDestinations],
  };
  assert.equal(
    getAgentConversationOriginInvalidationReason(approval, current),
    null,
  );
  assert.equal(
    getAgentConversationOriginInvalidationReason(approval, {
      ...current,
      tabId: 11,
      targetId: "target-11",
    }),
    "target_changed",
  );
});

test("Agent tool idempotency is stable only inside the same run and tool call", async () => {
  const first = await createAgentToolIdempotencyKey(
    "run-1",
    "functions.browser_click:0",
  );

  assert.equal(
    first,
    await createAgentToolIdempotencyKey(
      "run-1",
      "functions.browser_click:0",
    ),
  );
  assert.notEqual(
    first,
    await createAgentToolIdempotencyKey(
      "run-2",
      "functions.browser_click:0",
    ),
  );
  assert.notEqual(
    first,
    await createAgentToolIdempotencyKey(
      "run-1",
      "functions.browser_click:1",
    ),
  );
  assert.match(first, /^agent:v1:[a-f0-9]{64}$/);
  assert.ok(first.length <= 200);
});

test("Agent tool idempotency remains bounded for provider-controlled call IDs", async () => {
  const key = await createAgentToolIdempotencyKey(
    "run-1",
    `provider-call-${"x".repeat(10_000)}`,
  );

  assert.match(key, /^agent:v1:[a-f0-9]{64}$/);
  assert.ok(key.length <= 200);
});

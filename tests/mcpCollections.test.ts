import assert from "node:assert/strict";
import test from "node:test";
import {
  readAuditEventPage,
  readPluginConversationPage,
} from "../src/mcp/toolRuntime";
import { browserStateHub } from "../src/mcp/browserStateHub";
import type { RedactedAuditEvent } from "../src/daemon/store/stateStore";

test("plugin conversation pagination is session-bound and snapshot-stable", () => {
  const sessionId = `conversation-page-${Date.now()}`;
  browserStateHub.startPluginConversation("conversation-a", sessionId);
  for (let index = 1; index <= 3; index += 1) {
    browserStateHub.addPluginMessage(
      {
        id: `message-${index}`,
        conversationId: "conversation-a",
        role: index % 2 === 0 ? "assistant" : "user",
        content: `message ${index}`,
        createdAt: `2026-07-13T00:00:0${index}.000Z`,
      },
      sessionId,
    );
  }

  const first = readPluginConversationPage({ limit: 1 }, sessionId);
  const firstPagination = first.pagination as {
    nextCursor?: string;
    totalCount: number;
  };
  assert.deepEqual(
    (first.messages as Array<{ id: string }>).map((message) => message.id),
    ["message-1"],
  );
  assert.equal(firstPagination.totalCount, 3);

  browserStateHub.addPluginMessage(
    {
      id: "message-4",
      conversationId: "conversation-a",
      role: "assistant",
      content: "appended after page one",
      createdAt: "2026-07-13T00:00:04.000Z",
    },
    sessionId,
  );
  const second = readPluginConversationPage(
    { cursor: firstPagination.nextCursor, limit: 2 },
    sessionId,
  );
  assert.deepEqual(
    (second.messages as Array<{ id: string }>).map((message) => message.id),
    ["message-2", "message-3"],
  );
  assert.equal(
    (second.pagination as { totalCount: number }).totalCount,
    3,
  );

  browserStateHub.startPluginConversation("conversation-b", sessionId);
  assert.throws(
    () =>
      readPluginConversationPage(
        { cursor: firstPagination.nextCursor },
        sessionId,
      ),
    /STALE_PAGINATION_CURSOR/,
  );
});

test("audit pagination filters before paging and never crosses sessions", async () => {
  const events: RedactedAuditEvent[] = [
    auditEvent("event-a1", "profile-a", "browser_click", "tool.completed"),
    auditEvent("event-b1", "profile-b", "browser_click", "tool.completed"),
    auditEvent("event-a2", "profile-a", "browser_snapshot", "tool.completed"),
  ];
  const listAuditEvents = async () => structuredClone(events);

  const first = await readAuditEventPage(
    { limit: 1, outcome: "completed" },
    "profile-a",
    listAuditEvents,
  );
  assert.deepEqual(
    (first.events as RedactedAuditEvent[]).map((event) => event.id),
    ["event-a1"],
  );
  assert.equal((first.pagination as { totalCount: number }).totalCount, 2);

  events.push(
    auditEvent("event-a3", "profile-a", "browser_type", "tool.completed"),
  );
  const second = await readAuditEventPage(
    {
      cursor: (first.pagination as { nextCursor?: string }).nextCursor,
      limit: 1,
      outcome: "completed",
    },
    "profile-a",
    listAuditEvents,
  );
  assert.deepEqual(
    (second.events as RedactedAuditEvent[]).map((event) => event.id),
    ["event-a2"],
  );
  assert.equal((second.pagination as { totalCount: number }).totalCount, 2);

  await assert.rejects(
    () =>
      readAuditEventPage(
        {
          cursor: (first.pagination as { nextCursor?: string }).nextCursor,
          outcome: "failed",
        },
        "profile-a",
        listAuditEvents,
      ),
    /STALE_PAGINATION_CURSOR/,
  );
});

test("audit pagination fails closed without a selected session or daemon store", async () => {
  await assert.rejects(
    () => readAuditEventPage({}, undefined, async () => []),
    /AUDIT_SESSION_UNBOUND/,
  );
  await assert.rejects(
    () => readAuditEventPage({}, "profile-a", undefined),
    /AUDIT_STORE_UNAVAILABLE/,
  );
});

function auditEvent(
  id: string,
  sessionId: string,
  toolName: string,
  eventType: RedactedAuditEvent["eventType"],
): RedactedAuditEvent {
  return {
    id,
    eventType,
    timestamp: "2026-07-13T00:00:00.000Z",
    requestId: `request-${id}`,
    sessionId,
    toolName,
    policyClass: "sensitive_read",
    argumentsSha256: "a".repeat(64),
    revision: 1,
    outcome: eventType === "tool.failed" ? "failed" : "completed",
  };
}

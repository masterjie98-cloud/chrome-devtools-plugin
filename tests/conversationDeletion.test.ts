import assert from "node:assert/strict";
import test from "node:test";
import { planConversationDeletion } from "../src/sidepanel/services/conversationDeletion";

test("the visible conversation still requires switching before deletion", () => {
  assert.deepEqual(
    planConversationDeletion({
      conversationId: "chat-current",
      activeConversationId: "chat-current",
      activeAgentConversationId: "chat-current",
      queuedConversationIds: [],
    }),
    {
      allowed: false,
      stopActiveRun: false,
      removeQueuedSubmissions: false,
      reason: "active_conversation",
    },
  );
});

test("a background running conversation can be stopped and deleted explicitly", () => {
  assert.deepEqual(
    planConversationDeletion({
      conversationId: "chat-old",
      activeConversationId: "chat-clean",
      activeAgentConversationId: "chat-old",
      queuedConversationIds: ["chat-old", "chat-clean"],
    }),
    {
      allowed: true,
      stopActiveRun: true,
      removeQueuedSubmissions: true,
    },
  );
});

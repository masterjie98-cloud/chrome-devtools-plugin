import assert from "node:assert/strict";
import test from "node:test";
import {
  getTaskExecutionBindingMismatch,
  resolveTaskBindingConversationId,
} from "../src/shared/taskExecutionBinding";

const taskContext = {
  taskId: "task_tab_10",
  conversationId: "conversation-1",
  target: {
    tabId: 10,
    targetId: "10",
  },
  egressDestinations: [],
};

const target = {
  url: "https://login.example.test/oauth",
  title: "Login",
  tabId: 10,
  targetId: "10",
};

test("task binding survives same-Tab cross-origin navigation", () => {
  assert.equal(
    getTaskExecutionBindingMismatch(taskContext, "conversation-1", target),
    null,
  );
});

test("task binding rejects cross-conversation and cross-Tab routing", () => {
  assert.equal(
    getTaskExecutionBindingMismatch(taskContext, "conversation-2", target),
    "conversationId",
  );
  assert.equal(
    getTaskExecutionBindingMismatch(taskContext, "conversation-1", {
      ...target,
      tabId: 11,
      targetId: "11",
    }),
    "tabId",
  );
  assert.equal(
    getTaskExecutionBindingMismatch(taskContext, "conversation-1", {
      ...target,
      targetId: "other-target",
    }),
    "targetId",
  );
});

test("UI task binding uses the conversation owned by its sidepanel connection", () => {
  assert.equal(
    resolveTaskBindingConversationId(
      "ui",
      "conversation-panel-b",
      "conversation-session-a",
    ),
    "conversation-panel-b",
  );
  assert.equal(
    resolveTaskBindingConversationId(
      "mcp",
      "conversation-panel-b",
      "conversation-session-a",
    ),
    "conversation-session-a",
  );
});

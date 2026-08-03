import assert from "node:assert/strict";
import test from "node:test";
import {
  mcpStatusMatchesTaskBinding,
  synchronizeMcpTaskBinding,
} from "../src/sidepanel/services/taskBindingSync";
import type { ExecutionTaskBinding } from "../src/sidepanel/types";

const binding: ExecutionTaskBinding = {
  taskId: "task-1",
  conversationId: "conversation-1",
  target: {
    tabId: 42,
    targetId: "42",
  },
};

test("task binding synchronization waits for target convergence", async () => {
  const statuses = [
    {
      currentConversationId: "conversation-old",
      activeTab: { tabId: 42, targetId: "different" },
    },
    {
      currentConversationId: "conversation-1",
      activeTab: { tabId: 42, targetId: "42" },
    },
  ];
  const started: string[] = [];
  const callOptions: Array<{
    skipTaskContext?: boolean;
    taskContext?: {
      taskId: string;
      conversationId?: string;
      target?: { tabId: number; targetId?: string };
      egressDestinations: string[];
    };
  }> = [];

  await synchronizeMcpTaskBinding(
    {
      startPluginConversation: (conversationId) => {
        started.push(conversationId);
      },
      callMcpTool: async (_toolName, _args, options) => {
        callOptions.push(options ?? {});
        return statuses.shift();
      },
    },
    binding,
    {
      attempts: 2,
      delay: async () => undefined,
    },
  );

  assert.deepEqual(started, ["conversation-1"]);
  assert.deepEqual(
    callOptions.map((options) => options.taskContext),
    [
    {
      taskId: "task-1",
      conversationId: "conversation-1",
      target: { tabId: 42, targetId: "42" },
      egressDestinations: [],
    },
    {
      taskId: "task-1",
      conversationId: "conversation-1",
      target: { tabId: 42, targetId: "42" },
      egressDestinations: [],
    },
    ],
  );
  assert.deepEqual(
    callOptions.map((options) => options.skipTaskContext),
    [undefined, undefined],
  );
});

test("task binding status requires tab and target identity", () => {
  assert.equal(
    mcpStatusMatchesTaskBinding(
      {
        currentConversationId: "conversation-1",
        activeTab: { tabId: 42, targetId: "different" },
      },
      binding,
    ),
    false,
  );
  assert.equal(
    mcpStatusMatchesTaskBinding(
      {
        currentConversationId: "conversation-from-another-sidepanel",
        activeTab: { tabId: 42, targetId: "42" },
      },
      binding,
    ),
    true,
  );
});

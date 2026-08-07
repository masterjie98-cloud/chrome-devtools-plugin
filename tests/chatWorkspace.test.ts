import assert from "node:assert/strict";
import test from "node:test";
import {
  clearUnavailableConversationTarget,
  DEFAULT_CHAT_GREETING,
  MAX_STORED_CONVERSATIONS,
  conversationSearchText,
  createStoredConversation,
  exportStoredConversation,
  isEmptyStoredConversation,
  normalizeChatWorkspace,
  upsertPersistableConversation,
  upsertStoredConversation,
} from "../src/sidepanel/services/chatWorkspace";
import type { ChatMessage } from "../src/sidepanel/types";

test("stored conversations retain original bounded tool audit details but omit attachments and runtime status", () => {
  const messages: ChatMessage[] = [
    {
      id: "user-1",
      role: "user",
      content: "Inspect this page",
      createdAt: "2026-07-14T00:00:00.000Z",
      status: "sending",
      attachments: [
        {
          id: "image-1",
          name: "secret.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,SECRET_BYTES",
          createdAt: "2026-07-14T00:00:00.000Z",
          source: "upload",
        },
      ],
    },
    {
      id: "tool-1",
      role: "tool",
      toolName: "browser_query_dom",
      toolSource: "external_mcp",
      toolDisplayName: "prometheus_query",
      toolServerName: "Prometheus Infra MCP",
      toolRequestArguments:
        '{"query":"up","apiKey":"request-secret"}',
      content: '{"authorization":"secret"}',
      toolResultMeta: {
        originalCharCount: 26,
        displayedSourceCharCount: 26,
        truncated: false,
      },
      createdAt: "2026-07-14T00:00:01.000Z",
    },
    {
      id: "assistant-1",
      role: "assistant",
      content: "Done",
      model: "deepseek-v3.1",
      createdAt: "2026-07-14T00:00:02.000Z",
    },
  ];

  const stored = createStoredConversation({
    id: "conversation-1",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:02.000Z",
    messages,
    draft: "follow up",
  });

  assert.deepEqual(stored.messages, [
    {
      id: "user-1",
      role: "user",
      content: "Inspect this page",
      createdAt: "2026-07-14T00:00:00.000Z",
    },
    {
      id: "tool-1",
      role: "tool",
      toolName: "browser_query_dom",
      toolSource: "external_mcp",
      toolDisplayName: "prometheus_query",
      toolServerName: "Prometheus Infra MCP",
      toolRequestArguments: '{\n  "query": "up",\n  "apiKey": "request-secret"\n}',
      content: '{\n  "authorization": "secret"\n}',
      toolResultMeta: {
        originalCharCount: 26,
        displayedSourceCharCount: 26,
        truncated: false,
      },
      createdAt: "2026-07-14T00:00:01.000Z",
    },
    {
      id: "assistant-1",
      role: "assistant",
      content: "Done",
      model: "deepseek-v3.1",
      createdAt: "2026-07-14T00:00:02.000Z",
    },
  ]);
  assert.equal(JSON.stringify(stored).includes("SECRET_BYTES"), false);
  assert.equal(JSON.stringify(stored).includes("request-secret"), true);
  assert.equal(JSON.stringify(stored).includes('\\"secret\\"'), true);
  assert.equal(JSON.stringify(stored).includes("prometheus_query"), true);
});

test("conversation target persists a fixed Tab without URL credentials or query data", () => {
  const stored = createStoredConversation({
    id: "conversation-target",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:01.000Z",
    messages: [],
    draft: "",
    target: {
      tabId: 17,
      windowId: 4,
      targetId: "17",
      title: "Checkout",
      url: "https://user:secret@example.test/checkout?token=secret#step",
    },
  });

  assert.deepEqual(stored.target, {
    tabId: 17,
    windowId: 4,
    targetId: "17",
    title: "Checkout",
    url: "https://example.test/checkout",
  });
  assert.deepEqual(
    normalizeChatWorkspace({
      version: 1,
      conversations: [{ ...stored, target: { tabId: -1 } }],
    }).conversations[0]?.target,
    undefined,
  );
});

test("an unavailable restored Tab clears the target and its activity cursor without touching a newer binding", () => {
  const stored = createStoredConversation({
    id: "conversation-stale-target",
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:01.000Z",
    messages: [
      {
        id: "user-stale-target",
        role: "user",
        content: "Continue the investigation",
        createdAt: "2026-08-05T00:00:00.000Z",
      },
    ],
    draft: "",
    target: {
      tabId: 17,
      title: "Closed page",
      url: "https://example.test/closed",
    },
    activityCursor: { streamId: "activity-stale", sequence: 9 },
  });

  const cleared = clearUnavailableConversationTarget(stored, 17);
  assert.equal(cleared.target, undefined);
  assert.equal(cleared.activityCursor, undefined);
  assert.equal(cleared.messages[0]?.content, "Continue the investigation");
  assert.equal(clearUnavailableConversationTarget(stored, 18), stored);
});

test("local chat persistence keeps model-visible content unchanged", () => {
  const content =
    "排查日期 2026-08-07，原始邮箱 owner@example.test，电话 13800138000，token=diagnostic-value";
  const stored = createStoredConversation({
    id: "conversation-local-original-content",
    createdAt: "2026-08-07T13:15:00.000Z",
    updatedAt: "2026-08-07T13:16:00.000Z",
    messages: [
      {
        id: "assistant-local-original-content",
        role: "assistant",
        source: "extension_ai",
        content,
        createdAt: "2026-08-07T13:15:00.000Z",
      },
      {
        id: "tool-local-original-content",
        role: "tool",
        content: JSON.stringify({ content }),
        toolRequestArguments: JSON.stringify({ query: content }),
        createdAt: "2026-08-07T13:15:30.000Z",
      },
    ],
    draft: content,
  });

  assert.equal(stored.messages[0]?.content, content);
  assert.equal(stored.draft, content);
  assert.match(stored.messages[1]?.content ?? "", /owner@example\.test/);
  assert.match(stored.messages[1]?.toolRequestArguments ?? "", /13800138000/);
});

test("conversation activity cursor persists a stream identity and sequence", () => {
  const stored = createStoredConversation({
    id: "conversation-activity",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:01.000Z",
    messages: [],
    draft: "",
    activityCursor: { streamId: "activity-a", sequence: 57 },
  });

  assert.deepEqual(stored.activityCursor, {
    streamId: "activity-a",
    sequence: 57,
  });
  assert.equal(
    normalizeChatWorkspace({
      version: 1,
      conversations: [
        {
          ...stored,
          activityCursor: { streamId: "activity-a", sequence: -1 },
        },
      ],
    }).conversations[0]?.activityCursor,
    undefined,
  );
  assert.equal(
    normalizeChatWorkspace({
      version: 1,
      conversations: [{ ...stored, activityCursor: 57 }],
    }).conversations[0]?.activityCursor,
    undefined,
  );
});

test("conversation MCP mode persists without making a greeting-only chat durable", () => {
  const stored = createStoredConversation({
    id: "conversation-mcp-mode",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:01.000Z",
    messages: [
      {
        id: "assistant-ready-mcp",
        role: "assistant",
        source: "extension_ai",
        content: DEFAULT_CHAT_GREETING,
        createdAt: "2026-07-14T00:00:00.000Z",
      },
    ],
    draft: "",
    externalMcpSelection: {
      mode: "selected",
      serverIds: ["mcp_filesystem"],
    },
  });

  assert.deepEqual(stored.externalMcpSelection, {
    mode: "selected",
    serverIds: ["mcp_filesystem"],
  });
  assert.equal(isEmptyStoredConversation(stored), true);
});

test("workspace normalization deduplicates, sorts, and bounds conversations", () => {
  const conversations = Array.from(
    { length: MAX_STORED_CONVERSATIONS + 3 },
    (_, index) =>
      createStoredConversation({
        id: `conversation-${index}`,
        createdAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        updatedAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        messages: [
          {
            id: `user-${index}`,
            role: "user",
            content: `检查对话 ${index}`,
            createdAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
          },
        ],
        draft: "",
      }),
  );

  const normalized = normalizeChatWorkspace({
    version: 1,
    activeConversationId: "conversation-22",
    conversations: [conversations[0], ...conversations],
  });

  assert.equal(normalized.conversations.length, MAX_STORED_CONVERSATIONS);
  assert.equal(normalized.conversations[0]?.id, "conversation-22");
  assert.equal(normalized.activeConversationId, "conversation-22");
});

test("upsert derives a compact title from the first user message", () => {
  const conversation = createStoredConversation({
    id: "conversation-title",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:01.000Z",
    messages: [
      {
        id: "user-title",
        role: "user",
        content: "  Explain   the current page controls in detail  ",
        createdAt: "2026-07-14T00:00:00.000Z",
      },
    ],
    draft: "",
  });

  const next = upsertStoredConversation([], conversation);

  assert.equal(next[0]?.title, "Explain the current page controls in detail");
});

test("a greeting-only conversation remains ephemeral until it has real state", () => {
  const empty = createStoredConversation({
    id: "conversation-empty",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:01.000Z",
    messages: [
      {
        id: "assistant-ready",
        role: "assistant",
        source: "extension_ai",
        content: DEFAULT_CHAT_GREETING,
        createdAt: "2026-07-14T00:00:00.000Z",
      },
    ],
    draft: "",
  });

  assert.equal(isEmptyStoredConversation(empty), true);
  assert.deepEqual(upsertPersistableConversation([empty], empty), []);
  assert.deepEqual(
    normalizeChatWorkspace({
      version: 1,
      activeConversationId: empty.id,
      conversations: [empty],
    }),
    { version: 2, conversations: [] },
  );

  const withDraft = createStoredConversation({
    ...empty,
    draft: "准备检查当前页面",
    messages: empty.messages as ChatMessage[],
  });
  const withAutomaticTarget = createStoredConversation({
    ...empty,
    messages: empty.messages as ChatMessage[],
    target: { tabId: 17, url: "https://example.test/reports" },
  });
  const nextWithAutomaticTarget = createStoredConversation({
    ...withAutomaticTarget,
    id: "conversation-empty-next",
    messages: [
      {
        ...empty.messages[0],
        id: "assistant-ready-next",
      },
    ] as ChatMessage[],
  });
  const withUserMessage = createStoredConversation({
    ...empty,
    messages: [
      ...empty.messages,
      {
        id: "user-real",
        role: "user",
        content: "检查当前页面",
        createdAt: "2026-07-14T00:00:02.000Z",
      },
    ] as ChatMessage[],
  });

  assert.equal(isEmptyStoredConversation(withDraft), false);
  assert.equal(isEmptyStoredConversation(withAutomaticTarget), true);
  assert.deepEqual(
    upsertPersistableConversation(
      upsertPersistableConversation(
        upsertStoredConversation([], withAutomaticTarget),
        withAutomaticTarget,
      ),
      nextWithAutomaticTarget,
    ),
    [],
  );
  assert.deepEqual(
    normalizeChatWorkspace({
      version: 2,
      activeConversationId: withAutomaticTarget.id,
      conversations: [withAutomaticTarget],
    }),
    { version: 2, conversations: [] },
  );
  assert.equal(isEmptyStoredConversation(withUserMessage), false);
});

test("tool-heavy runs preserve primary history and the latest bounded audit trail", () => {
  const userMessage: ChatMessage = {
    id: "user-before-tools",
    role: "user",
    content: "Keep this request",
    createdAt: "2026-07-14T00:00:00.000Z",
  };
  const toolMessages: ChatMessage[] = Array.from({ length: 100 }, (_, index) => ({
    id: `tool-${index}`,
    role: "tool",
    toolName: "browser_query_dom",
    content: `tool result ${index}`,
    createdAt: "2026-07-14T00:00:01.000Z",
  }));

  const stored = createStoredConversation({
    id: "tool-heavy",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:02.000Z",
    messages: [userMessage, ...toolMessages],
    draft: "",
  });

  assert.equal(stored.messages[0]?.id, "user-before-tools");
  assert.equal(stored.messages.length, 49);
  assert.equal(stored.messages[1]?.id, "tool-52");
  assert.equal(stored.messages.at(-1)?.id, "tool-99");
});

test("conversation character budget retains the latest messages", () => {
  const messages: ChatMessage[] = Array.from({ length: 21 }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `${String(index).padStart(2, "0")}${"x".repeat(11_998)}`,
    createdAt: `2026-07-14T00:00:${String(index).padStart(2, "0")}.000Z`,
  }));

  const stored = createStoredConversation({
    id: "character-budget",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:20.000Z",
    messages,
    draft: "",
  });

  assert.equal(stored.messages.length, 20);
  assert.equal(stored.messages[0]?.id, "message-1");
  assert.equal(stored.messages.at(-1)?.id, "message-20");
  assert.equal(
    stored.messages.reduce((total, message) => total + message.content.length, 0),
    240_000,
  );
});

test("MCP collaboration conversations persist as independent contexts", () => {
  const conversation = createStoredConversation({
    id: "mcp-conversation",
    kind: "mcp_collaboration",
    delegatedTaskId: "task_mcpconversation1",
    title: "检查发布页并返回证据",
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:01.000Z",
    messages: [],
    draft: "",
  });

  assert.equal(conversation.kind, "mcp_collaboration");
  assert.equal(conversation.delegatedTaskId, "task_mcpconversation1");
  assert.equal(conversation.title, "检查发布页并返回证据");
  assert.equal(isEmptyStoredConversation(conversation), false);

  const [restored] = normalizeChatWorkspace({
    version: 2,
    activeConversationId: conversation.id,
    conversations: [conversation],
  }).conversations;
  assert.equal(restored?.kind, "mcp_collaboration");
  assert.equal(restored?.delegatedTaskId, "task_mcpconversation1");
  assert.equal(restored?.title, "检查发布页并返回证据");
});

test("conversation history supports full-text search and explicit Markdown/JSON export", () => {
  const conversation = createStoredConversation({
    id: "search-export",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:01:00.000Z",
    messages: [
      {
        id: "user-search",
        role: "user",
        content: "Find the checkout regression",
        createdAt: "2026-07-14T00:00:00.000Z",
      },
      {
        id: "assistant-search",
        role: "assistant",
        content: "The submit button is disabled by validation.",
        createdAt: "2026-07-14T00:01:00.000Z",
        source: "extension_ai",
      },
    ],
    draft: "Follow up with Network evidence",
  });

  assert.match(conversationSearchText(conversation), /validation/);
  assert.match(conversationSearchText(conversation), /network evidence/);
  assert.match(
    exportStoredConversation(conversation, "markdown"),
    /## 插件 AI/,
  );
  assert.equal(
    JSON.parse(exportStoredConversation(conversation, "json")).version,
    "ai-devtools-conversation-export-v1",
  );
});

test("MCP backend AI keeps its identity in persisted messages and export", () => {
  const conversation = createStoredConversation({
    id: "mcp-export",
    kind: "mcp_collaboration",
    delegatedTaskId: "task_mcpexport1234",
    title: "MCP 检查",
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:01.000Z",
    messages: [
      {
        id: "mcp-request",
        role: "assistant",
        source: "mcp_ai",
        delegatedTaskId: "task_mcpexport1234",
        content: "检查当前页面并返回结果。",
        createdAt: "2026-08-07T00:00:00.000Z",
      },
    ],
    draft: "",
  });

  assert.equal(conversation.messages[0]?.delegatedTaskId, "task_mcpexport1234");
  assert.match(exportStoredConversation(conversation, "markdown"), /## MCP 后端 AI/);
});

test("workspace v1 migrates without trusting fields that did not exist in v1", () => {
  const migrated = normalizeChatWorkspace({
    version: 1,
    activeConversationId: "chat-memory",
    conversations: [
      {
        id: "chat-memory",
        createdAt: "2026-08-06T10:00:00.000Z",
        updatedAt: "2026-08-06T10:01:00.000Z",
        messages: [
          {
            id: "user-memory",
            role: "user",
            content: "排查 fluent-bit",
            createdAt: "2026-08-06T10:00:00.000Z",
          },
        ],
        draft: "",
        memory: {
          version: "conversation-memory-v1",
          revision: 1,
          activeTask: {
            id: "task-memory",
            objective: "排查 fluent-bit",
            status: "active",
            affinity: "external_mcp",
            successCriteria: [],
            entities: ["fluent-bit"],
            nextActions: [],
            blockers: [],
            provenance: {
              messageIds: ["user-memory"],
              toolCallIds: [],
            },
            updatedAt: "2026-08-06T10:01:00.000Z",
          },
          pendingDecisions: [],
          constraints: [],
          facts: [],
          turnSummaries: [],
          updatedAt: "2026-08-06T10:01:00.000Z",
        },
      },
    ],
  });

  assert.equal(migrated.version, 2);
  assert.equal(migrated.conversations[0]?.memory, undefined);
});

test("workspace v2 retains sourced memory and its cited old tool evidence", () => {
  const toolMessage: ChatMessage = {
    id: "tool-memory-evidence",
    role: "tool",
    toolCallId: "call-memory-evidence",
    toolName: "prometheus_query",
    toolSource: "external_mcp",
    content: '{"exitCode":"SIGBUS"}',
    createdAt: "2026-08-06T10:00:01.000Z",
  };
  const primaryMessages: ChatMessage[] = Array.from(
    { length: 90 },
    (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `conversation message ${index}`,
      createdAt: `2026-08-06T10:${String(index).padStart(2, "0")}:00.000Z`,
    }),
  );
  const memory = {
    version: "conversation-memory-v1" as const,
    revision: 2,
    pendingDecisions: [],
    constraints: [],
    facts: [
      {
        id: "fact-sigbus",
        key: "pod.exit_reason",
        statement: "Pod 退出原因是 SIGBUS",
        kind: "verified" as const,
        lifecycle: "active" as const,
        importance: 90,
        tags: ["pod"],
        provenance: { messageIds: [], toolCallIds: ["call-memory-evidence"] },
        updatedAt: "2026-08-06T10:01:00.000Z",
      },
    ],
    turnSummaries: [],
    updatedAt: "2026-08-06T10:01:00.000Z",
  };

  const normalized = normalizeChatWorkspace({
    version: 2,
    activeConversationId: "chat-memory-v2",
    conversations: [
      {
        id: "chat-memory-v2",
        createdAt: "2026-08-06T10:00:00.000Z",
        updatedAt: "2026-08-06T11:00:00.000Z",
        messages: [toolMessage, ...primaryMessages],
        draft: "",
        memory,
      },
    ],
  });

  assert.equal(normalized.conversations[0]?.messages.length, 80);
  assert.ok(
    normalized.conversations[0]?.messages.some(
      (message) => message.toolCallId === "call-memory-evidence",
    ),
  );
  assert.equal(normalized.conversations[0]?.memory?.facts[0]?.id, "fact-sigbus");
});

test("workspace drops durable facts whose cited evidence is unavailable", () => {
  const normalized = normalizeChatWorkspace({
    version: 2,
    conversations: [
      {
        id: "chat-stale-memory",
        createdAt: "2026-08-06T10:00:00.000Z",
        updatedAt: "2026-08-06T10:01:00.000Z",
        messages: [
          {
            id: "user-stale-memory",
            role: "user",
            content: "继续排查",
            createdAt: "2026-08-06T10:00:00.000Z",
          },
        ],
        draft: "",
        memory: {
          version: "conversation-memory-v1",
          revision: 1,
          pendingDecisions: [],
          constraints: [],
          facts: [
            {
              id: "fact-missing-source",
              key: "pod.node",
              statement: "Pod 位于 rs-compute1",
              kind: "verified",
              lifecycle: "active",
              importance: 80,
              tags: ["pod"],
              provenance: { messageIds: [], toolCallIds: ["missing-call"] },
              updatedAt: "2026-08-06T10:01:00.000Z",
            },
          ],
          turnSummaries: [],
          updatedAt: "2026-08-06T10:01:00.000Z",
        },
      },
    ],
  });

  assert.deepEqual(normalized.conversations[0]?.memory?.facts, []);
});

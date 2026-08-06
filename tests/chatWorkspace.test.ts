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

test("stored conversations retain bounded tool audit details but omit secrets, attachments, and runtime status", () => {
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
      toolRequestArguments: '{\n  "query": "up",\n  "apiKey": "[redacted]"\n}',
      content: '{\n  "authorization": "[redacted]"\n}',
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
  assert.equal(JSON.stringify(stored).includes("request-secret"), false);
  assert.equal(JSON.stringify(stored).includes('"secret"'), false);
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
    { version: 1, conversations: [] },
  );

  const withDraft = createStoredConversation({
    ...empty,
    draft: "准备检查当前页面",
    messages: empty.messages as ChatMessage[],
  });
  const withTarget = createStoredConversation({
    ...empty,
    messages: empty.messages as ChatMessage[],
    target: { tabId: 17, url: "https://example.test/reports" },
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
  assert.equal(isEmptyStoredConversation(withTarget), false);
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

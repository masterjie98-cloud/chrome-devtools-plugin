import assert from "node:assert/strict";
import test from "node:test";
import { createAgentSessionSnapshot } from "../src/shared/agentSession";
import { DEFAULT_AI_CONFIG } from "../src/sidepanel/services/aiConfig";
import {
  buildDeterministicConversationMemoryPatch,
  extractConversationMemoryPatch,
} from "../src/daemon/conversationMemoryExtractor";

test("memory extractor returns a sourced semantic patch without tools", async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input, init) => {
    requestBodies.push(
      JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    );
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                activeTask: {
                  id: "task-fluent-bit",
                  objective: "排查 fluent-bit SIGBUS",
                  status: "waiting",
                  affinity: "external_mcp",
                  successCriteria: ["确认根因"],
                  entities: ["fluent-bit-jmz5k"],
                  nextActions: ["查询节点磁盘指标"],
                  blockers: [],
                  provenance: {
                    messageIds: ["user-1", "assistant-1"],
                    toolCallIds: ["tool-1"],
                  },
                  updatedAt: "2026-08-06T10:00:00.000Z",
                },
                pendingDecisions: [
                  {
                    id: "decision-next",
                    question: "继续哪个检查？",
                    options: [
                      {
                        id: "node",
                        label: "查询节点指标",
                        recommended: true,
                      },
                    ],
                    status: "pending",
                    provenance: {
                      messageIds: ["assistant-1"],
                      toolCallIds: [],
                    },
                    updatedAt: "2026-08-06T10:00:00.000Z",
                  },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const session = createAgentSessionSnapshot(
      "run-1",
      "排查 fluent-bit SIGBUS",
      "2026-08-06T10:00:00.000Z",
    );
    const patch = await extractConversationMemoryPatch({
      config: { ...DEFAULT_AI_CONFIG, enableTools: false },
      runId: "run-1",
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
      input: "请排查异常",
      finalContent: "还需要选择下一项检查。",
      session,
      toolMessages: [
        {
          id: "message-tool-1",
          assistantMessageId: "assistant-1",
          toolCallId: "tool-1",
          toolName: "prometheus_query",
          toolSource: "external_mcp",
          content: "{}",
          createdAt: "2026-08-06T10:00:00.000Z",
        },
      ],
    });

    assert.equal(patch.activeTask?.status, "waiting");
    assert.equal(patch.pendingDecisions?.[0]?.id, "decision-next");
    assert.equal(Object.hasOwn(requestBodies[0] ?? {}, "tools"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("memory extractor falls back to deterministic task state after provider failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("provider unavailable");
  }) as typeof fetch;
  try {
    const session = createAgentSessionSnapshot(
      "run-fallback",
      "检查当前页面",
      "2026-08-06T10:00:00.000Z",
    );
    const patch = await extractConversationMemoryPatch({
      config: { ...DEFAULT_AI_CONFIG, enableTools: false },
      runId: "run-fallback",
      userMessageId: "user-fallback",
      assistantMessageId: "assistant-fallback",
      input: "检查当前页面",
      finalContent: "页面检查完成。",
      session,
      toolMessages: [],
    });

    assert.equal(patch.activeTask?.objective, "检查当前页面");
    assert.equal(patch.turnSummary?.id, "turn:run-fallback");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deterministic memory maps terminal Agent states without marking them active", () => {
  const base = createAgentSessionSnapshot(
    "run-terminal",
    "完成诊断",
    "2026-08-06T10:00:00.000Z",
  );
  const input = {
    config: { ...DEFAULT_AI_CONFIG, enableTools: false },
    runId: "run-terminal",
    userMessageId: "user-terminal",
    assistantMessageId: "assistant-terminal",
    input: "完成诊断",
    finalContent: "诊断完成。",
    toolMessages: [],
  };

  assert.equal(
    buildDeterministicConversationMemoryPatch({
      ...input,
      session: { ...base, status: "completed" },
    }).activeTask?.status,
    "completed",
  );
  assert.equal(
    buildDeterministicConversationMemoryPatch({
      ...input,
      session: { ...base, status: "cancelled" },
    }).activeTask?.status,
    "suspended",
  );
});

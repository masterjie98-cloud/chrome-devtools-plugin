import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateOpenAiRequestTokens,
  fitMessagesToContextWindow,
  selectProviderToolsForContextBudget,
} from "../src/sidepanel/services/aiClient";

test("context budgeting estimates CJK and tool schemas before sending", () => {
  const english = estimateOpenAiRequestTokens([
    { role: "user", content: "a".repeat(400) },
  ]);
  const cjk = estimateOpenAiRequestTokens([
    { role: "user", content: "测".repeat(400) },
  ]);
  const withTools = estimateOpenAiRequestTokens(
    [{ role: "user", content: "hello" }],
    [{ type: "function", function: { name: "inspect", description: "x".repeat(800) } }],
  );

  assert.ok(cjk > english);
  assert.ok(withTools > english);
});

test("context budgeting removes old history but preserves the latest tool exchange", () => {
  const messages = [
    { role: "system" as const, content: "trusted system instruction" },
    ...Array.from({ length: 10 }, (_, index) => ({
      role: (index % 2 === 0 ? "user" : "assistant") as
        | "user"
        | "assistant",
      content: `old-${index}-` + "x".repeat(4_000),
    })),
    { role: "user" as const, content: "current task" },
    {
      role: "assistant" as const,
      content: null,
      tool_calls: [
        {
          id: "call-latest",
          type: "function",
          function: { name: "browser_observe", arguments: "{}" },
        },
      ],
    },
    {
      role: "tool" as const,
      tool_call_id: "call-latest",
      name: "browser_observe",
      content: "latest evidence " + "y".repeat(2_000),
    },
    { role: "system" as const, content: "continue with the latest result" },
  ];

  const fitted = fitMessagesToContextWindow(messages, {
    contextWindowTokens: 8_192,
    maxOutputTokens: 1_024,
  });

  assert.ok(fitted.report.omittedMessageCount > 0);
  assert.ok(
    fitted.report.estimatedInputTokens <= fitted.report.inputBudgetTokens,
  );
  assert.ok(
    fitted.messages.some(
      (message) => message.tool_call_id === "call-latest",
    ),
  );
  assert.ok(
    fitted.messages.some(
      (message) => message.content === "current task",
    ),
  );
  assert.equal(
    Object.values(fitted.report.breakdown).reduce(
      (total, tokens) => total + tokens,
      0,
    ),
    fitted.report.estimatedInputTokens,
  );
  assert.ok(fitted.report.breakdown.system > 0);
  assert.ok(fitted.report.breakdown.tool_results > 0);
});

test("context budgeting preserves the latest coherent conversation turn before page context", () => {
  const previousUser = "请继续排查 fluent-bit-jmz5k 的 SIGBUS 根因";
  const previousAssistant =
    "已经定位到容器异常，并提出继续查询节点指标或对比正常节点。你希望继续哪一项？";
  const automaticPageContext =
    "UNTRUSTED_PAGE_CONTEXT\n" + "DNS management page ".repeat(1_500);
  const fitted = fitMessagesToContextWindow(
    [
      { role: "system", content: "trusted system instruction" },
      {
        role: "user",
        contextCategory: "conversation",
        content: previousUser,
      },
      {
        role: "assistant",
        contextCategory: "conversation",
        content: previousAssistant,
      },
      {
        role: "user",
        contextCategory: "page_context",
        content: automaticPageContext,
      },
      {
        role: "user",
        contextCategory: "conversation",
        content: "CURRENT_USER_REQUEST\n你自己决定",
      },
    ],
    { contextWindowTokens: 8_192, maxOutputTokens: 2_048 },
  );

  const serialized = JSON.stringify(fitted.messages);
  assert.match(serialized, /fluent-bit-jmz5k/);
  assert.match(serialized, /你希望继续哪一项/);
  assert.doesNotMatch(serialized, /DNS management page/);
});

test("context budgeting reports protected conversation memory separately", () => {
  const fitted = fitMessagesToContextWindow(
    [
      { role: "system", content: "trusted system instruction" },
      {
        role: "system",
        contextCategory: "conversation_memory",
        content:
          'CONVERSATION_MEMORY\n{"activeTask":{"objective":"排查 fluent-bit","status":"active"},"pendingDecisions":[{"id":"next"}],"facts":[{"id":"fact"}]}',
      },
      {
        role: "user",
        contextCategory: "conversation",
        content: "CURRENT_USER_REQUEST\n继续",
      },
    ],
    { contextWindowTokens: 8_192, maxOutputTokens: 1_024 },
  );

  assert.ok(fitted.report.breakdown.conversation_memory > 0);
  assert.equal(fitted.report.memorySummary?.activeObjective, "排查 fluent-bit");
  assert.equal(fitted.report.memorySummary?.pendingDecisionCount, 1);
});

test("context budgeting fails locally when tool schemas consume the whole window", () => {
  assert.throws(
    () =>
      fitMessagesToContextWindow(
        [{ role: "user", content: "current task" }],
        { contextWindowTokens: 8_192, maxOutputTokens: 1_024 },
        [{ description: "z".repeat(30_000) }],
      ),
    /AI_CONTEXT_BUDGET_EXCEEDED/,
  );
});

test("tool schema budgeting preserves memory by selecting task-relevant tools", () => {
  const tools = [
    tool("browser_observe", "builtin", "Read the current browser DOM"),
    tool(
      "external_prometheus_query",
      "external_mcp",
      "Query Prometheus metrics for fluent-bit pods and nodes",
    ),
    tool(
      "external_prometheus_labels",
      "external_mcp",
      "List Prometheus labels and discover metrics",
    ),
    ...Array.from({ length: 12 }, (_, index) =>
      tool(
        `unrelated_${index}`,
        "external_mcp",
        `Unrelated capability ${index}`,
      ),
    ),
  ];
  const selected = selectProviderToolsForContextBudget(
    tools,
    [
      {
        role: "system",
        contextCategory: "conversation_memory",
        content:
          'CONVERSATION_MEMORY\n{"activeTask":{"objective":"排查 fluent-bit","affinity":"external_mcp"}}',
      },
      {
        role: "user",
        contextCategory: "conversation",
        content: "CURRENT_USER_REQUEST\n你自己决定",
      },
    ],
    { contextWindowTokens: 8_192, maxOutputTokens: 1_024 },
  ) as typeof tools;

  const names = selected.map((entry) => entry.function.name);
  assert.ok(names.includes("external_prometheus_query"));
  assert.ok(names.includes("external_prometheus_labels"));
  assert.equal(names.includes("browser_observe"), false);
  assert.ok(selected.length < tools.length);
});

test("current page objective keeps browser tools despite stale external MCP memory", () => {
  const tools = [
    tool("browser_observe", "builtin", "Read and inspect the current DNS page DOM"),
    tool("browser_click", "builtin", "Click a current page element"),
    ...Array.from({ length: 90 }, (_, index) =>
      tool(
        `external_metric_${index}`,
        "external_mcp",
        `Query historical fluent-bit Prometheus metric ${index}`,
      ),
    ),
  ];
  const selected = selectProviderToolsForContextBudget(
    tools,
    [
      {
        role: "system",
        contextCategory: "conversation_memory",
        content:
          'CONVERSATION_MEMORY\n{"activeTask":{"objective":"排查 fluent-bit","affinity":"external_mcp"}}',
      },
      {
        role: "user",
        contextCategory: "conversation",
        content: "CURRENT_USER_REQUEST\n改为检查当前 DNS 页面",
      },
    ],
    { contextWindowTokens: 8_192, maxOutputTokens: 1_024 },
  ) as typeof tools;

  const names = selected.map((entry) => entry.function.name);
  assert.ok(names.includes("browser_observe"));
  assert.ok(names.includes("browser_click"));
  assert.ok(selected.length < tools.length);
});

function tool(
  name: string,
  source: "builtin" | "external_mcp",
  description: string,
) {
  return {
    type: "function" as const,
    function: {
      name,
      description: `${description} ${"schema ".repeat(280)}`,
      parameters: { type: "object", properties: {} },
    },
    clientMetadata: { source },
  };
}

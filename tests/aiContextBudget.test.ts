import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateOpenAiRequestTokens,
  fitMessagesToContextWindow,
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

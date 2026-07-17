import assert from "node:assert/strict";
import test from "node:test";
import {
  createEditedBranchPlan,
  createRetryBranchPlan,
  createSafeRetryConfig,
} from "../src/sidepanel/chatBranches";
import { DEFAULT_AI_CONFIG } from "../src/sidepanel/services/aiConfig";
import type { ChatMessage } from "../src/sidepanel/types";

const messages: ChatMessage[] = [
  message("welcome", "assistant", "Ready"),
  message("user-1", "user", "Inspect the form"),
  {
    ...message("tool-1", "tool", '{"value":"secret"}'),
    toolName: "browser_query_dom",
  },
  message("assistant-1", "assistant", "The form has two fields"),
];

test("safe retry branches from the source user and excludes prior tool output", () => {
  const plan = createRetryBranchPlan(messages, "assistant-1");

  assert.ok(plan);
  assert.equal(plan.input, "Inspect the form");
  assert.deepEqual(
    plan.seedMessages.map((message) => message.id),
    ["welcome"],
  );
  assert.equal(JSON.stringify(plan).includes("secret"), false);
});

test("safe retry preserves the source attachments for an explicit resend", () => {
  const attachment = {
    id: "image-1",
    name: "fixture.png",
    dataUrl: "data:image/png;base64,ZmFrZQ==",
    mimeType: "image/png",
    createdAt: "2026-07-14T00:00:00.000Z",
    source: "upload" as const,
  };
  const source = messages.map((entry) =>
    entry.id === "user-1" ? { ...entry, attachments: [attachment] } : entry,
  );

  const plan = createRetryBranchPlan(source, "assistant-1");

  assert.ok(plan);
  assert.deepEqual(plan.attachments, [attachment]);
  assert.notEqual(plan.attachments, source[1]?.attachments);
});

test("edited messages create a new branch without mutating the source history", () => {
  const plan = createEditedBranchPlan(
    messages,
    "user-1",
    "Inspect only required fields",
    [],
  );

  assert.ok(plan);
  assert.equal(plan.input, "Inspect only required fields");
  assert.equal(messages[1]?.content, "Inspect the form");
  assert.deepEqual(plan.seedMessages.map((message) => message.id), ["welcome"]);
});

test("safe retry disables page reads, tools, and network search", () => {
  const config = createSafeRetryConfig({
    ...DEFAULT_AI_CONFIG,
    fastAgentMode: true,
    autoReadPage: true,
    enableTools: true,
    enableWebSearch: true,
    includePageContext: true,
    includeDomSummary: true,
    includeSelectedElement: true,
  });

  assert.equal(config.autoReadPage, false);
  assert.equal(config.fastAgentMode, false);
  assert.equal(config.enableTools, false);
  assert.equal(config.enableWebSearch, false);
  assert.equal(config.includePageContext, false);
  assert.equal(config.includeDomSummary, false);
  assert.equal(config.includeSelectedElement, false);
});

function message(
  id: string,
  role: ChatMessage["role"],
  content: string,
): ChatMessage {
  return {
    id,
    role,
    content,
    createdAt: "2026-07-14T00:00:00.000Z",
  };
}

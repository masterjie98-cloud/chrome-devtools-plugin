import assert from "node:assert/strict";
import test from "node:test";
import { AgentRunRegistry } from "../src/sidepanel/services/agentRunRegistry";

test("agent runs are isolated per conversation and may execute concurrently", () => {
  const registry = new AgentRunRegistry();
  const first = {
    runId: "run-a",
    conversationId: "conversation-a",
    assistantMessageId: "assistant-a",
    controller: new AbortController(),
  };
  const second = {
    runId: "run-b",
    conversationId: "conversation-b",
    assistantMessageId: "assistant-b",
    controller: new AbortController(),
  };
  registry.start(first);
  registry.start(second);

  assert.equal(registry.list().length, 2);
  assert.equal(registry.isCurrent("conversation-a", "run-a"), true);
  registry.cancel("conversation-a", new DOMException("stop", "AbortError"));
  assert.equal(first.controller.signal.aborted, true);
  assert.equal(second.controller.signal.aborted, false);
  assert.equal(registry.finish("conversation-a", "run-a"), true);
  assert.equal(registry.list().length, 1);
});

test("agent registry rejects two simultaneous runs in one conversation", () => {
  const registry = new AgentRunRegistry();
  registry.start({
    runId: "run-a",
    conversationId: "conversation-a",
    assistantMessageId: "assistant-a",
    controller: new AbortController(),
  });
  assert.throws(
    () =>
      registry.start({
        runId: "run-a2",
        conversationId: "conversation-a",
        assistantMessageId: "assistant-a2",
        controller: new AbortController(),
      }),
    /AGENT_CONVERSATION_BUSY/,
  );
});

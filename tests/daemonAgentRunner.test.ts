import assert from "node:assert/strict";
import test from "node:test";
import { DaemonAgentRunner } from "../src/daemon/agentRunner";
import { createAgentSessionSnapshot, finalizeAgentSession } from "../src/shared/agentSession";
import type { DaemonAgentEventPayload, DaemonAgentStartPayload } from "../src/shared/daemonAgent";
import type { RunAutonomousAgentSessionParams } from "../src/sidepanel/services/autonomousAgent";

test("daemon Agent runs are isolated per conversation and survive requester lifetime", async () => {
  const gates = new Map<string, () => void>();
  const runner = new DaemonAgentRunner(async (params) => {
    const running = createAgentSessionSnapshot(
      "internal-session",
      params.input,
      undefined,
      params.executionBinding,
      params.assistantMessageId,
    );
    params.onSessionUpdate?.(running);
    params.onVisibleContent(`working:${params.input}`);
    await new Promise<void>((resolve) => gates.set(params.input, resolve));
    const completed = finalizeAgentSession(running, "completed", `done:${params.input}`);
    params.onSessionUpdate?.(completed);
    return {
      finalContent: `done:${params.input}`,
      session: completed,
      status: "completed",
    };
  });
  const events: DaemonAgentEventPayload[] = [];
  const persisted: DaemonAgentEventPayload[] = [];
  const callbacks = {
    executeTool: async () => ({}),
    emit: (event: DaemonAgentEventPayload) => events.push(event),
    persistSession: (
      event: DaemonAgentEventPayload & { kind: "session" },
    ) => persisted.push(event),
  };
  const firstPayload = payload("run-a", "conversation-a");
  const secondPayload = payload("run-b", "conversation-b");

  runner.start("profile-a", firstPayload, callbacks);
  runner.start("profile-a", secondPayload, callbacks);
  assert.throws(
    () => runner.start("profile-a", payload("run-a2", "conversation-a"), callbacks),
    /AGENT_CONVERSATION_BUSY/,
  );

  await waitFor(() => gates.size === 2);
  gates.get("conversation-a")?.();
  gates.get("conversation-b")?.();
  await waitFor(
    () => events.filter((event) => event.kind === "completed").length === 2,
  );

  const sessionEvents = persisted.filter(
    (event): event is Extract<DaemonAgentEventPayload, { kind: "session" }> =>
      event.kind === "session",
  );
  assert.equal(sessionEvents.some((event) => event.session.id === "run-a"), true);
  assert.equal(
    sessionEvents.every((event) => event.session.executionOwner === "daemon"),
    true,
  );
  assert.equal(firstPayload.config.apiKey, "");
  assert.equal(secondPayload.config.apiKey, "");
  assert.equal(JSON.stringify(events).includes("secret-only-in-memory"), false);
  assert.equal(JSON.stringify(persisted).includes("secret-only-in-memory"), false);
});

test("daemon Agent cancellation is scoped to one run", async () => {
  let observedAbort = false;
  const runner = new DaemonAgentRunner(async (params: RunAutonomousAgentSessionParams) => {
    await new Promise<void>((resolve) => {
      params.abortSignal?.addEventListener(
        "abort",
        () => {
          observedAbort = true;
          resolve();
        },
        { once: true },
      );
    });
    const session = finalizeAgentSession(
      createAgentSessionSnapshot("internal", params.input),
      "cancelled",
      "cancelled",
    );
    return { finalContent: "cancelled", session, status: "cancelled" };
  });
  const callbacks = {
    executeTool: async () => ({}),
    emit: () => undefined,
    persistSession: () => undefined,
  };
  runner.start("profile-a", payload("run-a", "conversation-a"), callbacks);
  assert.equal(
    runner.cancel("profile-a", "conversation-a", "run-a", "test cancel"),
    true,
  );
  await waitFor(() => observedAbort);
  assert.equal(
    runner.cancel("profile-a", "conversation-b", "run-a", "wrong conversation"),
    false,
  );
});

test("daemon Agent persists a terminal failure before notifying the UI", async () => {
  const runner = new DaemonAgentRunner(async (params) => {
    const running = createAgentSessionSnapshot(
      "internal-session",
      params.input,
      undefined,
      params.executionBinding,
      params.assistantMessageId,
    );
    params.onSessionUpdate?.(running);
    throw new Error("provider disconnected");
  });
  const events: DaemonAgentEventPayload[] = [];
  const persisted: DaemonAgentEventPayload[] = [];
  runner.start("profile-a", payload("run-failure", "conversation-failure"), {
    executeTool: async () => ({}),
    emit: (event) => events.push(event),
    persistSession: (event) => persisted.push(event),
  });

  await waitFor(() => events.some((event) => event.kind === "completed"));
  const terminal = persisted.find(
    (event) => event.kind === "session" && event.session.status === "failed",
  );
  assert.equal(terminal?.kind, "session");
  assert.equal(
    events.some(
      (event) =>
        event.kind === "completed" && event.result.status === "failed",
    ),
    true,
  );
});

function payload(runId: string, conversationId: string): DaemonAgentStartPayload {
  return {
    runId,
    conversationId,
    assistantMessageId: `assistant-${runId}`,
    config: {
      apiUrl: "https://provider.example/v1/chat/completions",
      apiKey: "secret-only-in-memory",
      model: "fixture-model",
      temperature: 0,
      maxHistory: 12,
      contextWindowTokens: 128_000,
      supportsVision: false,
      includeImageHistory: false,
      fastAgentMode: true,
      autoReadPage: false,
      enableTools: false,
      allowPseudoToolCalls: false,
      maxToolRounds: 0,
      autoContinueAfterToolRoundLimit: false,
      includePageContext: false,
      includeDomSummary: false,
      includeSelectedElement: false,
      visibleTextLimit: 2_000,
      domSummaryLimit: 6_000,
      supportsWebSearch: false,
      enableWebSearch: false,
      capabilityDetection: {},
    },
    messages: [],
    input: conversationId,
    attachments: [],
    context: {},
    executionBinding: {
      taskId: conversationId,
      conversationId,
      target: { tabId: 1, url: "https://example.test/", title: "Fixture" },
    },
    egressDestinations: ["https://provider.example"],
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for daemon Agent fixture.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

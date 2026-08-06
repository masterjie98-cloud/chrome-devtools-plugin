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

test("daemon Agent skips automatic page reads when a chat has no browser binding", async () => {
  let preparedContext: unknown;
  let executeToolCount = 0;
  const runner = new DaemonAgentRunner(async (params) => {
    preparedContext = await params.prepareContext?.(params.context);
    const session = finalizeAgentSession(
      createAgentSessionSnapshot("internal", params.input),
      "completed",
      "answered without page context",
    );
    return {
      finalContent: "answered without page context",
      session,
      status: "completed",
    };
  });
  const events: DaemonAgentEventPayload[] = [];
  const unboundPayload = payload("run-unbound", "conversation-unbound");
  unboundPayload.executionBinding = undefined;
  unboundPayload.config.autoReadPage = true;
  unboundPayload.config.includePageContext = true;

  runner.start("profile-a", unboundPayload, {
    executeTool: async () => {
      executeToolCount += 1;
      return {};
    },
    emit: (event) => events.push(event),
    persistSession: () => undefined,
  });

  await waitFor(() => events.some((event) => event.kind === "completed"));
  assert.equal(executeToolCount, 0);
  assert.deepEqual(preparedContext, {});
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

test("daemon Agent waits for an explicit budget decision instead of auto-summarizing", async () => {
  const runner = new DaemonAgentRunner(async (params) => {
    const decision = await params.requestBudgetExtension?.({
      kind: "sensitive_tool_calls",
      label: "敏感读取工具调用",
      used: 32,
      requested: 1,
      limit: 32,
      increment: 32,
      nextLimit: 64,
      unit: "count",
    });
    assert.equal(decision, "continue");
    const session = finalizeAgentSession(
      createAgentSessionSnapshot("internal", params.input),
      "completed",
      "continued",
    );
    return { finalContent: "continued", session, status: "completed" };
  });
  const events: DaemonAgentEventPayload[] = [];
  runner.start("profile-a", payload("run-budget", "conversation-budget"), {
    executeTool: async () => ({}),
    emit: (event) => events.push(event),
    persistSession: () => undefined,
  });

  await waitFor(() => events.some((event) => event.kind === "budget_request"));
  assert.equal(events.some((event) => event.kind === "completed"), false);
  const request = events.find(
    (event): event is Extract<DaemonAgentEventPayload, { kind: "budget_request" }> =>
      event.kind === "budget_request",
  );
  assert.ok(request);
  assert.equal(
    runner.resolveBudgetDecision("profile-a", {
      runId: request.runId,
      conversationId: request.conversationId,
      budgetRequestId: "stale-request",
      decision: "continue",
    }),
    false,
  );
  assert.equal(
    runner.resolveBudgetDecision("profile-a", {
      runId: request.runId,
      conversationId: request.conversationId,
      budgetRequestId: request.budgetRequestId,
      decision: "continue",
    }),
    true,
  );
  await waitFor(() => events.some((event) => event.kind === "completed"));
});

test("cancelling a pending budget decision releases the conversation for the next run", async () => {
  let invocation = 0;
  const runner = new DaemonAgentRunner(async (params) => {
    invocation += 1;
    if (invocation === 1) {
      await params.requestBudgetExtension?.({
        kind: "tool_calls",
        label: "工具调用",
        used: 128,
        requested: 1,
        limit: 128,
        increment: 128,
        nextLimit: 256,
        unit: "count",
      });
    }
    const session = finalizeAgentSession(
      createAgentSessionSnapshot("internal", params.input),
      "completed",
      "done",
    );
    return { finalContent: "done", session, status: "completed" };
  });
  const events: DaemonAgentEventPayload[] = [];
  const callbacks = {
    executeTool: async () => ({}),
    emit: (event: DaemonAgentEventPayload) => events.push(event),
    persistSession: () => undefined,
  };

  runner.start("profile-a", payload("run-budget-cancel", "conversation-a"), callbacks);
  await waitFor(() => events.some((event) => event.kind === "budget_request"));
  assert.equal(
    runner.cancel(
      "profile-a",
      "conversation-a",
      "run-budget-cancel",
      "interrupt with next message",
    ),
    true,
  );
  await waitFor(() => events.some((event) => event.kind === "failed"));

  assert.doesNotThrow(() =>
    runner.start("profile-a", payload("run-after-cancel", "conversation-a"), callbacks),
  );
  await waitFor(() =>
    events.some(
      (event) => event.kind === "completed" && event.runId === "run-after-cancel",
    ),
  );
});

test("daemon Agent stops a volatile external MCP duplicate loop before a second execution", async () => {
  const externalToolName =
    "extmcp__mcp_prometheus_inf__prometheus_query_0ed7db8";
  const responses = [
    ...Array.from({ length: 2 }, (_, index) => ({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: `daemon-repeat-${index + 1}`,
                type: "function",
                function: {
                  name: externalToolName,
                  arguments: '{"query":"up"}',
                },
              },
            ],
          },
        },
      ],
    })),
    {
      choices: [
        {
          message: {
            content: "相同 Prometheus 证据已足够，停止重复查询并完成总结。",
          },
        },
      ],
    },
  ];
  const requestBodies: Record<string, unknown>[] = [];
  const restoreFetch = installDaemonAgentFetchFixture(
    (index) => responses[index] ?? responses.at(-1)!,
    requestBodies,
  );
  const events: DaemonAgentEventPayload[] = [];
  const startPayload = payload(
    "run-external-repeat",
    "conversation-external-repeat",
  );
  startPayload.config.enableTools = true;
  startPayload.config.maxToolRounds = 1;
  startPayload.config.autoContinueAfterToolRoundLimit = true;
  startPayload.runBudgetLimits = {
    maxToolCalls: 2,
    maxEffectfulToolCalls: 2,
    maxSensitiveToolCalls: 2,
  };
  startPayload.tools = [
    {
      type: "function",
      function: {
        name: externalToolName,
        description: "Query Prometheus.",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false,
        },
      },
      clientMetadata: {
        source: "external_mcp",
        displayName: "prometheus_query",
        externalMcpServerId: "mcp_prometheus_inf",
        externalMcpServerName: "Prometheus Infra MCP",
        externalMcpToolName: "prometheus_query",
      },
    },
  ];
  let executionCount = 0;

  try {
    const runner = new DaemonAgentRunner();
    runner.start("profile-a", startPayload, {
      executeTool: async () => {
        executionCount += 1;
        return {
          content: [],
          structuredContent: {
            observed_at: `2026-08-05T03:10:0${executionCount}Z`,
            evidence_ref: `prometheus://prometheus-infra-0/query/${executionCount}`,
            result_type: "vector",
            data: [
              {
                metric: {},
                value: [1_785_984_000 + executionCount, "12"],
              },
            ],
          },
        };
      },
      emit: (event) => events.push(event),
      persistSession: () => undefined,
    });

    await waitFor(() =>
      events.some(
        (event) =>
          event.kind === "completed" &&
          event.runId === "run-external-repeat",
      ),
    );

    const toolMessages = events.filter(
      (event) =>
        event.kind === "tool_message" &&
        event.runId === "run-external-repeat",
    );
    const completed = events.find(
      (event) =>
        event.kind === "completed" &&
        event.runId === "run-external-repeat",
    );
    assert.equal(executionCount, 1);
    assert.equal(toolMessages.length, 1);
    assert.equal(completed?.kind, "completed");
    if (completed?.kind === "completed") {
      assert.equal(completed.result.status, "completed");
      assert.match(completed.result.finalContent, /停止重复查询/);
    }
    assert.equal(requestBodies.length, 3);
    assert.equal(
      Object.hasOwn(requestBodies.at(-1) ?? {}, "tools"),
      false,
    );
  } finally {
    restoreFetch();
  }
});

test("large MCP results stay detailed in the UI but are compacted before model reuse", async () => {
  let modelResult = "";
  const externalToolName =
    "extmcp__mcp_prometheus_inf__resources_list_fixture";
  const runner = new DaemonAgentRunner(async (params) => {
    const results = await params.executeToolCalls(
      [
        {
          id: "large-result-call",
          name: externalToolName,
          arguments: {},
          rawArguments: "{}",
        },
      ],
      params.assistantMessageId,
    );
    modelResult = results[0]?.content ?? "";
    const session = finalizeAgentSession(
      createAgentSessionSnapshot("internal", params.input),
      "completed",
      "done",
    );
    return { finalContent: "done", session, status: "completed" };
  });
  const events: DaemonAgentEventPayload[] = [];
  const startPayload = payload("run-large-result", "conversation-large-result");
  startPayload.tools = [
    {
      type: "function",
      function: {
        name: externalToolName,
        parameters: { type: "object" },
      },
      clientMetadata: {
        source: "external_mcp",
        externalMcpToolName: "resources_list",
      },
    },
  ];

  runner.start("profile-a", startPayload, {
    executeTool: async () => ({ text: `HEAD-${"x".repeat(180_000)}-TAIL` }),
    emit: (event) => events.push(event),
    persistSession: () => undefined,
  });

  await waitFor(() => events.some((event) => event.kind === "completed"));
  const toolEvent = events.find(
    (event): event is Extract<DaemonAgentEventPayload, { kind: "tool_message" }> =>
      event.kind === "tool_message",
  );
  assert.ok(toolEvent);
  assert.ok(toolEvent.message.content.length > 180_000);
  assert.ok(modelResult.length <= 25_600);
  assert.match(modelResult, /tool result compacted for model context/);
  assert.match(modelResult, /-TAIL/);
});

test("daemon tool messages include redacted request arguments and MCP origin metadata", async () => {
  const externalToolName =
    "extmcp__mcp_prometheus_inf__prometheus_query_0ed7db8";
  const runner = new DaemonAgentRunner(async (params) => {
    await params.executeToolCalls(
      [
        {
          id: "call-prometheus-audit",
          name: externalToolName,
          arguments: { query: "up", password: "do-not-store" },
          rawArguments: '{"query":"up","password":"do-not-store"}',
        },
      ],
      params.assistantMessageId,
    );
    const session = finalizeAgentSession(
      createAgentSessionSnapshot("internal", params.input),
      "completed",
      "done",
    );
    return { finalContent: "done", session, status: "completed" };
  });
  const events: DaemonAgentEventPayload[] = [];
  const startPayload = payload("run-audit", "conversation-audit");
  startPayload.tools = [
    {
      type: "function",
      function: {
        name: externalToolName,
        description: "Query Prometheus",
        parameters: { type: "object" },
      },
      clientMetadata: {
        source: "external_mcp",
        displayName: "prometheus_query",
        externalMcpServerId: "mcp_prometheus_inf",
        externalMcpServerName: "Prometheus Infra MCP",
        externalMcpToolName: "prometheus_query",
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    },
  ];

  runner.start("profile-a", startPayload, {
    executeTool: async () => ({ status: "ok", targets: 8 }),
    emit: (event) => events.push(event),
    persistSession: () => undefined,
  });

  await waitFor(() => events.some((event) => event.kind === "completed"));
  const toolEvent = events.find(
    (event): event is Extract<DaemonAgentEventPayload, { kind: "tool_message" }> =>
      event.kind === "tool_message",
  );
  assert.ok(toolEvent);
  assert.equal(toolEvent.message.toolSource, "external_mcp");
  assert.equal(toolEvent.message.toolDisplayName, "prometheus_query");
  assert.equal(toolEvent.message.toolServerName, "Prometheus Infra MCP");
  assert.match(toolEvent.message.requestArguments ?? "", /"query": "up"/);
  assert.doesNotMatch(toolEvent.message.requestArguments ?? "", /do-not-store/);
  assert.match(toolEvent.message.requestArguments ?? "", /\[redacted\]/);
  assert.equal(toolEvent.message.resultMeta?.truncated, false);
  assert.match(toolEvent.message.content, /"targets": 8/);
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

function installDaemonAgentFetchFixture(
  responsePayload: (requestIndex: number) => Record<string, unknown>,
  requestBodies: Record<string, unknown>[],
): () => void {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
  let requestIndex = 0;
  globalThis.fetch = (async (_input, init) => {
    if (typeof init?.body === "string") {
      requestBodies.push(JSON.parse(init.body) as Record<string, unknown>);
    }
    const response = responsePayload(requestIndex);
    requestIndex += 1;
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  };
}

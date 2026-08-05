import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentSessionSnapshot,
  finalizeAgentSession,
} from "../src/shared/agentSession";
import type { DaemonAgentStartPayload } from "../src/shared/daemonAgent";
import { WS_COMMANDS } from "../src/shared/wsProtocol";

class FakeWebSocket {
  static readonly OPEN = 1;
  readonly OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  readonly sent: string[] = [];

  send(value: string): void {
    this.sent.push(value);
  }

  addEventListener(): void {}
  close(): void {
    this.readyState = 3;
  }
}

test("daemon Agent start timeout cancels and reconciles before releasing the local run", async () => {
  const restore = installBridgeGlobals();
  try {
    const { McpBridge } = await import(
      "../src/sidepanel/services/mcpBridge"
    );
    const bridge = new McpBridge({
      daemonAgentStartTimeoutMs: 5,
      daemonAgentCancelRetryMs: 50,
    });
    const socket = attachOpenSocket(bridge);
    const completion = bridge.runDaemonAgentSession(
      daemonPayload("run-timeout"),
      { onVisibleContent: () => undefined },
    );

    const timedOutStart = await waitForCommand(
      socket,
      WS_COMMANDS.DAEMON_AGENT_START,
    );
    const cancel = await waitForCommand(
      socket,
      WS_COMMANDS.DAEMON_AGENT_CANCEL,
    );
    await dispatchServerMessage(bridge, socket, {
      requestId: cancel.requestId,
      command: WS_COMMANDS.DAEMON_AGENT_CANCEL_RESULT,
      sentAt: new Date().toISOString(),
      payload: {
        runId: "run-timeout",
        conversationId: "conversation-a",
        accepted: false,
        state: "not_active",
      },
    });

    await assert.rejects(
      completion,
      /启动 daemon Agent 超时；已请求 daemon 取消并核对旧任务状态/,
    );
    assert.equal(internalMap(bridge, "activeDaemonAgentRuns").size, 0);
    assert.equal(internalMap(bridge, "pendingDaemonAgentCancels").size, 0);

    const controller = new AbortController();
    const retry = bridge.runDaemonAgentSession(
      daemonPayload("run-retry"),
      { onVisibleContent: () => undefined },
      controller.signal,
    );
    const retryRejected = assert.rejects(retry, { name: "AbortError" });
    await waitForCommand(
      socket,
      WS_COMMANDS.DAEMON_AGENT_START,
      timedOutStart.requestId as string,
    );
    controller.abort(new DOMException("fixture cancelled", "AbortError"));
    const retryCancel = await waitForCommand(
      socket,
      WS_COMMANDS.DAEMON_AGENT_CANCEL,
      cancel.requestId as string,
    );
    await dispatchServerMessage(bridge, socket, {
      requestId: retryCancel.requestId,
      command: WS_COMMANDS.DAEMON_AGENT_CANCEL_RESULT,
      sentAt: new Date().toISOString(),
      payload: {
        runId: "run-retry",
        conversationId: "conversation-a",
        accepted: false,
        state: "not_active",
      },
    });
    await retryRejected;
  } finally {
    restore();
  }
});

test("daemon Agent cancellation waits for the acknowledged terminal result", async () => {
  const restore = installBridgeGlobals();
  try {
    const { McpBridge } = await import(
      "../src/sidepanel/services/mcpBridge"
    );
    const bridge = new McpBridge({
      daemonAgentStartTimeoutMs: 1_000,
      daemonAgentCancelRetryMs: 50,
    });
    const socket = attachOpenSocket(bridge);
    const controller = new AbortController();
    const completion = bridge.runDaemonAgentSession(
      daemonPayload("run-cancel"),
      { onVisibleContent: () => undefined },
      controller.signal,
    );
    const start = await waitForCommand(socket, WS_COMMANDS.DAEMON_AGENT_START);
    await dispatchServerMessage(bridge, socket, {
      requestId: start.requestId,
      command: WS_COMMANDS.DAEMON_AGENT_START_RESULT,
      sentAt: new Date().toISOString(),
      payload: {
        ok: true,
        runId: "run-cancel",
        conversationId: "conversation-a",
        acceptedAt: new Date().toISOString(),
      },
    });

    controller.abort(new DOMException("fixture cancelled", "AbortError"));
    const cancel = await waitForCommand(
      socket,
      WS_COMMANDS.DAEMON_AGENT_CANCEL,
    );
    const running = {
      ...createAgentSessionSnapshot("run-cancel", "fixture"),
      executionOwner: "daemon" as const,
    };
    await dispatchServerMessage(bridge, socket, {
      requestId: cancel.requestId,
      command: WS_COMMANDS.DAEMON_AGENT_CANCEL_RESULT,
      sentAt: new Date().toISOString(),
      payload: {
        runId: "run-cancel",
        conversationId: "conversation-a",
        accepted: true,
        state: "cancelling",
        session: running,
      },
    });
    assert.equal(internalMap(bridge, "activeDaemonAgentRuns").size, 1);

    const cancelled = finalizeAgentSession(
      running,
      "cancelled",
      "Agent 已取消。",
    );
    await dispatchServerMessage(bridge, socket, {
      requestId: "terminal-event",
      command: WS_COMMANDS.DAEMON_AGENT_EVENT,
      sentAt: new Date().toISOString(),
      payload: {
        runId: "run-cancel",
        conversationId: "conversation-a",
        kind: "completed",
        result: {
          finalContent: "Agent 已取消。",
          session: cancelled,
          status: "cancelled",
        },
      },
    });

    assert.equal((await completion).status, "cancelled");
    assert.equal(internalMap(bridge, "activeDaemonAgentRuns").size, 0);
  } finally {
    restore();
  }
});

test("daemon Agent cancellation is resent after a socket reconnect before acknowledgement", async () => {
  const restore = installBridgeGlobals();
  try {
    const { McpBridge } = await import(
      "../src/sidepanel/services/mcpBridge"
    );
    const bridge = new McpBridge({
      daemonAgentStartTimeoutMs: 1_000,
      daemonAgentCancelRetryMs: 100,
    });
    const firstSocket = attachOpenSocket(bridge);
    const controller = new AbortController();
    const completion = bridge.runDaemonAgentSession(
      daemonPayload("run-reconnect"),
      { onVisibleContent: () => undefined },
      controller.signal,
    );
    const rejected = assert.rejects(completion, { name: "AbortError" });
    const start = await waitForCommand(
      firstSocket,
      WS_COMMANDS.DAEMON_AGENT_START,
    );
    await dispatchServerMessage(bridge, firstSocket, {
      requestId: start.requestId,
      command: WS_COMMANDS.DAEMON_AGENT_START_RESULT,
      sentAt: new Date().toISOString(),
      payload: {
        ok: true,
        runId: "run-reconnect",
        conversationId: "conversation-a",
        acceptedAt: new Date().toISOString(),
      },
    });
    controller.abort(new DOMException("fixture cancelled", "AbortError"));
    const firstCancel = await waitForCommand(
      firstSocket,
      WS_COMMANDS.DAEMON_AGENT_CANCEL,
    );

    (
      bridge as unknown as {
        resetDaemonAgentCancelRequestsForReconnect: () => void;
      }
    ).resetDaemonAgentCancelRequestsForReconnect();
    const secondSocket = attachOpenSocket(bridge);
    (
      bridge as unknown as {
        reconcileDaemonAgentCancellations: () => void;
      }
    ).reconcileDaemonAgentCancellations();
    const secondCancel = await waitForCommand(
      secondSocket,
      WS_COMMANDS.DAEMON_AGENT_CANCEL,
    );
    assert.notEqual(secondCancel.requestId, firstCancel.requestId);
    await dispatchServerMessage(bridge, secondSocket, {
      requestId: secondCancel.requestId,
      command: WS_COMMANDS.DAEMON_AGENT_CANCEL_RESULT,
      sentAt: new Date().toISOString(),
      payload: {
        runId: "run-reconnect",
        conversationId: "conversation-a",
        accepted: false,
        state: "not_active",
      },
    });

    await rejected;
    assert.equal(internalMap(bridge, "activeDaemonAgentRuns").size, 0);
  } finally {
    restore();
  }
});

function daemonPayload(runId: string): DaemonAgentStartPayload {
  return {
    runId,
    conversationId: "conversation-a",
    assistantMessageId: `assistant-${runId}`,
    config: {
      apiUrl: "https://provider.example/v1/chat/completions",
      apiKey: "",
      model: "fixture",
      temperature: 0,
      maxHistory: 12,
      contextWindowTokens: 128_000,
      supportsVision: false,
      includeImageHistory: false,
      fastAgentMode: true,
      autoReadPage: false,
      enableTools: true,
      allowPseudoToolCalls: false,
      maxToolRounds: 50,
      autoContinueAfterToolRoundLimit: true,
      includePageContext: false,
      includeDomSummary: false,
      includeSelectedElement: false,
      visibleTextLimit: 2_200,
      domSummaryLimit: 6_000,
      supportsWebSearch: false,
      enableWebSearch: false,
      capabilityDetection: {},
    },
    messages: [],
    input: "fixture",
    attachments: [],
    context: {},
    egressDestinations: ["https://provider.example"],
  };
}

function attachOpenSocket(bridge: object): FakeWebSocket {
  const socket = new FakeWebSocket();
  const internal = bridge as {
    socket: FakeWebSocket;
    authenticatedSocket: FakeWebSocket;
  };
  internal.socket = socket;
  internal.authenticatedSocket = socket;
  return socket;
}

async function dispatchServerMessage(
  bridge: object,
  socket: FakeWebSocket,
  message: Record<string, unknown>,
): Promise<void> {
  await (
    bridge as {
      handleServerMessage: (
        raw: string,
        currentSocket: FakeWebSocket,
      ) => Promise<void>;
    }
  ).handleServerMessage(JSON.stringify(message), socket);
}

function internalMap(
  bridge: object,
  key: "activeDaemonAgentRuns" | "pendingDaemonAgentCancels",
): Map<unknown, unknown> {
  return (bridge as Record<typeof key, Map<unknown, unknown>>)[key];
}

async function waitForCommand(
  socket: FakeWebSocket,
  command: string,
  excludedRequestId?: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    for (const raw of socket.sent) {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (
        message.command === command &&
        message.requestId !== excludedRequestId
      ) {
        return message;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`Timed out waiting for ${command}.`);
}

function installBridgeGlobals(): () => void {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const previousWebSocket = Object.getOwnPropertyDescriptor(
    globalThis,
    "WebSocket",
  );
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      storage: {
        onChanged: {
          addListener: () => undefined,
        },
      },
    },
  });
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: FakeWebSocket,
  });
  return () => {
    restoreDescriptor("window", previousWindow);
    restoreDescriptor("chrome", previousChrome);
    restoreDescriptor("WebSocket", previousWebSocket);
  };
}

function restoreDescriptor(
  key: "window" | "chrome" | "WebSocket",
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, key, descriptor);
    return;
  }
  Reflect.deleteProperty(globalThis, key);
}

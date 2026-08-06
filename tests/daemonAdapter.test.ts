import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { ArtifactStore } from "../src/daemon/artifacts/store";
import { DaemonStateStore } from "../src/daemon/store/stateStore";
import {
  DaemonClient,
  parseDaemonHandshakeFailure,
} from "../src/mcp/daemonClient";
import { ADAPTER_ROUTING_TOOL_NAMES } from "../src/mcp/adapterRoutingTools";
import { COLLABORATION_TOOL_NAMES } from "../src/mcp/collaborationTools";
import { browserStateHub } from "../src/mcp/browserStateHub";
import { startPluginWebSocketServer } from "../src/mcp/wsServer";
import { MCP_TOOL_NAMES } from "../src/shared/mcpTools";
import { TOOL_NAMES } from "../src/shared/tools";
import {
  isSignedExecutionGrant,
  UNAUTHENTICATED_DEVELOPMENT_GRANT_KEY,
  verifyExecutionGrant,
} from "../src/shared/executionGrant";
import {
  WS_COMMANDS,
  WS_PROTOCOL_VERSION,
  type WsClientRole,
} from "../src/shared/wsProtocol";
import {
  RUNTIME_BUILD_ID,
  RUNTIME_SCHEMA_HASH,
} from "../src/shared/runtimeIdentity";
import {
  clientHelloMessage,
  createDeterministicIdFactory,
  TEST_BRIDGE_TOKEN,
  TEST_EXTENSION_ID,
  TEST_EXTENSION_ORIGIN,
  TEST_PROTOCOL_TIME,
} from "./helpers/protocolFixtures";
import { createTestDataDirectory } from "./helpers/tempDataDir";

interface ParsedTestMessage {
  requestId: unknown;
  command: unknown;
  ok: unknown;
  error: unknown;
  payload: {
    approvalId: string;
    targetRequestId: string;
    connectionId: string;
    assignedRole: WsClientRole;
    sessionId?: string;
    protocolVersion: number;
    limits: Record<string, unknown>;
    call: {
      toolName: string;
      args: Record<string, unknown>;
    };
    [key: string]: unknown;
  };
}

test("daemon handshake mismatch preserves the daemon reason and gives recovery steps", () => {
  const message = parseDaemonHandshakeFailure(
    JSON.stringify({
      requestId: "hello-1",
      ok: false,
      error:
        "SCHEMA_HASH_MISMATCH: daemon=old, mcp=new. Restart the daemon and MCP client.",
    }),
  );

  assert.match(message ?? "", /^RUNTIME_VERSION_MISMATCH:/);
  assert.match(message ?? "", /SCHEMA_HASH_MISMATCH/);
  assert.match(message ?? "", /older daemon instance/);
  assert.match(message ?? "", /reopen the MCP client/);
});

test("one daemon serves multiple independent MCP adapter clients", async () => {
  browserStateHub.setCurrentTab({
    url: "https://example.test/multi-client",
    title: "Shared target",
  });

  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const first = new DaemonClient(url, "default", TEST_BRIDGE_TOKEN);
  const second = new DaemonClient(url, "default", TEST_BRIDGE_TOKEN);

  try {
    const [firstState, secondState, tools] = await Promise.all([
      first.readState("activeTab"),
      second.readState("activeTab"),
      second.listTools(),
    ]);

    assert.deepEqual(firstState, secondState);
    assert.equal(
      readNestedString(firstState, "value", "url"),
      "https://example.test/multi-client",
    );
    const snapshotTool = tools.find(
      (tool) =>
        Boolean(tool) &&
        typeof tool === "object" &&
        (tool as Record<string, unknown>).name ===
          MCP_TOOL_NAMES.BROWSER_SNAPSHOT,
    ) as Record<string, unknown> | undefined;
    assert.ok(snapshotTool);
    const snapshotOutputSchema = snapshotTool.outputSchema as
      | Record<string, unknown>
      | undefined;
    assert.equal(snapshotOutputSchema?.type, "object");
    assert.equal(
      isRecord(snapshotOutputSchema?.properties) &&
        "snapshot" in snapshotOutputSchema.properties,
      true,
    );
    assert.equal(daemon.connectedClients(), 2);
    await assert.rejects(
      first.readState("pluginConversation"),
      /approval-gated MCP tool/,
    );
    await assert.rejects(
      first.readState("activeTab", "another-session"),
      /cannot override its browser session/,
    );
  } finally {
    first.close();
    second.close();
    await daemon.close();
  }
});

test("daemon client reconnects and retries a safe read after daemon restart", async () => {
  const sessionId = "daemon-reconnect-safe-read";
  browserStateHub.setCurrentTab(
    {
      url: "https://example.test/reconnect",
      title: "Reconnect",
    },
    sessionId,
  );
  const firstDaemon = startPluginWebSocketServer(0);
  const address = await firstDaemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const client = new DaemonClient(url, sessionId, TEST_BRIDGE_TOKEN);
  let secondDaemon: ReturnType<typeof startPluginWebSocketServer> | undefined;

  try {
    await client.readState("activeTab");
    await firstDaemon.close();
    const restart = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        secondDaemon = startPluginWebSocketServer(address.port);
        secondDaemon.ready().then(() => resolve(), reject);
      }, 150);
    });

    const [state] = await Promise.all([
      client.readState("activeTab"),
      restart,
    ]);
    assert.equal(
      readNestedString(state, "value", "url"),
      "https://example.test/reconnect",
    );
  } finally {
    client.close();
    await secondDaemon?.close();
  }
});

test("authenticated UI clients publish sidepanel state to their bound session", async () => {
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const sessionId = "ui-state-sync-session";
  const browser = await connectRole(url, "browser", sessionId);
  const ui = await connectRole(url, "ui", sessionId);
  const conversationId = "ui-conversation-1";

  try {
    const pageContext = pageContextMessage(
      sessionId,
      "https://ui-state.example/",
    );
    const activeTab = (pageContext.payload as {
      pageContext: { provenance: { target: Record<string, unknown> } };
    }).pageContext.provenance.target;
    await sendAndWaitForAck(browser, {
      requestId: "browser-active-target-before-ui-state",
      command: WS_COMMANDS.ACTIVE_TAB_UPDATED,
      sentAt: new Date().toISOString(),
      payload: { activeTab },
    });
    await sendAndWaitForAck(ui, {
      requestId: "ui-conversation-started",
      command: WS_COMMANDS.PLUGIN_CONVERSATION_STARTED,
      sentAt: new Date().toISOString(),
      payload: {
        conversationId,
        startedAt: new Date().toISOString(),
      },
    });
    await sendAndWaitForAck(ui, {
      requestId: "ui-user-message",
      command: WS_COMMANDS.PLUGIN_CHAT_MESSAGE_CREATED,
      sentAt: new Date().toISOString(),
      payload: {
        message: {
          id: "ui-message-1",
          conversationId,
          role: "user",
          content: "User message",
          createdAt: new Date().toISOString(),
        },
      },
    });
    await sendAndWaitForAck(ui, {
      requestId: "ui-assistant-message",
      command: WS_COMMANDS.PLUGIN_CHAT_MESSAGE_CREATED,
      sentAt: new Date().toISOString(),
      payload: {
        message: {
          id: "ui-message-2",
          conversationId,
          role: "assistant",
          content: "Assistant message",
          createdAt: new Date().toISOString(),
        },
      },
    });
    await sendAndWaitForAck(ui, pageContext);

    await waitUntil(() => {
      const state = browserStateHub.snapshot(sessionId);
      return state.pluginConversation.length === 2 && Boolean(state.pageContext);
    });

    const state = browserStateHub.snapshot(sessionId);
    assert.equal(state.currentConversationId, conversationId);
    assert.deepEqual(
      state.pluginConversation.map((message) => [message.id, message.role]),
      [
        ["ui-message-1", "user"],
        ["ui-message-2", "assistant"],
      ],
    );
    assert.equal(
      state.pageContext?.provenance?.target.documentId,
      `document-${sessionId}`,
    );
  } finally {
    ui.close();
    browser.close();
    await daemon.close();
  }
});

test("each sidepanel connection keeps its own task conversation binding", async () => {
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const sessionId = "ui-conversation-binding-session";
  const browser = await connectRole(url, "browser", sessionId);
  const firstUi = await connectRole(url, "ui", sessionId);
  const secondUi = await connectRole(url, "ui", sessionId);
  const activeTab = {
    url: "https://binding.example/",
    title: "Bound target",
    targetId: "77",
    tabId: 77,
    frameId: 0,
    navigationId: "binding-navigation",
    revision: 1,
  };

  try {
    await sendAndWaitForAck(browser, {
      requestId: "binding-active-target",
      command: WS_COMMANDS.ACTIVE_TAB_UPDATED,
      sentAt: new Date().toISOString(),
      payload: { activeTab },
    });
    await sendAndWaitForAck(firstUi, {
      requestId: "binding-first-conversation",
      command: WS_COMMANDS.PLUGIN_CONVERSATION_STARTED,
      sentAt: new Date().toISOString(),
      payload: {
        conversationId: "conversation-panel-a",
        startedAt: new Date().toISOString(),
      },
    });
    await sendAndWaitForAck(secondUi, {
      requestId: "binding-second-conversation",
      command: WS_COMMANDS.PLUGIN_CONVERSATION_STARTED,
      sentAt: new Date().toISOString(),
      payload: {
        conversationId: "conversation-panel-b",
        startedAt: new Date().toISOString(),
      },
    });
    await waitUntil(
      () =>
        browserStateHub.snapshot(sessionId).currentConversationId ===
        "conversation-panel-b",
    );

    const firstStatus = await callUiMcpTool(
      firstUi,
      "binding-first-status",
      MCP_TOOL_NAMES.BROWSER_STATUS,
      {},
      {
        taskId: "task-panel-a",
        conversationId: "conversation-panel-a",
        target: { tabId: 77, targetId: "77" },
        egressDestinations: [],
      },
    );
    assert.equal(
      readString(firstStatus, "currentConversationId"),
      "conversation-panel-b",
    );

    await assert.rejects(
      callUiMcpTool(
        firstUi,
        "binding-cross-conversation-status",
        MCP_TOOL_NAMES.BROWSER_STATUS,
        {},
        {
          taskId: "task-panel-b",
          conversationId: "conversation-panel-b",
          target: { tabId: 77, targetId: "77" },
          egressDestinations: [],
        },
      ),
      /STALE_CONTEXT.*conversationId/,
    );
  } finally {
    firstUi.close();
    secondUi.close();
    browser.close();
    await daemon.close();
  }
});

test("daemon advertises the assigned role and protocol limits", async () => {
  const daemon = startPluginWebSocketServer(0, undefined, {
    clock: () => Date.parse(TEST_PROTOCOL_TIME),
    createId: createDeterministicIdFactory("server-id"),
  });
  const address = await daemon.ready();
  const socket = new WebSocket(`ws://${address.host}:${address.port}`, {
    origin: TEST_EXTENSION_ORIGIN,
  });

  try {
    await waitForOpen(socket);
    const welcomePromise = waitForCommand(socket, WS_COMMANDS.SERVER_WELCOME);
    socket.send(JSON.stringify(clientHelloMessage(
      "browser",
      "welcome-session",
      { requestId: "hello-with-limits" },
    )));

    const welcome = await welcomePromise;
    assert.equal(welcome.payload.assignedRole, "browser");
    assert.equal(welcome.payload.protocolVersion, WS_PROTOCOL_VERSION);
    assert.equal(welcome.payload.buildId, RUNTIME_BUILD_ID);
    assert.equal(welcome.payload.schemaHash, RUNTIME_SCHEMA_HASH);
    assert.equal(welcome.payload.sessionId, "welcome-session");
    assert.equal(welcome.payload.connectionId, "server-id-1");
    assert.equal(welcome.payload.limits.maxFrameBytes, 8 * 1024 * 1024);
    const messageByteLimits = welcome.payload.limits.maxInboundMessageBytes;
    assert.ok(isRecord(messageByteLimits));
    assert.equal(
      messageByteLimits.HEARTBEAT,
      2 * 1024,
    );
    assert.equal(welcome.payload.limits.clientHelloTimeoutMs, 5_000);
    assert.equal(welcome.payload.limits.maxProtocolViolations, 3);
    assert.equal(welcome.payload.limits.idleTimeoutMs, 90_000);
    assert.equal(welcome.payload.limits.maxRequestDeadlineMs, 120_000);
  } finally {
    socket.close();
    await daemon.close();
  }
});

test("MCP tool listing can exclude every local browser tool", async () => {
  const externalTool = {
    name: "extmcp__fixture__query_1234567",
    title: "query",
    description: "Read fixture data",
    externalMcpServerId: "fixture",
    externalMcpServerName: "Fixture MCP",
    inputSchema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  };
  const daemon = startPluginWebSocketServer(0, {
    listTools: async () => [externalTool],
    callTool: async () => ({ content: [] }),
  });
  const address = await daemon.ready();
  const socket = await connectRole(
    `ws://${address.host}:${address.port}`,
    "ui",
    "external-only-tools",
  );

  try {
    const responsePromise = waitForCommand(
      socket,
      WS_COMMANDS.MCP_LIST_TOOLS_RESULT,
    );
    socket.send(
      JSON.stringify({
        requestId: "external-only-tool-list",
        command: WS_COMMANDS.MCP_LIST_TOOLS,
        sentAt: new Date().toISOString(),
        payload: {
          includeLocal: false,
          includeExternal: true,
          externalServerIds: ["fixture"],
        },
      }),
    );
    const response = await responsePromise;
    assert.equal(response.payload.ok, true);
    assert.deepEqual(response.payload.tools, [externalTool]);
  } finally {
    socket.close();
    await daemon.close();
  }
});

test("external MCP approval survives page navigation because it is conversation-bound, not target-bound", async () => {
  const sessionId = "external-approval-navigation";
  const conversationId = "external-approval-conversation";
  const externalToolName = "extmcp__fixture__query_1234567";
  let callCount = 0;
  const daemon = startPluginWebSocketServer(0, {
    listTools: async () => [],
    callTool: async (toolName, args) => {
      callCount += 1;
      return { toolName, args, ok: true };
    },
    getToolOrigin: (toolName) =>
      toolName === externalToolName
        ? {
            externalMcpServerId: "fixture",
            externalMcpServerName: "Fixture MCP",
            externalMcpToolName: "query",
          }
        : undefined,
  });
  const address = await daemon.ready();
  const ui = await connectRole(
    `ws://${address.host}:${address.port}`,
    "ui",
    sessionId,
  );

  browserStateHub.startPluginConversation(conversationId, sessionId);
  browserStateHub.setCurrentTab(
    {
      tabId: 101,
      targetId: "target-before-approval",
      url: "https://example.test/before",
      title: "Before",
      documentId: "document-before-approval",
      navigationId: "navigation-before-approval",
    },
    sessionId,
  );

  try {
    const approvalPromise = waitForCommand(ui, WS_COMMANDS.APPROVAL_REQUEST);
    const resultPromise = callUiMcpTool(
      ui,
      "external-approval-call",
      externalToolName,
      { query: "up" },
      {
        taskId: conversationId,
        conversationId,
        target: {
          tabId: 101,
          targetId: "target-before-approval",
        },
        egressDestinations: ["fixture"],
      },
    );
    const approval = await approvalPromise;
    assert.equal(approval.payload.target, undefined);
    assert.deepEqual(approval.payload.externalMcp, {
      serverId: "fixture",
      serverName: "Fixture MCP",
      toolName: "query",
    });

    browserStateHub.setCurrentTab(
      {
        tabId: 202,
        targetId: "target-after-approval",
        url: "https://example.test/after",
        title: "After",
        documentId: "document-after-approval",
        navigationId: "navigation-after-approval",
      },
      sessionId,
    );
    ui.send(
      JSON.stringify({
        requestId: approval.payload.approvalId,
        command: WS_COMMANDS.APPROVAL_RESPONSE,
        sentAt: new Date().toISOString(),
        payload: {
          approvalId: approval.payload.approvalId,
          approved: true,
          respondedAt: new Date().toISOString(),
        },
      }),
    );

    assert.deepEqual(await resultPromise, {
      toolName: externalToolName,
      args: { query: "up" },
      ok: true,
    });
    assert.equal(callCount, 1);

    await assert.rejects(
      callUiMcpTool(
        ui,
        "external-stale-conversation-call",
        externalToolName,
        { query: "up" },
        {
          taskId: "stale-conversation",
          conversationId: "stale-conversation",
          target: {
            tabId: 202,
            targetId: "target-after-approval",
          },
          egressDestinations: ["fixture"],
        },
      ),
      /STALE_CONTEXT.*conversationId/,
    );
    assert.equal(callCount, 1);
  } finally {
    ui.close();
    await daemon.close();
  }
});

test("daemon rejects a command above its message-specific byte budget", async () => {
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const socket = await connectRole(
    `ws://${address.host}:${address.port}`,
    "browser",
    "message-byte-session",
  );

  try {
    const error = await sendAndWaitForRejectedAck(socket, {
      requestId: "oversized-heartbeat",
      command: WS_COMMANDS.HEARTBEAT,
      sentAt: new Date().toISOString(),
      payload: { sessionId: "x".repeat(3_000) },
    });
    assert.match(error, /PAYLOAD_TOO_LARGE: HEARTBEAT/);
    await sendAndWaitForAck(socket, {
      requestId: "valid-heartbeat-after-rejection",
      command: WS_COMMANDS.HEARTBEAT,
      sentAt: new Date().toISOString(),
      payload: { sessionId: "message-byte-session" },
    });
  } finally {
    socket.close();
    await daemon.close();
  }
});

test("daemon rejects an unsupported WebSocket protocol version", async () => {
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  try {
    await expectHelloRejected(
      `ws://${address.host}:${address.port}`,
      { clientRole: "mcp", protocolVersion: WS_PROTOCOL_VERSION - 1 },
      undefined,
      /PROTOCOL_VERSION_UNSUPPORTED/,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon rejects stale build and schema identities with restart guidance", async () => {
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  try {
    await expectHelloRejected(
      url,
      {
        clientRole: "mcp",
        buildId: "0.0.0+stale",
      },
      undefined,
      /BUILD_ID_MISMATCH:.*Restart the daemon and MCP client.*reload the Chrome extension/i,
    );
    await expectHelloRejected(
      url,
      {
        clientRole: "mcp",
        schemaHash: "00000000",
      },
      undefined,
      /SCHEMA_HASH_MISMATCH:.*Restart the daemon and MCP client.*reload the Chrome extension/i,
    );
    await expectHelloRejected(
      url,
      {
        clientRole: "mcp",
        protocolVersion: WS_PROTOCOL_VERSION - 1,
        buildId: undefined,
        schemaHash: undefined,
      },
      undefined,
      /PROTOCOL_VERSION_UNSUPPORTED:.*Rebuild or update the extension and MCP adapter together/i,
    );
    await expectHelloRejected(
      url,
      {
        clientRole: "mcp",
        buildId: undefined,
      },
      undefined,
      /BUILD_ID_MISMATCH:.*Restart the daemon and MCP client.*reload the Chrome extension/i,
    );
    await expectHelloRejected(
      url,
      {
        clientRole: "mcp",
        schemaHash: undefined,
      },
      undefined,
      /SCHEMA_HASH_MISMATCH:.*Restart the daemon and MCP client.*reload the Chrome extension/i,
    );
  } finally {
    await daemon.close();
  }
});

test("daemon closes a connection that exceeds its message rate", async () => {
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const socket = await connectRole(
    `ws://${address.host}:${address.port}`,
    "browser",
    "rate-session",
  );

  try {
    const closed = new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for rate-limit close.")),
        2_000,
      );
      socket.once("close", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
    for (let index = 0; index < 300; index += 1) {
      socket.send(JSON.stringify({
        requestId: `heartbeat-${index}`,
        command: WS_COMMANDS.HEARTBEAT,
        sentAt: new Date().toISOString(),
        payload: { sessionId: "rate-session" },
      }));
    }
    assert.equal(await closed, 1008);
  } finally {
    socket.close();
    await daemon.close();
  }
});

test("daemon closes a connection that does not send CLIENT_HELLO in time", async () => {
  const daemon = startPluginWebSocketServer(0, undefined, {
    helloTimeoutMs: 30,
  });
  const address = await daemon.ready();
  const socket = new WebSocket(`ws://${address.host}:${address.port}`);

  try {
    await waitForOpen(socket);
    const closeCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for hello timeout.")),
        2_000,
      );
      socket.once("close", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
    assert.equal(closeCode, 1008);
  } finally {
    socket.close();
    await daemon.close();
  }
});

test("daemon closes authenticated clients that stop sending activity", async () => {
  const daemon = startPluginWebSocketServer(0, undefined, {
    idleTimeoutMs: 40,
    idleSweepIntervalMs: 5,
  });
  const address = await daemon.ready();
  const socket = await connectRole(
    `ws://${address.host}:${address.port}`,
    "observer",
    "idle-observer-session",
  );

  try {
    const closeCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for idle close.")),
        2_000,
      );
      socket.once("close", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
    assert.equal(closeCode, 1008);
  } finally {
    socket.close();
    await daemon.close();
  }
});

test("stdio adapter heartbeat keeps an otherwise idle connection alive", async () => {
  const daemon = startPluginWebSocketServer(0, undefined, {
    bridgeToken: TEST_BRIDGE_TOKEN,
    idleTimeoutMs: 300,
    idleSweepIntervalMs: 10,
  });
  const address = await daemon.ready();
  const client = new DaemonClient(
    `ws://${address.host}:${address.port}`,
    undefined,
    TEST_BRIDGE_TOKEN,
    20,
  );

  try {
    await client.listTools();
    // Keep the observation window longer than the idle timeout while leaving
    // enough scheduling margin for a busy parallel Node test process.
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(daemon.connectedClients(), 1);
    assert.equal((await client.listTools()).length > 0, true);
  } finally {
    client.close();
    await daemon.close();
  }
});

test("daemon rejects forbidden role commands and closes after repeated violations", async () => {
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const socket = await connectRole(
    `ws://${address.host}:${address.port}`,
    "observer",
    "observer-policy-session",
  );
  const rejectionErrors: string[] = [];

  try {
    socket.on("message", (raw) => {
      const message = parseMessage(raw.toString());
      if (
        typeof message?.requestId === "string" &&
        message.requestId.startsWith("observer-forbidden-") &&
        message.ok === false
      ) {
        rejectionErrors.push(String(message.error));
      }
    });
    const closed = new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for protocol violation close.")),
        2_000,
      );
      socket.once("close", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });

    for (let index = 0; index < 3; index += 1) {
      socket.send(JSON.stringify({
        requestId: `observer-forbidden-${index}`,
        command: WS_COMMANDS.MCP_TOOL_CALL,
        sentAt: new Date().toISOString(),
        payload: {
          call: { toolName: "browser_snapshot", args: {} },
        },
      }));
    }

    assert.equal(await closed, 1008);
    assert.equal(rejectionErrors.length, 3);
    assert.equal(
      rejectionErrors.every((error) =>
        error.includes("ROLE_FORBIDDEN: observer clients cannot send MCP_TOOL_CALL"),
      ),
      true,
    );
  } finally {
    socket.close();
    await daemon.close();
  }
});

test("daemon stores screenshot bytes as artifacts and keeps state metadata-only", async () => {
  const dataDir = await createTestDataDirectory("ai-devtools-daemon-artifacts-");
  const artifactStore = new ArtifactStore({ rootDir: dataDir.artifactDir });
  const stateStore = new DaemonStateStore({
    statePath: dataDir.statePath,
  });
  await stateStore.load();
  const daemon = startPluginWebSocketServer(0, undefined, {
    artifactStore,
    stateStore,
  });
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const sessionId = "artifact-session";
  const ui = await connectRole(url, "ui", sessionId);
  const browser = await connectRole(url, "browser", sessionId);
  const client = new DaemonClient(url, sessionId, TEST_BRIDGE_TOKEN);
  const bytes = Buffer.from("captured-image-bytes", "utf8");
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
  const receivedGrant = deferred<unknown>();

  ui.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (message?.command !== WS_COMMANDS.APPROVAL_REQUEST) {
      return;
    }
    ui.send(JSON.stringify({
      requestId: message.payload.approvalId,
      command: WS_COMMANDS.APPROVAL_RESPONSE,
      sentAt: new Date().toISOString(),
      payload: {
        approvalId: message.payload.approvalId,
        approved: true,
        respondedAt: new Date().toISOString(),
      },
    }));
  });
  browser.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (message?.command !== WS_COMMANDS.BROWSER_TOOL_CALL) {
      return;
    }
    receivedGrant.resolve(message.payload.executionGrant);
    const screenshot = {
      capturedAt: "2026-07-10T00:00:00.000Z",
      mimeType: "image/png",
      dataUrl,
      method: "cdp",
      width: 100,
      height: 50,
    };
    browser.send(JSON.stringify({
      requestId: message.requestId,
      command: WS_COMMANDS.BROWSER_TOOL_RESULT,
      sentAt: new Date().toISOString(),
      payload: {
        ok: true,
        toolName: TOOL_NAMES.BROWSER_TAKE_SCREENSHOT,
        data: screenshot,
      },
    }));
    browser.send(JSON.stringify({
      requestId: `screenshot-state-${Date.now()}`,
      command: WS_COMMANDS.SCREENSHOT_CAPTURED,
      sentAt: new Date().toISOString(),
      payload: { screenshot },
    }));
  });

  try {
    await sendAndWaitForAck(browser, {
      requestId: "artifact-target",
      command: WS_COMMANDS.ACTIVE_TAB_UPDATED,
      sentAt: new Date().toISOString(),
      payload: {
        activeTab: {
          url: "https://example.test/artifact",
          title: "Artifact fixture",
          targetId: "artifact-tab",
          tabId: 18,
          frameId: 0,
          documentId: "artifact-document",
          navigationId: "artifact-navigation",
        },
      },
    });
    const result = await client.callTool(
      MCP_TOOL_NAMES.BROWSER_TAKE_SCREENSHOT,
      {},
    );
    const grant = await receivedGrant.promise;
    assert.equal(isSignedExecutionGrant(grant), true);
    if (!isSignedExecutionGrant(grant)) {
      throw new Error("Daemon did not send a signed execution grant.");
    }
    assert.equal(
      readNestedString(grant, "claims", "sessionId"),
      sessionId,
    );
    assert.equal(
      grant.claims.sourceMcpToolName,
      MCP_TOOL_NAMES.BROWSER_TAKE_SCREENSHOT,
    );
    assert.equal(grant.claims.policyClass, "sensitive_read");
    assert.equal(grant.claims.mutatesBrowser, false);
    assert.equal(
      Boolean(readNestedString(grant, "claims", "approvalId")),
      true,
    );
    assert.deepEqual(
      await verifyExecutionGrant(UNAUTHENTICATED_DEVELOPMENT_GRANT_KEY, grant, {
        browserRequestId: grant.claims.browserRequestId,
        sessionId,
        toolName: TOOL_NAMES.BROWSER_TAKE_SCREENSHOT,
        args: {},
        target: {
          url: "https://example.test/artifact",
          title: "Artifact fixture",
          targetId: "artifact-tab",
          tabId: 18,
          frameId: 0,
          documentId: "artifact-document",
          navigationId: "artifact-navigation",
          revision: grant.claims.target.revision,
        },
      }),
      { ok: true },
    );
    assert.equal(readString(result, "dataUrl"), dataUrl);
    assert.match(readNestedString(result, "artifact", "uri") ?? "", /^ai-devtools:\/\/artifact\//);
    const artifactId = readNestedString(result, "artifact", "id");
    assert.ok(artifactId);
    const artifact = await client.readArtifact(artifactId);
    assert.equal(artifact.ok, true);
    if (artifact.ok) {
      assert.deepEqual(Buffer.from(artifact.dataBase64, "base64"), bytes);
    }

    const otherSessionClient = new DaemonClient(
      url,
      "another-artifact-session",
      TEST_BRIDGE_TOKEN,
    );
    try {
      const crossSessionRead = await otherSessionClient.readArtifact(artifactId);
      assert.equal(crossSessionRead.ok, false);
    } finally {
      otherSessionClient.close();
    }

    await waitUntil(() =>
      Boolean(browserStateHub.snapshot(sessionId).lastScreenshot?.artifact),
    );
    const storedState = browserStateHub.snapshot(sessionId).lastScreenshot;
    assert.equal(storedState?.dataUrl, "data:image/png;base64,");
    assert.match(storedState?.artifact?.uri ?? "", /^ai-devtools:\/\/artifact\//);

    const indexRaw = await readFile(
      join(dataDir.artifactDir, "index.json"),
      "utf8",
    );
    assert.equal(indexRaw.includes(dataUrl), false);
    assert.equal((await artifactStore.list(sessionId)).length, 1);
    const auditEvents = await stateStore.listAuditEvents();
    assert.deepEqual(
      auditEvents.map((event) => event.eventType),
      [
        "approval.requested",
        "approval.approved",
        "tool.completed",
        "tool.completed",
      ],
    );
    assert.equal(
      auditEvents.every((event) => /^[a-f0-9]{64}$/.test(event.argumentsSha256)),
      true,
    );
    const screenshotEgress = auditEvents.find(
      (event) =>
        event.toolName === "browser_take_screenshot" &&
        event.eventType === "tool.completed",
    );
    assert.equal(screenshotEgress?.egressClass, "screenshot");
    assert.equal(screenshotEgress?.egressDestination, "mcp_adapter");
    assert.ok((screenshotEgress?.egressBytes ?? 0) > 0);
    const artifactEgress = auditEvents.find(
      (event) => event.toolName === "artifact.read",
    );
    assert.equal(artifactEgress?.egressClass, "screenshot_artifact");
    assert.equal(artifactEgress?.egressDestination, "mcp_adapter");
    assert.ok((artifactEgress?.egressBytes ?? 0) > bytes.byteLength);
    const stateRaw = await readFile(dataDir.statePath, "utf8");
    assert.equal(stateRaw.includes(dataUrl), false);
  } finally {
    client.close();
    browser.close();
    ui.close();
    await daemon.close();
    await dataDir.cleanup();
  }
});

test("approval-gated audit pages stay bound to one Profile snapshot", async () => {
  const dataDir = await createTestDataDirectory("ai-devtools-audit-pages-");
  browserStateHub.setCurrentTab(
    {
      url: "https://audit.example.test/profile-a",
      title: "Audit profile A",
      targetId: "audit-target-a",
      tabId: 41,
      frameId: 0,
      documentId: "audit-document-a",
      navigationId: "audit-navigation-a",
      revision: 1,
    },
    "audit-profile-a",
  );
  const stateStore = new DaemonStateStore({ statePath: dataDir.statePath });
  await stateStore.load();
  await stateStore.appendAudit({
    id: "profile-a-event-1",
    eventType: "tool.completed",
    timestamp: TEST_PROTOCOL_TIME,
    requestId: "profile-a-request-1",
    sessionId: "audit-profile-a",
    toolName: MCP_TOOL_NAMES.BROWSER_SNAPSHOT,
    policyClass: "safe_read",
    argumentsSha256: "a".repeat(64),
    revision: 1,
    outcome: "completed",
  });
  await stateStore.appendAudit({
    id: "profile-a-event-2",
    eventType: "tool.failed",
    timestamp: TEST_PROTOCOL_TIME,
    requestId: "profile-a-request-2",
    sessionId: "audit-profile-a",
    toolName: MCP_TOOL_NAMES.BROWSER_QUERY_DOM,
    policyClass: "safe_read",
    argumentsSha256: "b".repeat(64),
    revision: 2,
    outcome: "failed",
    errorCode: "FIXTURE_FAILURE",
  });
  await stateStore.appendAudit({
    id: "profile-a-grant-revoked",
    eventType: "grant.revoked",
    timestamp: TEST_PROTOCOL_TIME,
    requestId: "profile-a-request-3",
    sessionId: "audit-profile-a",
    toolName: "task_capability_grant",
    policyClass: "task_grant",
    argumentsSha256: "d".repeat(64),
    revision: 3,
    outcome: "completed",
  });
  await stateStore.appendAudit({
    id: "profile-b-event-1",
    eventType: "tool.completed",
    timestamp: TEST_PROTOCOL_TIME,
    requestId: "profile-b-request-1",
    sessionId: "audit-profile-b",
    toolName: MCP_TOOL_NAMES.BROWSER_SNAPSHOT,
    policyClass: "safe_read",
    argumentsSha256: "c".repeat(64),
    revision: 1,
    outcome: "completed",
  });

  const daemon = startPluginWebSocketServer(0, undefined, { stateStore });
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const ui = await connectRole(url, "ui", "audit-profile-a");
  const client = new DaemonClient(url, "audit-profile-a", TEST_BRIDGE_TOKEN);

  ui.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (message?.command !== WS_COMMANDS.APPROVAL_REQUEST) return;
    ui.send(JSON.stringify({
      requestId: message.payload.approvalId,
      command: WS_COMMANDS.APPROVAL_RESPONSE,
      sentAt: new Date().toISOString(),
      payload: {
        approvalId: message.payload.approvalId,
        approved: true,
        respondedAt: new Date().toISOString(),
      },
    }));
  });

  try {
    const collected: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;
    do {
      const page = await client.callTool(
        MCP_TOOL_NAMES.BROWSER_GET_AUDIT_EVENTS,
        { limit: 1, ...(cursor ? { cursor } : {}) },
      ) as Record<string, unknown>;
      assert.equal(page.sessionId, "audit-profile-a");
      collected.push(...(page.events as Array<Record<string, unknown>>));
      cursor = (page.pagination as { nextCursor?: string }).nextCursor;
    } while (cursor);

    assert.equal(
      collected.some((event) => event.id === "profile-a-event-1"),
      true,
    );
    assert.equal(
      collected.some((event) => event.id === "profile-a-event-2"),
      true,
    );
    assert.equal(
      collected.some((event) => event.id === "profile-a-grant-revoked"),
      true,
    );
    assert.equal(
      collected.some((event) => event.sessionId === "audit-profile-b"),
      false,
    );
    assert.equal(
      collected.every(
        (event) => !("args" in event) && !("result" in event),
      ),
      true,
    );
  } finally {
    client.close();
    ui.close();
    await daemon.close();
    await dataDir.cleanup();
  }
});

test("daemon enforces single-use UI approval before a browser mutation", async () => {
  browserStateHub.setCurrentTab(
    {
      url: "https://example.test/confirm",
      title: "Confirm",
      targetId: "42",
      tabId: 42,
      navigationId: "navigation-1",
    },
    "default",
  );
  const daemon = startPluginWebSocketServer(0, undefined, {
    clock: () => Date.parse(TEST_PROTOCOL_TIME),
    createId: createDeterministicIdFactory("approval-id"),
  });
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const client = new DaemonClient(url, "default", TEST_BRIDGE_TOKEN);
  let ui: WebSocket | undefined;
  let browser: WebSocket | undefined;

  try {
    await assert.rejects(
      client.callTool(MCP_TOOL_NAMES.BROWSER_CLICK, { selector: "#confirm" }),
      /no sidepanel UI is connected/,
    );

    ui = await connectRole(url, "ui");
    let approve = false;
    let enrichApprovalTarget = false;
    let switchUiSelectionWhileApprovalPending = false;
    let makeApprovalStale = false;
    let lastApprovalPayload: Record<string, unknown> | undefined;
    ui.on("message", (raw) => {
      const message = parseMessage(raw.toString());
      if (message?.command !== WS_COMMANDS.APPROVAL_REQUEST) {
        return;
      }
      lastApprovalPayload = message.payload;
      const respond = () => ui?.send(JSON.stringify({
          requestId: message.payload.approvalId,
          command: WS_COMMANDS.APPROVAL_RESPONSE,
          sentAt: new Date().toISOString(),
          payload: {
            approvalId: message.payload.approvalId,
            approved: approve,
            respondedAt: new Date().toISOString(),
          },
        }));
      if (enrichApprovalTarget && browser) {
        void sendAndWaitForAck(browser, {
          requestId: `target-enrichment-${Date.now()}`,
          command: WS_COMMANDS.ACTIVE_TAB_UPDATED,
          sentAt: new Date().toISOString(),
          payload: {
            activeTab: {
              url: "https://example.test/confirm",
              title: "Confirm",
              targetId: "42",
              tabId: 42,
              windowId: 1,
              frameId: 0,
              documentId: "document-1",
              navigationId: "navigation-1",
            },
          },
        }).then(respond);
        return;
      }
      if (makeApprovalStale) {
        browser?.send(JSON.stringify({
          requestId: `navigation-${Date.now()}`,
          command: WS_COMMANDS.ACTIVE_TAB_UPDATED,
          sentAt: new Date().toISOString(),
          payload: {
            activeTab: {
              url: "https://example.test/confirm",
              title: "Confirm",
              targetId: "42",
              tabId: 42,
              navigationId: "navigation-2",
            },
          },
        }));
        setTimeout(respond, 20);
        return;
      }
      if (switchUiSelectionWhileApprovalPending && browser) {
        void sendAndWaitForAck(browser, {
          requestId: `ui-selection-switch-${Date.now()}`,
          command: WS_COMMANDS.ACTIVE_TAB_UPDATED,
          sentAt: new Date().toISOString(),
          payload: {
            activeTab: {
              url: "https://example.test/other-conversation",
              title: "Other conversation",
              targetId: "84",
              tabId: 84,
              windowId: 2,
              frameId: 0,
              documentId: "other-document",
              navigationId: "other-navigation",
            },
          },
        }).then(respond);
        return;
      }
      respond();
    });

    await assert.rejects(
      client.callTool(MCP_TOOL_NAMES.BROWSER_CLICK, { selector: "#confirm" }),
      /APPROVAL_DENIED/,
    );
    assert.equal(
      readNestedString(lastApprovalPayload, "requester", "role"),
      "mcp",
    );
    assert.equal(
      readNestedString(lastApprovalPayload, "preview", "summary"),
      "browser_click (page_action)",
    );
    assert.equal(lastApprovalPayload?.requestedAt, TEST_PROTOCOL_TIME);
    assert.equal(lastApprovalPayload?.expiresAt, undefined);
    assert.match(String(lastApprovalPayload?.approvalId), /^approval-id-\d+$/);
    assert.match(
      readNestedString(lastApprovalPayload, "requester", "connectionId") ?? "",
      /^approval-id-\d+$/,
    );

    browser = await connectRole(url, "browser");
    let browserExecutionCount = 0;
    let lastExecutionGrantTarget: Record<string, unknown> | undefined;
    browser.on("message", (raw) => {
      const message = parseMessage(raw.toString());
      if (message?.command !== WS_COMMANDS.BROWSER_TOOL_CALL) {
        return;
      }
      browserExecutionCount += 1;
      lastExecutionGrantTarget = (
        message.payload.executionGrant as
          | { claims?: { target?: Record<string, unknown> } }
          | undefined
      )?.claims?.target;
      browser?.send(JSON.stringify({
        requestId: message.requestId,
        command: WS_COMMANDS.BROWSER_TOOL_RESULT,
        sentAt: new Date().toISOString(),
        payload: {
          ok: true,
          toolName: TOOL_NAMES.BROWSER_CLICK,
          data: {
            selector: "#confirm",
            matched: true,
            action: "click",
          },
        },
      }));
    });
    await sendAndWaitForAck(browser, {
      requestId: "initial-navigation",
      command: WS_COMMANDS.ACTIVE_TAB_UPDATED,
      sentAt: new Date().toISOString(),
      payload: {
        activeTab: {
          url: "https://example.test/confirm",
          title: "Confirm",
          targetId: "42",
          tabId: 42,
          navigationId: "navigation-1",
        },
      },
    });
    approve = true;

    const result = await client.callTool(MCP_TOOL_NAMES.BROWSER_CLICK, {
      selector: "#confirm",
    });
    assert.deepEqual(result, {
      selector: "#confirm",
      matched: true,
      action: "click",
    });
    assert.equal(browserExecutionCount, 1);

    enrichApprovalTarget = true;
    const enrichedResult = await client.callTool(
      MCP_TOOL_NAMES.BROWSER_CLICK,
      { selector: "#confirm" },
    );
    assert.deepEqual(enrichedResult, {
      selector: "#confirm",
      matched: true,
      action: "click",
    });
    assert.equal(browserExecutionCount, 2);

    enrichApprovalTarget = false;
    switchUiSelectionWhileApprovalPending = true;
    const switchedUiResult = await client.callTool(
      MCP_TOOL_NAMES.BROWSER_CLICK,
      { selector: "#confirm" },
    );
    assert.deepEqual(switchedUiResult, {
      selector: "#confirm",
      matched: true,
      action: "click",
    });
    assert.equal(browserExecutionCount, 3);
    assert.equal(lastExecutionGrantTarget?.tabId, 42);
    assert.equal(lastExecutionGrantTarget?.documentId, "document-1");

    switchUiSelectionWhileApprovalPending = false;
    await sendAndWaitForAck(browser, {
      requestId: "restore-original-selection-before-stale-check",
      command: WS_COMMANDS.ACTIVE_TAB_UPDATED,
      sentAt: new Date().toISOString(),
      payload: {
        activeTab: {
          url: "https://example.test/confirm",
          title: "Confirm",
          targetId: "42",
          tabId: 42,
          windowId: 1,
          frameId: 0,
          documentId: "document-1",
          navigationId: "navigation-1",
        },
      },
    });
    makeApprovalStale = true;
    await assert.rejects(
      client.callTool(MCP_TOOL_NAMES.BROWSER_CLICK, { selector: "#confirm" }),
      /STALE_CONTEXT/,
    );
    assert.equal(browserExecutionCount, 3);
  } finally {
    client.close();
    ui?.close();
    browser?.close();
    await daemon.close();
  }
});

test("daemon keeps approval input pending until an explicit decision", async () => {
  const sessionId = "durable-approval-session";
  browserStateHub.setCurrentTab(
    {
      url: "https://example.test/durable-approval",
      title: "Durable approval",
      targetId: "durable-target",
      tabId: 77,
      windowId: 1,
      navigationId: "durable-navigation",
    },
    sessionId,
  );
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const ui = await connectRole(url, "ui", sessionId);
  const client = new DaemonClient(url, sessionId, TEST_BRIDGE_TOKEN);
  const approvalRequest = deferred<ParsedTestMessage>();

  ui.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (message?.command === WS_COMMANDS.APPROVAL_REQUEST) {
      approvalRequest.resolve(message);
    }
  });

  try {
    const call = client.callTool(MCP_TOOL_NAMES.BROWSER_CLICK, {
      selector: "#confirm",
    });
    const request = await approvalRequest.promise;
    assert.equal(request.payload.expiresAt, undefined);

    const stateAfterDelay = await Promise.race([
      call.then(
        () => "settled",
        () => "settled",
      ),
      new Promise<"pending">((resolve) =>
        setTimeout(() => resolve("pending"), 75),
      ),
    ]);
    assert.equal(stateAfterDelay, "pending");

    ui.send(JSON.stringify({
      requestId: request.payload.approvalId,
      command: WS_COMMANDS.APPROVAL_RESPONSE,
      sentAt: new Date().toISOString(),
      payload: {
        approvalId: request.payload.approvalId,
        approved: false,
        respondedAt: new Date().toISOString(),
      },
    }));
    await assert.rejects(call, /APPROVAL_DENIED/);
  } finally {
    client.close();
    ui.close();
    await daemon.close();
  }
});

test("approval resolution clears sibling sidepanels without crossing Profile sessions", async () => {
  const sessionId = "shared-profile-approval-session";
  const otherSessionId = "other-profile-approval-session";
  browserStateHub.setCurrentTab(
    {
      url: "https://example.test/shared-profile-approval",
      title: "Shared Profile approval",
      targetId: "shared-profile-target",
      tabId: 78,
      windowId: 1,
      navigationId: "shared-profile-navigation",
    },
    sessionId,
  );
  browserStateHub.setCurrentTab(
    {
      url: "https://example.test/other-profile",
      title: "Other Profile",
      targetId: "other-profile-target",
      tabId: 79,
      windowId: 2,
      navigationId: "other-profile-navigation",
    },
    otherSessionId,
  );
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const decidingUi = await connectRole(url, "ui", sessionId);
  const siblingUi = await connectRole(url, "ui", sessionId);
  const otherProfileUi = await connectRole(url, "ui", otherSessionId);
  const client = new DaemonClient(url, sessionId, TEST_BRIDGE_TOKEN);
  const decidingRequest = deferred<ParsedTestMessage>();
  const siblingRequest = deferred<ParsedTestMessage>();
  const siblingCancellation = deferred<ParsedTestMessage>();
  let decidingCancellations = 0;
  let otherProfileApprovalMessages = 0;

  decidingUi.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (message?.command === WS_COMMANDS.APPROVAL_REQUEST) {
      decidingRequest.resolve(message);
    }
    if (message?.command === WS_COMMANDS.APPROVAL_CANCELLED) {
      decidingCancellations += 1;
    }
  });
  siblingUi.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (message?.command === WS_COMMANDS.APPROVAL_REQUEST) {
      siblingRequest.resolve(message);
    }
    if (message?.command === WS_COMMANDS.APPROVAL_CANCELLED) {
      siblingCancellation.resolve(message);
    }
  });
  otherProfileUi.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (
      message?.command === WS_COMMANDS.APPROVAL_REQUEST ||
      message?.command === WS_COMMANDS.APPROVAL_CANCELLED
    ) {
      otherProfileApprovalMessages += 1;
    }
  });

  try {
    const call = client.callTool(MCP_TOOL_NAMES.BROWSER_CLICK, {
      selector: "#confirm",
    });
    const [request, mirroredRequest] = await Promise.all([
      decidingRequest.promise,
      siblingRequest.promise,
    ]);
    assert.equal(
      mirroredRequest.payload.approvalId,
      request.payload.approvalId,
    );

    decidingUi.send(JSON.stringify({
      requestId: request.payload.approvalId,
      command: WS_COMMANDS.APPROVAL_RESPONSE,
      sentAt: new Date().toISOString(),
      payload: {
        approvalId: request.payload.approvalId,
        approved: false,
        respondedAt: new Date().toISOString(),
      },
    }));

    await assert.rejects(call, /APPROVAL_DENIED/);
    const cancellation = await siblingCancellation.promise;
    assert.equal(
      cancellation.payload.approvalId,
      request.payload.approvalId,
    );
    assert.match(String(cancellation.payload.reason), /resolved/i);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(decidingCancellations, 0);
    assert.equal(otherProfileApprovalMessages, 0);
  } finally {
    client.close();
    decidingUi.close();
    siblingUi.close();
    otherProfileUi.close();
    await daemon.close();
  }
});

test("daemon binds approval to the live target published after browser reconnect", async () => {
  const sessionId = "approval-reconnect-target";
  browserStateHub.setCurrentTab(
    {
      url: "https://stale.example/",
      title: "Persisted target",
      targetId: "11",
      tabId: 11,
      windowId: 1,
      navigationId: "stale-navigation",
    },
    sessionId,
  );
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const browser = await connectRole(url, "browser", sessionId);
  const ui = await connectRole(url, "ui", sessionId);
  const client = new DaemonClient(url, sessionId, TEST_BRIDGE_TOKEN);
  const approvalTarget = deferred<Record<string, unknown>>();

  ui.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (message?.command !== WS_COMMANDS.APPROVAL_REQUEST) {
      return;
    }
    approvalTarget.resolve(
      (message.payload.target as Record<string, unknown>) ?? {},
    );
    ui.send(JSON.stringify({
      requestId: message.payload.approvalId,
      command: WS_COMMANDS.APPROVAL_RESPONSE,
      sentAt: new Date().toISOString(),
      payload: {
        approvalId: message.payload.approvalId,
        approved: true,
        respondedAt: new Date().toISOString(),
      },
    }));
  });
  browser.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (message?.command !== WS_COMMANDS.BROWSER_TOOL_CALL) {
      return;
    }
    browser.send(JSON.stringify({
      requestId: message.requestId,
      command: WS_COMMANDS.BROWSER_TOOL_RESULT,
      sentAt: new Date().toISOString(),
      payload: {
        ok: true,
        toolName: TOOL_NAMES.BROWSER_CLICK,
        data: { selector: "#confirm", matched: true, action: "click" },
      },
    }));
  });

  try {
    const resultPromise = client.callTool(MCP_TOOL_NAMES.BROWSER_CLICK, {
      selector: "#confirm",
    });
    setTimeout(() => {
      browser.send(JSON.stringify({
        requestId: "live-target-after-reconnect",
        command: WS_COMMANDS.ACTIVE_TAB_UPDATED,
        sentAt: new Date().toISOString(),
        payload: {
          activeTab: {
            url: "https://live.example/",
            title: "Live target",
            targetId: "22",
            tabId: 22,
            windowId: 2,
            navigationId: "live-navigation",
          },
        },
      }));
    }, 20);

    assert.equal((await approvalTarget.promise).tabId, 22);
    assert.equal(readString(await resultPromise, "action"), "click");
  } finally {
    client.close();
    ui.close();
    browser.close();
    await daemon.close();
  }
});

test("daemon cancels the matching UI approval when its requester aborts", async () => {
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const sessionId = "approval-cancel-session";
  const ui = await connectRole(url, "ui", sessionId);
  const browser = await connectRole(url, "browser", sessionId);
  const client = new DaemonClient(url, sessionId, TEST_BRIDGE_TOKEN);
  const approvalRequested = deferred<string>();
  const approvalCancelled = deferred<ParsedTestMessage>();

  ui.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (message?.command === WS_COMMANDS.APPROVAL_REQUEST) {
      approvalRequested.resolve(message.payload.approvalId);
      return;
    }
    if (message?.command === WS_COMMANDS.APPROVAL_CANCELLED) {
      approvalCancelled.resolve(message);
    }
  });

  try {
    await sendAndWaitForAck(browser, {
      requestId: "approval-cancel-navigation",
      command: WS_COMMANDS.ACTIVE_TAB_UPDATED,
      sentAt: new Date().toISOString(),
      payload: {
        activeTab: {
          url: "https://example.test/cancel-approval",
          title: "Cancel approval",
          targetId: "cancel-tab",
          tabId: 77,
          documentId: "cancel-document",
          navigationId: "cancel-navigation",
        },
      },
    });
    const controller = new AbortController();
    const result = client.callTool(
      MCP_TOOL_NAMES.BROWSER_CLICK,
      { selector: "#cancel" },
      { signal: controller.signal },
    );
    const approvalId = await approvalRequested.promise;
    controller.abort();
    await assert.rejects(result, /cancel/i);
    const cancellation = await approvalCancelled.promise;
    assert.equal(cancellation.payload.approvalId, approvalId);
    assert.match(String(cancellation.payload.reason), /cancelled/i);
  } finally {
    client.close();
    ui.close();
    browser.close();
    await daemon.close();
  }
});

test("daemon rejects invalid MCP arguments before creating an approval", async () => {
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const sessionId = "invalid-args-before-approval";
  const ui = await connectRole(url, "ui", sessionId);
  const client = new DaemonClient(url, sessionId, TEST_BRIDGE_TOKEN);
  let approvalRequests = 0;

  ui.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (message?.command === WS_COMMANDS.APPROVAL_REQUEST) {
      approvalRequests += 1;
    }
  });

  try {
    await assert.rejects(
      client.callTool(MCP_TOOL_NAMES.BROWSER_CLICK, {}),
      /selector or target is required/,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(approvalRequests, 0);
  } finally {
    client.close();
    ui.close();
    await daemon.close();
  }
});

test("session-bound MCP adapters route to the matching Chrome profile", async () => {
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const browserA = await connectRole(url, "browser", "profile-a");
  const browserB = await connectRole(url, "browser", "profile-b");
  const clientA = new DaemonClient(url, "profile-a", TEST_BRIDGE_TOKEN);
  const clientB = new DaemonClient(url, "profile-b", TEST_BRIDGE_TOKEN);
  respondToBrowserCalls(browserA, "profile-a");
  respondToBrowserCalls(browserB, "profile-b");

  try {
    await Promise.all([
      sendAndWaitForAck(browserA, pageContextMessage("profile-a", "https://a.example/")),
      sendAndWaitForAck(browserB, pageContextMessage("profile-b", "https://b.example/")),
    ]);
    assert.equal(
      browserStateHub.snapshot("profile-a").pageContext?.provenance?.target
        .documentId,
      "document-profile-a",
    );
    assert.equal(
      browserStateHub.snapshot("profile-b").pageContext?.provenance?.target
        .documentId,
      "document-profile-b",
    );
    const [resultA, resultB] = await Promise.all([
      clientA.callTool(MCP_TOOL_NAMES.BROWSER_QUERY_DOM, {
        query: "#a",
        queryType: "selector",
      }),
      clientB.callTool(MCP_TOOL_NAMES.BROWSER_QUERY_DOM, {
        query: "#b",
        queryType: "selector",
      }),
    ]);

    assert.equal(readString(resultA, "profile"), "profile-a");
    assert.equal(readString(resultB, "profile"), "profile-b");

    const [digestA, digestB] = await Promise.all([
      clientA.callTool(MCP_TOOL_NAMES.BROWSER_GET_CONTEXT_DIGEST, {}),
      clientB.callTool(MCP_TOOL_NAMES.BROWSER_GET_CONTEXT_DIGEST, {}),
    ]);
    assert.equal(readString(digestA, "sessionId"), "profile-a");
    assert.equal(readString(digestB, "sessionId"), "profile-b");
    assert.equal(JSON.stringify(digestA).includes("https://a.example/"), true);
    assert.equal(JSON.stringify(digestA).includes("https://b.example/"), false);
    assert.equal(JSON.stringify(digestB).includes("https://b.example/"), true);
    assert.equal(JSON.stringify(digestB).includes("https://a.example/"), false);
  } finally {
    clientA.close();
    clientB.close();
    browserA.close();
    browserB.close();
    await daemon.close();
  }
});

test("one MCP adapter can switch Profile routing without affecting another adapter", async () => {
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const browserA = await connectRole(url, "browser", "runtime-profile-a");
  const browserB = await connectRole(url, "browser", "runtime-profile-b");
  const switchingClient = new DaemonClient(url, undefined, TEST_BRIDGE_TOKEN);
  const pinnedClient = new DaemonClient(
    url,
    "runtime-profile-a",
    TEST_BRIDGE_TOKEN,
  );
  const uiClient = await connectRole(url, "ui", "runtime-profile-a");
  respondToBrowserCalls(browserA, "runtime-profile-a");
  respondToBrowserCalls(browserB, "runtime-profile-b");

  try {
    await Promise.all([
      sendAndWaitForAck(
        browserA,
        pageContextMessage("runtime-profile-a", "https://runtime-a.example/"),
      ),
      sendAndWaitForAck(
        browserB,
        pageContextMessage("runtime-profile-b", "https://runtime-b.example/"),
      ),
    ]);

    const advertised = await switchingClient.listTools();
    const listSessionsTool = advertised.find(
      (tool) =>
        isRecord(tool) &&
        tool.name === ADAPTER_ROUTING_TOOL_NAMES.LIST_SESSIONS,
    );
    assert.ok(listSessionsTool && isRecord(listSessionsTool));
    assert.equal(
      isRecord(listSessionsTool.outputSchema) &&
        isRecord(listSessionsTool.outputSchema.properties) &&
        "sessions" in listSessionsTool.outputSchema.properties,
      true,
    );

    const listed = await switchingClient.callTool(
      ADAPTER_ROUTING_TOOL_NAMES.LIST_SESSIONS,
      {},
    );
    assert.equal(readString(listed, "selectionMode"), "active_fallback");
    assert.equal(
      readSessionIds(listed).includes("runtime-profile-a"),
      true,
    );
    assert.equal(
      readSessionIds(listed).includes("runtime-profile-b"),
      true,
    );

    await switchingClient.callTool(ADAPTER_ROUTING_TOOL_NAMES.SET_SESSION, {
      sessionId: "runtime-profile-a",
    });
    const first = await switchingClient.callTool(
      MCP_TOOL_NAMES.BROWSER_QUERY_DOM,
      { query: "#first" },
    );
    assert.equal(readString(first, "profile"), "runtime-profile-a");

    await switchingClient.callTool(ADAPTER_ROUTING_TOOL_NAMES.SET_SESSION, {
      sessionId: "runtime-profile-b",
    });
    const [second, pinned, selectedState] = await Promise.all([
      switchingClient.callTool(MCP_TOOL_NAMES.BROWSER_QUERY_DOM, {
        query: "#second",
      }),
      pinnedClient.callTool(MCP_TOOL_NAMES.BROWSER_QUERY_DOM, {
        query: "#pinned",
      }),
      switchingClient.readState("activeTab"),
    ]);
    assert.equal(readString(second, "profile"), "runtime-profile-b");
    assert.equal(readString(pinned, "profile"), "runtime-profile-a");
    assert.equal(
      readNestedString(selectedState, "value", "url"),
      "https://runtime-b.example/",
    );

    await assert.rejects(
      switchingClient.callTool(ADAPTER_ROUTING_TOOL_NAMES.SET_SESSION, {
        sessionId: "missing-runtime-profile",
      }),
      /Unknown browser session.*browser_list_sessions/,
    );

    const forbiddenResult = waitForCommand(
      uiClient,
      WS_COMMANDS.MCP_TOOL_RESULT,
    );
    uiClient.send(
      JSON.stringify({
        requestId: "ui-session-routing-forbidden",
        command: WS_COMMANDS.MCP_TOOL_CALL,
        sentAt: new Date().toISOString(),
        payload: {
          call: {
            toolName: ADAPTER_ROUTING_TOOL_NAMES.LIST_SESSIONS,
            args: {},
          },
        },
      }),
    );
    assert.match(String((await forbiddenResult).payload.error), /only to MCP adapter/);
  } finally {
    switchingClient.close();
    pinnedClient.close();
    uiClient.close();
    browserA.close();
    browserB.close();
    await daemon.close();
  }
});

test("extension and MCP agents exchange session-scoped collaboration items", async () => {
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const uiA = await connectRole(url, "ui", "collaboration-profile-a");
  const uiB = await connectRole(url, "ui", "collaboration-profile-b");
  const clientA = new DaemonClient(
    url,
    "collaboration-profile-a",
    TEST_BRIDGE_TOKEN,
  );
  let crossProfileBroadcasts = 0;
  uiB.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (
      message?.command === WS_COMMANDS.COLLABORATION_WORKSPACE_UPDATED &&
      JSON.stringify(message.payload).includes("ctx_mcp_finding")
    ) {
      crossProfileBroadcasts += 1;
    }
  });

  try {
    const mcpUpdate = waitForCommand(
      uiA,
      WS_COMMANDS.COLLABORATION_WORKSPACE_UPDATED,
    );
    const published = await clientA.callTool(
      COLLABORATION_TOOL_NAMES.PUBLISH_ITEM,
      {
        id: "ctx_mcp_finding",
        kind: "code.finding",
        title: "Codex source finding",
        summary: "The button width comes from the local component token.",
        content: { file: "src/sidepanel/styles.css", line: 42 },
        sensitivity: "safe",
      },
    );
    assert.equal(readNumber(published, "workspaceRevision"), 1);
    assert.equal(
      readNestedString(published, "item", "id"),
      "ctx_mcp_finding",
    );
    const publishedItem = isRecord(published) && isRecord(published.item)
      ? published.item
      : undefined;
    assert.equal(
      publishedItem && isRecord(publishedItem.source)
        ? publishedItem.source.actor
        : undefined,
      "mcp_agent",
    );
    assert.equal(
      JSON.stringify((await mcpUpdate).payload).includes("ctx_mcp_finding"),
      true,
    );

    await sendAndWaitForAck(uiA, {
      requestId: "extension-collaboration-upsert",
      command: WS_COMMANDS.COLLABORATION_ITEM_UPSERT,
      sentAt: new Date().toISOString(),
      payload: {
        item: {
          id: "ctx_extension_style",
          kind: "page.style",
          title: "Selected element style",
          summary: "Only the computed layout values are shared.",
          content: {
            selector: "#save",
            computedStyle: { display: "flex" },
          },
          sensitivity: "page_content",
        },
      },
    });
    await waitUntil(() =>
      browserStateHub
        .snapshot("collaboration-profile-a")
        .collaborationWorkspace.items.some(
          (item) => item.id === "ctx_extension_style",
        ),
    );
    const workspace = await clientA.readState("collaborationWorkspace");
    assert.equal(JSON.stringify(workspace).includes("ctx_mcp_finding"), true);
    assert.equal(JSON.stringify(workspace).includes("ctx_extension_style"), true);

    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(crossProfileBroadcasts, 0);
  } finally {
    clientA.close();
    uiA.close();
    uiB.close();
    await daemon.close();
  }
});

test("Codex delegation survives the asynchronous extension claim and result wait", async () => {
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const sessionId = "delegation-profile";
  const ui = await connectRole(url, "ui", sessionId);
  const codex = new DaemonClient(url, sessionId, TEST_BRIDGE_TOKEN);

  try {
    const tools = await codex.listTools();
    assert.equal(
      tools.some(
        (tool) =>
          isRecord(tool) &&
          tool.name === COLLABORATION_TOOL_NAMES.DELEGATE_TASK,
      ),
      true,
    );
    assert.equal(
      tools.some(
        (tool) =>
          isRecord(tool) &&
          tool.name === COLLABORATION_TOOL_NAMES.WAIT_FOR_TASK_RESULT,
      ),
      true,
    );

    const update = waitForCommand(
      ui,
      WS_COMMANDS.COLLABORATION_WORKSPACE_UPDATED,
    );
    const delegated = await codex.callTool(
      COLLABORATION_TOOL_NAMES.DELEGATE_TASK,
      {
        taskId: "task_daemonadapter1",
        requestType: "question",
        title: "Explain the current state",
        instruction: "Read the available state and answer with evidence.",
        acceptanceCriteria: ["Return a concise explanation."],
        scope: "session",
        sensitivity: "safe",
      },
    );
    assert.equal(readString(delegated, "state"), "pending");
    assert.equal(
      JSON.stringify((await update).payload).includes("task_daemonadapter1"),
      true,
    );

    const waiting = codex.callTool(
      COLLABORATION_TOOL_NAMES.WAIT_FOR_TASK_RESULT,
      { taskId: "task_daemonadapter1" },
    );
    const claimed = await callUiMcpTool(
      ui,
      "claim-daemon-adapter-task",
      COLLABORATION_TOOL_NAMES.CLAIM_TASK,
      {
        taskId: "task_daemonadapter1",
        resume: false,
        conversationId: "daemon-adapter-chat",
      },
    );
    assert.equal(readBoolean(claimed, "claimed"), true);
    await callUiMcpTool(
      ui,
      "complete-daemon-adapter-task",
      COLLABORATION_TOOL_NAMES.COMPLETE_TASK,
      {
        taskId: "task_daemonadapter1",
        status: "completed",
        summary: "The extension Agent completed the accepted question.",
        output: { answer: "Current state verified." },
        agentSessionId: "agent-daemon-adapter",
        conversationId: "daemon-adapter-chat",
      },
    );

    const result = await waiting;
    assert.equal(readString(result, "status"), "completed");
    assert.equal(
      readNestedString(result, "resultItem", "summary"),
      "The extension Agent completed the accepted question.",
    );
  } finally {
    codex.close();
    ui.close();
    await daemon.close();
  }
});

test("semantic snapshot rejects provenance from a different document", async () => {
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const sessionId = "semantic-provenance-mismatch";
  const browser = await connectRole(url, "browser", sessionId);
  const client = new DaemonClient(url, sessionId, TEST_BRIDGE_TOKEN);

  browser.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (message?.command !== WS_COMMANDS.BROWSER_TOOL_CALL) return;
    browser.send(JSON.stringify({
      requestId: message.requestId,
      command: WS_COMMANDS.BROWSER_TOOL_RESULT,
      sentAt: new Date().toISOString(),
      payload: {
        ok: true,
        toolName: TOOL_NAMES.DOM_GET_PAGE_INFO,
        data: {
          url: "https://example.test/old",
          title: "Old document",
          origin: "https://example.test",
          capturedAt: "2026-07-13T01:00:00.000Z",
          visibleText: "old document",
          domSummary: [],
          nodeCount: 0,
          truncated: false,
          semanticSnapshot: {
            version: "semantic-snapshot-v1",
            fingerprint: "1234abcd",
            nodes: [],
            pagination: {
              offset: 0,
              limit: 10,
              returnedCount: 0,
              collectedCount: 0,
              totalKnown: true,
              hasMore: false,
            },
            stats: { sourceTruncated: false, outputChars: 100 },
          },
          provenance: {
            source: "chrome-content-script",
            observedAt: "2026-07-13T01:00:00.010Z",
            target: {
              url: "https://example.test/old",
              title: "Old document",
              targetId: "tab-44",
              tabId: 44,
              frameId: 0,
              documentId: "document-old",
              navigationId: "navigation-old",
              revision: 0,
            },
          },
        },
      },
    }));
  });

  try {
    await sendAndWaitForAck(browser, {
      requestId: "semantic-current-target",
      command: WS_COMMANDS.ACTIVE_TAB_UPDATED,
      sentAt: new Date().toISOString(),
      payload: {
        activeTab: {
          url: "https://example.test/current",
          title: "Current document",
          targetId: "tab-44",
          tabId: 44,
          frameId: 0,
          documentId: "document-current",
          navigationId: "navigation-current",
          revision: 1,
        },
      },
    });
    await assert.rejects(
      client.callTool(MCP_TOOL_NAMES.BROWSER_SNAPSHOT, { limit: 10 }),
      /STALE_CONTEXT: semantic snapshot provenance does not match/,
    );
  } finally {
    client.close();
    browser.close();
    await daemon.close();
  }
});

test("first semantic snapshot can establish session target from provenance", async () => {
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const sessionId = "semantic-first-provenance";
  const browser = await connectRole(url, "browser", sessionId);
  const client = new DaemonClient(url, sessionId, TEST_BRIDGE_TOKEN);
  const activeTab = {
    url: "https://example.test/first",
    title: "First document",
    targetId: "tab-45",
    tabId: 45,
    frameId: 0,
    documentId: "document-first",
    navigationId: "navigation-first",
    revision: 0,
  };
  const data = semanticSnapshotPageData(activeTab);

  browser.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (message?.command !== WS_COMMANDS.BROWSER_TOOL_CALL) return;
    browser.send(JSON.stringify({
      requestId: "semantic-first-context",
      command: WS_COMMANDS.PAGE_CONTEXT_UPDATED,
      sentAt: new Date().toISOString(),
      payload: { activeTab, pageContext: data },
    }));
    browser.send(JSON.stringify({
      requestId: message.requestId,
      command: WS_COMMANDS.BROWSER_TOOL_RESULT,
      sentAt: new Date().toISOString(),
      payload: {
        ok: true,
        toolName: TOOL_NAMES.DOM_GET_PAGE_INFO,
        data,
      },
    }));
  });

  try {
    const result = await client.callTool(MCP_TOOL_NAMES.BROWSER_SNAPSHOT, {
      limit: 10,
    });
    assert.equal(
      readNestedString(result, "target", "documentId"),
      "document-first",
    );
    assert.equal(
      readNestedNumber(result, "freshness", "navigationRevision"),
      0,
    );
  } finally {
    client.close();
    browser.close();
    await daemon.close();
  }
});

test("authenticated daemon rejects wrong tokens and web-page origins", async () => {
  const daemon = startPluginWebSocketServer(0, undefined, {
    bridgeToken: TEST_BRIDGE_TOKEN,
  });
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const validClient = new DaemonClient(url, "default", TEST_BRIDGE_TOKEN);

  try {
    await expectHelloRejected(url, {
      clientRole: "mcp",
      clientName: "codex-stdio-adapter",
      bridgeToken: "wrong-token-0000000000000000000000000000",
    }, undefined, /AUTH_INVALID/);
    await expectHelloRejected(url, {
      clientRole: "ui",
      clientName: "chrome-devtools-sidepanel",
      installationId: "chrome-web-origin-test",
      sessionId: "chrome-web-origin-test",
      bridgeToken: TEST_BRIDGE_TOKEN,
    }, "https://evil.example", /chrome-extension/);

    await expectHelloRejected(url, {
      clientRole: "ui",
      clientName: "sidepanel-ui",
      installationId: "chrome-role-escalation",
      sessionId: "chrome-role-escalation",
      bridgeToken: TEST_BRIDGE_TOKEN,
    }, TEST_EXTENSION_ORIGIN, /ROLE_FORBIDDEN/);

    const tools = await validClient.listTools();
    assert.equal(tools.length > 0, true);
  } finally {
    validClient.close();
    await daemon.close();
  }
});

test("daemon enforces the configured Chrome extension ID allowlist", async () => {
  const daemon = startPluginWebSocketServer(0, undefined, {
    bridgeToken: TEST_BRIDGE_TOKEN,
    allowedExtensionIds: [TEST_EXTENSION_ID],
  });
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const unpairedOrigin =
    "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  try {
    await expectHelloRejected(url, {
      clientRole: "browser",
      clientName: "chrome-extension-background",
      installationId: "chrome-unpaired-profile",
      sessionId: "chrome-unpaired-profile",
      bridgeToken: TEST_BRIDGE_TOKEN,
    }, unpairedOrigin, /not paired/);

    const paired = await connectRole(url, "browser", "chrome-paired-profile", {
      bridgeToken: TEST_BRIDGE_TOKEN,
      origin: TEST_EXTENSION_ORIGIN,
    });
    paired.close();
  } finally {
    await daemon.close();
  }
});

test("daemon routes a reconnected browser session to its newest socket", async () => {
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const staleBrowser = await connectRole(url, "browser", "socket-bound");
  const staleClosed = new Promise<{ code: number; reason: string }>((resolve) => {
    staleBrowser.once("close", (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
  const currentBrowser = await connectRole(url, "browser", "socket-bound");
  const client = new DaemonClient(url, "socket-bound", TEST_BRIDGE_TOKEN);
  const receivedCall = deferred<ParsedTestMessage>();
  let staleBrowserCalls = 0;

  staleBrowser.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (message?.command === WS_COMMANDS.BROWSER_TOOL_CALL) {
      staleBrowserCalls += 1;
    }
  });
  currentBrowser.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (message?.command === WS_COMMANDS.BROWSER_TOOL_CALL) {
      receivedCall.resolve(message);
    }
  });

  try {
    assert.deepEqual(await staleClosed, {
      code: 1008,
      reason: "SESSION_REPLACED",
    });
    await waitUntil(() => daemon.connectedPluginClients() === 1);
    assert.equal(
      browserStateHub.snapshot("socket-bound").browserConnected,
      true,
    );

    const resultPromise = client.callTool(MCP_TOOL_NAMES.BROWSER_QUERY_DOM, {
      query: "#bound",
      queryType: "selector",
    });
    const call = await receivedCall.promise;
    currentBrowser.send(JSON.stringify({
      requestId: call.requestId,
      command: WS_COMMANDS.BROWSER_TOOL_RESULT,
      sentAt: new Date().toISOString(),
      payload: {
        ok: true,
        toolName: TOOL_NAMES.DOM_QUERY,
        data: { source: "current-socket", elements: [] },
      },
    }));

    assert.equal(readString(await resultPromise, "source"), "current-socket");
    assert.equal(staleBrowserCalls, 0);
  } finally {
    client.close();
    staleBrowser.close();
    currentBrowser.close();
    await daemon.close();
  }
});

test("adapter cancellation propagates to the selected browser request", async () => {
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const browser = await connectRole(url, "browser", "cancel-session");
  const client = new DaemonClient(url, "cancel-session", TEST_BRIDGE_TOKEN);
  const browserCancelled = deferred<void>();
  let browserRequestId: string | undefined;

  browser.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (message?.command === WS_COMMANDS.BROWSER_TOOL_CALL) {
      browserRequestId = String(message.requestId);
      return;
    }
    if (
      message?.command === WS_COMMANDS.REQUEST_CANCEL &&
      message.payload.targetRequestId === browserRequestId
    ) {
      browserCancelled.resolve();
    }
  });

  try {
    const controller = new AbortController();
    const result = client.callTool(
      MCP_TOOL_NAMES.BROWSER_WAIT_FOR,
      { time: 60 },
      {
        signal: controller.signal,
        idempotencyKey: "cancel-wait",
      },
    );
    await waitUntil(() => Boolean(browserRequestId));
    controller.abort();

    await assert.rejects(result, /REQUEST_CANCELLED/);
    await browserCancelled.promise;
  } finally {
    client.close();
    browser.close();
    await daemon.close();
  }
});

test("daemon idempotency prevents duplicate browser execution", async () => {
  const daemon = startPluginWebSocketServer(0);
  const address = await daemon.ready();
  const url = `ws://${address.host}:${address.port}`;
  const browser = await connectRole(url, "browser", "idempotent-session");
  const client = new DaemonClient(url, "idempotent-session", TEST_BRIDGE_TOKEN);
  const secondClient = new DaemonClient(
    url,
    "idempotent-session",
    TEST_BRIDGE_TOKEN,
  );
  let executions = 0;
  browser.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (message?.command !== WS_COMMANDS.BROWSER_TOOL_CALL) {
      return;
    }
    executions += 1;
    browser.send(JSON.stringify({
      requestId: message.requestId,
      command: WS_COMMANDS.BROWSER_TOOL_RESULT,
      sentAt: new Date().toISOString(),
      payload: {
        ok: true,
        toolName: TOOL_NAMES.DOM_QUERY,
        data: { executions, elements: [] },
      },
    }));
  });

  try {
    const options = { idempotencyKey: "query-once" };
    const first = await client.callTool(
      MCP_TOOL_NAMES.BROWSER_QUERY_DOM,
      { query: "#same", queryType: "selector" },
      options,
    );
    const retry = await client.callTool(
      MCP_TOOL_NAMES.BROWSER_QUERY_DOM,
      { query: "#same", queryType: "selector" },
      options,
    );

    assert.equal(readNumber(first, "executions"), 1);
    assert.equal(readNumber(retry, "executions"), 1);
    assert.equal(executions, 1);

    const independentTask = await secondClient.callTool(
      MCP_TOOL_NAMES.BROWSER_QUERY_DOM,
      { query: "#same", queryType: "selector" },
      options,
    );
    assert.equal(readNumber(independentTask, "executions"), 2);
    assert.equal(executions, 2);

    await assert.rejects(
      client.callTool(
        MCP_TOOL_NAMES.BROWSER_QUERY_DOM,
        { query: "#different", queryType: "selector" },
        options,
      ),
      /IDEMPOTENCY_CONFLICT/,
    );
  } finally {
    client.close();
    secondClient.close();
    browser.close();
    await daemon.close();
  }
});

function readNestedString(
  value: unknown,
  parentKey: string,
  childKey: string,
): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const parent = (value as Record<string, unknown>)[parentKey];
  if (!parent || typeof parent !== "object") {
    return undefined;
  }
  const child = (parent as Record<string, unknown>)[childKey];
  return typeof child === "string" ? child : undefined;
}

function readNestedNumber(
  value: unknown,
  parentKey: string,
  childKey: string,
): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const parent = (value as Record<string, unknown>)[parentKey];
  if (!parent || typeof parent !== "object") return undefined;
  const child = (parent as Record<string, unknown>)[childKey];
  return typeof child === "number" ? child : undefined;
}

async function connectRole(
  url: string,
  clientRole: WsClientRole,
  sessionId = "default",
  options: { bridgeToken?: string; origin?: string } = {},
): Promise<WebSocket> {
  const origin =
    options.origin ??
    (clientRole === "mcp" ? undefined : TEST_EXTENSION_ORIGIN);
  const socket = new WebSocket(url, origin ? { origin } : undefined);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  const requestId = `hello-${clientRole}-${sessionId}`;
  const acknowledged = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out registering ${clientRole}.`)),
      2_000,
    );
    const onMessage = (raw: WebSocket.RawData) => {
      const message = parseMessage(raw.toString());
      if (message?.requestId !== requestId || message.ok !== true) {
        return;
      }
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve();
    };
    socket.on("message", onMessage);
  });

  socket.send(JSON.stringify(clientHelloMessage(clientRole, sessionId, {
    requestId,
    bridgeToken: options.bridgeToken,
  })));
  await acknowledged;
  return socket;
}

function respondToBrowserCalls(socket: WebSocket, profile: string): void {
  socket.on("message", (raw) => {
    const message = parseMessage(raw.toString());
    if (message?.command !== WS_COMMANDS.BROWSER_TOOL_CALL) {
      return;
    }
    socket.send(JSON.stringify({
      requestId: message.requestId,
      command: WS_COMMANDS.BROWSER_TOOL_RESULT,
      sentAt: new Date().toISOString(),
      payload: {
        ok: true,
        toolName: message.payload.call.toolName,
        data: {
          profile,
          query: message.payload.call.args.query,
          elements: [],
        },
      },
    }));
  });
}

function pageContextMessage(sessionId: string, url: string): Record<string, unknown> {
  return {
    requestId: `page-context-${sessionId}-${Date.now()}-${Math.random()}`,
    command: WS_COMMANDS.PAGE_CONTEXT_UPDATED,
    sentAt: new Date().toISOString(),
    payload: {
      activeTab: {
        url,
        title: sessionId,
        tabId: sessionId === "profile-a" ? 101 : 202,
        frameId: 0,
        documentId: `document-${sessionId}`,
      },
      pageContext: {
        url,
        title: sessionId,
        origin: new URL(url).origin,
        capturedAt: new Date().toISOString(),
        visibleText: `Visible text for ${sessionId}`,
        domSummary: [],
        nodeCount: 0,
        truncated: false,
        provenance: {
          source: "chrome-content-script",
          observedAt: new Date().toISOString(),
          target: {
            url,
            title: sessionId,
            targetId: `target-${sessionId}`,
            tabId: sessionId === "profile-a" ? 101 : 202,
            frameId: 0,
            documentId: `document-${sessionId}`,
            navigationId: `navigation-${sessionId}`,
            revision: 0,
          },
        },
      },
    },
  };
}

function semanticSnapshotPageData(
  target: Record<string, unknown>,
): Record<string, unknown> {
  return {
    url: target.url,
    title: target.title,
    origin: new URL(String(target.url)).origin,
    capturedAt: "2026-07-13T01:00:00.000Z",
    visibleText: "first document",
    domSummary: [],
    nodeCount: 0,
    truncated: false,
    semanticSnapshot: {
      version: "semantic-snapshot-v1",
      fingerprint: "1234abcd",
      nodes: [],
      pagination: {
        offset: 0,
        limit: 10,
        returnedCount: 0,
        collectedCount: 0,
        totalKnown: true,
        hasMore: false,
      },
      stats: { sourceTruncated: false, outputChars: 100 },
    },
    provenance: {
      source: "chrome-content-script",
      observedAt: "2026-07-13T01:00:00.010Z",
      target,
    },
  };
}

function readString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "string" ? entry : undefined;
}

function readSessionIds(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.sessions)) {
    return [];
  }
  return value.sessions
    .filter(isRecord)
    .map((session) => session.sessionId)
    .filter((sessionId): sessionId is string => typeof sessionId === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "number" ? entry : undefined;
}

function readBoolean(value: unknown, key: string): boolean | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "boolean" ? entry : undefined;
}

function parseMessage(raw: string): ParsedTestMessage | null {
  try {
    return JSON.parse(raw) as ParsedTestMessage;
  } catch {
    return null;
  }
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
}

function waitForCommand(
  socket: WebSocket,
  command: string,
): Promise<ParsedTestMessage> {
  return new Promise<ParsedTestMessage>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${command}.`)),
      2_000,
    );
    const onMessage = (raw: WebSocket.RawData) => {
      const message = parseMessage(raw.toString());
      if (message?.command !== command) {
        return;
      }
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

function callUiMcpTool(
  socket: WebSocket,
  requestId: string,
  toolName: string,
  args: Record<string, unknown>,
  taskContext?: {
    taskId: string;
    conversationId: string;
    target: { tabId: number; targetId?: string };
    egressDestinations: string[];
  },
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${toolName}.`)),
      2_000,
    );
    const onMessage = (raw: WebSocket.RawData) => {
      const message = parseMessage(raw.toString());
      if (
        message?.requestId !== requestId ||
        message.command !== WS_COMMANDS.MCP_TOOL_RESULT
      ) {
        return;
      }
      clearTimeout(timeout);
      socket.off("message", onMessage);
      if (message.payload.ok !== true) {
        reject(new Error(String(message.payload.error ?? "MCP tool failed.")));
        return;
      }
      resolve(message.payload.data);
    };
    socket.on("message", onMessage);
    socket.send(
      JSON.stringify({
        requestId,
        command: WS_COMMANDS.MCP_TOOL_CALL,
        sentAt: new Date().toISOString(),
        payload: {
          call: { toolName, args },
          ...(taskContext ? { taskContext } : {}),
        },
      }),
    );
  });
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 2_000) {
      throw new Error("Timed out waiting for test condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function expectHelloRejected(
  url: string,
  payload: Record<string, unknown>,
  origin: string | undefined,
  expectedError: RegExp,
): Promise<void> {
  const socket = new WebSocket(url, origin ? { origin } : undefined);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const requestId = `rejected-${Date.now()}-${Math.random()}`;
  const response = new Promise<ParsedTestMessage>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for authentication rejection.")),
      2_000,
    );
    socket.on("message", (raw) => {
      const message = parseMessage(raw.toString());
      if (message?.requestId !== requestId) {
        return;
      }
      clearTimeout(timeout);
      resolve(message);
    });
  });
  socket.send(JSON.stringify({
    requestId,
    command: WS_COMMANDS.CLIENT_HELLO,
    sentAt: new Date().toISOString(),
    payload: {
      protocolVersion: WS_PROTOCOL_VERSION,
      buildId: RUNTIME_BUILD_ID,
      schemaHash: RUNTIME_SCHEMA_HASH,
      ...payload,
    },
  }));
  const ack = await response;
  assert.equal(ack.ok, false);
  assert.match(String(ack.error), expectedError);
  socket.close();
}

async function sendAndWaitForAck(
  socket: WebSocket,
  message: Record<string, unknown>,
): Promise<void> {
  const requestId = String(message.requestId);
  const acknowledged = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ACK: ${requestId}`)),
      2_000,
    );
    const onMessage = (raw: WebSocket.RawData) => {
      const response = parseMessage(raw.toString());
      if (response?.requestId !== requestId || response.ok !== true) {
        return;
      }
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve();
    };
    socket.on("message", onMessage);
  });
  socket.send(JSON.stringify(message));
  await acknowledged;
}

async function sendAndWaitForRejectedAck(
  socket: WebSocket,
  message: Record<string, unknown>,
): Promise<string> {
  const requestId = String(message.requestId);
  const rejected = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for rejected ACK: ${requestId}`)),
      2_000,
    );
    const onMessage = (raw: WebSocket.RawData) => {
      const response = parseMessage(raw.toString());
      if (response?.requestId !== requestId || response.ok !== false) {
        return;
      }
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(String(response.error ?? ""));
    };
    socket.on("message", onMessage);
  });
  socket.send(JSON.stringify(message));
  return rejected;
}

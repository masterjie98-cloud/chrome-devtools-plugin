import assert from "node:assert/strict";
import test from "node:test";
import { pluginToMcpMessageSchema } from "../src/mcp/wsSchemas";
import { toDaemonAgentMessages } from "../src/shared/daemonAgent";
import { parseFailedProtocolAck } from "../src/shared/runtimeIdentity";
import { WS_COMMANDS } from "../src/shared/wsProtocol";

test("daemon Agent message projection removes UI-only tool metadata", () => {
  const uiToolMessage = {
    id: "tool-message-1",
    role: "tool" as const,
    content: "result",
    createdAt: "2026-08-05T00:00:00.000Z",
    toolName: "prometheus_query",
    toolSource: "external_mcp",
    toolDisplayName: "prometheus_query",
    toolServerName: "Prometheus Infra MCP",
    toolRequestArguments: "{}",
    toolResultMeta: {
      originalCharCount: 386_700,
      displayedSourceCharCount: 255_900,
      truncated: true,
    },
  };
  const messages = toDaemonAgentMessages([uiToolMessage]);

  assert.deepEqual(messages, [
    {
      id: "tool-message-1",
      role: "tool",
      content: "result",
      createdAt: "2026-08-05T00:00:00.000Z",
      toolName: "prometheus_query",
    },
  ]);

  const parsed = pluginToMcpMessageSchema.safeParse({
    requestId: "start-after-mcp",
    command: WS_COMMANDS.DAEMON_AGENT_START,
    sentAt: "2026-08-05T00:00:00.000Z",
    payload: {
      runId: "run-after-mcp",
      conversationId: "conversation-a",
      assistantMessageId: "assistant-a",
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
      messages,
      input: "continue",
      attachments: [],
      context: {},
      egressDestinations: ["https://provider.example"],
    },
  });
  assert.equal(parsed.success, true);
});

test("failed protocol acknowledgements retain request identity and real error", () => {
  assert.deepEqual(
    parseFailedProtocolAck(
      JSON.stringify({
        requestId: "start-after-mcp",
        ok: false,
        receivedAt: "2026-08-05T00:00:00.000Z",
        error: "SCHEMA_INVALID: payload.messages.2 has unrecognized keys.",
      }),
    ),
    {
      requestId: "start-after-mcp",
      error: "SCHEMA_INVALID: payload.messages.2 has unrecognized keys.",
    },
  );
});

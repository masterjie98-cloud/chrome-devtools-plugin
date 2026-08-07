import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ExternalMcpRegistry,
  isRecoverableExternalMcpToolFailure,
} from "../src/daemon/externalMcpRegistry";
import { toAiToolDefinitions } from "../src/sidepanel/services/aiClient";
import {
  createExternalMcpToolName,
  externalMcpToolAllowed,
  normalizeExternalMcpSelection,
  parseExternalMcpImport,
} from "../src/shared/externalMcp";
import { createTestDataDirectory } from "./helpers/tempDataDir";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("common MCP JSON import is normalized, disabled, and transport-safe", () => {
  const imported = parseExternalMcpImport(
    JSON.stringify({
      mcpServers: {
        local: {
          command: "node",
          args: ["server.mjs"],
          env: { TOKEN: "secret" },
        },
        remote: {
          type: "streamable-http",
          url: "https://mcp.example.test/mcp",
          headers: { Authorization: "Bearer secret" },
        },
      },
    }),
    (name) => `mcp_${name}`,
  );
  assert.equal(imported.length, 2);
  assert.equal(imported.every((server) => server.enabled === false), true);
  assert.equal(imported[0]?.transport.type, "stdio");
  assert.equal(imported[1]?.transport.type, "streamable-http");

  assert.throws(
    () =>
      parseExternalMcpImport(
        { mcpServers: { insecure: { url: "http://remote.example/mcp" } } },
        () => "mcp_insecure",
      ),
    /HTTPS/,
  );
  assert.throws(
    () =>
      parseExternalMcpImport(
        { mcpServers: { legacy: { type: "sse", url: "https://example.test/sse" } } },
        () => "mcp_legacy",
      ),
    /SSE/,
  );
});

test("remote host-style Streamable HTTP config aliases are imported safely", () => {
  const imported = parseExternalMcpImport(
    {
      mcpServers: {
        "prometheus-infra-mcp": {
          name: "Prometheus Infra MCP",
          type: "streamableHttp",
          description: "只读查询已登记的 Prometheus 数据源。",
          isActive: true,
          baseUrl: "https://prometheus-mcp-dev.insightst.com/mcp",
          headers: {},
          timeout: 60_000,
          disabledTools: ["dangerous_write", "dangerous_write"],
        },
      },
    },
    () => "mcp_prometheus",
  );

  assert.deepEqual(imported, [
    {
      id: "mcp_prometheus",
      name: "Prometheus Infra MCP",
      enabled: false,
      description: "只读查询已登记的 Prometheus 数据源。",
      timeoutMs: 60_000,
      disabledTools: ["dangerous_write"],
      importRequestedEnabled: true,
      transport: {
        type: "streamable-http",
        url: "https://prometheus-mcp-dev.insightst.com/mcp",
        headers: {},
      },
    },
  ]);
});

test("external MCP tool namespaces are stable, valid, and collision-resistant", () => {
  const first = createExternalMcpToolName("server_a", "read-file");
  const repeated = createExternalMcpToolName("server_a", "read-file");
  const other = createExternalMcpToolName("server_b", "read-file");
  assert.equal(first, repeated);
  assert.notEqual(first, other);
  assert.match(first, /^[A-Za-z0-9_-]+$/);
  assert.equal(first.length <= 64, true);
  assert.deepEqual(normalizeExternalMcpSelection({ mode: "selected", serverIds: [] }), {
    mode: "off",
    serverIds: [],
  });
  assert.equal(
    externalMcpToolAllowed(first, "server_a", { mode: "off", serverIds: [] }),
    false,
  );
  assert.equal(
    externalMcpToolAllowed(first, "server_a", {
      mode: "selected",
      serverIds: ["server_a"],
    }),
    true,
  );
  assert.equal(
    externalMcpToolAllowed("browser_observe", undefined, {
      mode: "off",
      serverIds: [],
    }),
    true,
  );
});

test("daemon registry launches an enabled stdio MCP and routes its tool", async () => {
  const fixture = join(projectRoot, "tests", "fixtures", "externalMcpEchoServer.mjs");
  const saved: unknown[] = [];
  const registry = new ExternalMcpRegistry(
    [
      {
        id: "mcp_echo_fixture",
        name: "Echo fixture",
        enabled: true,
        transport: {
          type: "stdio",
          command: process.execPath,
          args: [fixture],
        },
      },
    ],
    {
      saveServers: async (servers) => {
        saved.push(servers);
      },
    },
  );
  try {
    const tools = await registry.listTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.externalMcpServerId, "mcp_echo_fixture");
    assert.deepEqual(registry.getToolOrigin(tools[0]!.name), {
      externalMcpServerId: "mcp_echo_fixture",
      externalMcpServerName: "Echo fixture",
      externalMcpToolName: "echo",
    });
    assert.deepEqual(tools[0]?.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    assert.equal(registry.getToolPolicy(tools[0]!.name), undefined);
    assert.match(tools[0]?.name ?? "", /^extmcp__/);
    const result = (await registry.callTool(tools[0]!.name, {
      text: "hello from registry",
    })) as { content?: Array<{ type?: string; text?: string }> };
    assert.equal(result.content?.[0]?.text, "hello from registry");
    const summary = registry.listServers()[0];
    assert.equal(summary?.status, "connected");
    assert.equal(summary?.toolCount, 1);
    assert.equal(summary?.resourceCount, 0);
    assert.equal(summary?.promptCount, 0);
    assert.equal(summary?.tools[0]?.name, "echo");
    assert.equal(summary?.tools[0]?.approval, "inherit");
    assert.equal(saved.length, 0);
  } finally {
    await registry.close();
  }
});

test("external MCP tools can be disabled and assigned an explicit approval policy", async () => {
  const fixture = join(projectRoot, "tests", "fixtures", "externalMcpEchoServer.mjs");
  const registry = new ExternalMcpRegistry(
    [
      {
        id: "mcp_tool_policy_fixture",
        name: "Tool policy fixture",
        enabled: true,
        transport: { type: "stdio", command: process.execPath, args: [fixture] },
      },
    ],
    { saveServers: async () => undefined },
  );
  try {
    const [publicTool] = await registry.listTools();
    assert.ok(publicTool);
    await registry.setToolPolicy("mcp_tool_policy_fixture", "echo", {
      approval: "auto",
    });
    assert.equal(registry.getToolPolicy(publicTool.name)?.approvalMode, "none");
    assert.equal(registry.listServers()[0]?.tools[0]?.approval, "auto");

    await registry.setToolPolicy("mcp_tool_policy_fixture", "echo", {
      enabled: false,
    });
    assert.deepEqual(await registry.listTools(), []);
    assert.equal(registry.listServers()[0]?.tools[0]?.enabled, false);

    await registry.setToolPolicy("mcp_tool_policy_fixture", "echo", {
      enabled: true,
      approval: "ask",
    });
    const [restoredTool] = await registry.listTools();
    assert.ok(restoredTool);
    assert.equal(registry.getToolPolicy(restoredTool.name), undefined);
    assert.equal(registry.listServers()[0]?.tools[0]?.approval, "ask");
  } finally {
    await registry.close();
  }
});

test("explicit server trust makes only declared read-only MCP tools approval-free", async () => {
  const fixture = join(projectRoot, "tests", "fixtures", "externalMcpEchoServer.mjs");
  const saved: unknown[] = [];
  const registry = new ExternalMcpRegistry(
    [
      {
        id: "mcp_trusted_fixture",
        name: "Trusted fixture",
        enabled: true,
        transport: {
          type: "stdio",
          command: process.execPath,
          args: [fixture],
        },
      },
    ],
    {
      saveServers: async (servers) => {
        saved.push(servers);
      },
    },
  );
  try {
    const [tool] = await registry.listTools();
    assert.ok(tool);
    assert.equal(registry.getToolPolicy(tool.name), undefined);

    await registry.setServerReadOnlyTrust("mcp_trusted_fixture", true);
    const policy = registry.getToolPolicy(tool.name);
    assert.equal(policy?.approvalMode, "none");
    assert.equal(policy?.mutatesBrowser, false);
    assert.equal(policy?.sensitive, true);
    assert.equal(registry.listServers()[0]?.trustReadOnlyTools, true);
    assert.equal(saved.length, 1);

    await registry.setServerReadOnlyTrust("mcp_trusted_fixture", false);
    assert.equal(registry.getToolPolicy(tool.name), undefined);
    assert.equal(registry.listServers()[0]?.trustReadOnlyTools, false);
  } finally {
    await registry.close();
  }
});

test("per-server auto-run is persisted, isolated, and immediately revocable", async () => {
  const fixture = join(projectRoot, "tests", "fixtures", "externalMcpEchoServer.mjs");
  const saved: unknown[] = [];
  const registry = new ExternalMcpRegistry(
    [
      {
        id: "mcp_auto_fixture",
        name: "Auto fixture",
        enabled: true,
        transport: {
          type: "stdio",
          command: process.execPath,
          args: [fixture],
        },
      },
      {
        id: "mcp_manual_fixture",
        name: "Manual fixture",
        enabled: true,
        transport: {
          type: "stdio",
          command: process.execPath,
          args: [fixture],
        },
      },
    ],
    {
      saveServers: async (servers) => {
        saved.push(structuredClone(servers));
      },
    },
  );
  try {
    const tools = await registry.listTools();
    const autoTool = tools.find(
      (tool) => tool.externalMcpServerId === "mcp_auto_fixture",
    );
    const manualTool = tools.find(
      (tool) => tool.externalMcpServerId === "mcp_manual_fixture",
    );
    assert.ok(autoTool);
    assert.ok(manualTool);
    assert.equal(registry.getToolPolicy(autoTool.name), undefined);
    assert.equal(registry.getToolPolicy(manualTool.name), undefined);

    await registry.setServerAutoApprove("mcp_auto_fixture", true);
    assert.equal(registry.getToolPolicy(autoTool.name)?.approvalMode, "none");
    assert.equal(registry.getToolPolicy(manualTool.name), undefined);
    assert.equal(registry.listServers()[0]?.autoApproveTools, true);
    assert.equal(registry.listServers()[1]?.autoApproveTools, false);
    assert.equal(saved.length, 1);

    await registry.setServerAutoApprove("mcp_auto_fixture", false);
    assert.equal(registry.getToolPolicy(autoTool.name), undefined);
    assert.equal(registry.listServers()[0]?.autoApproveTools, false);
    assert.equal(saved.length, 2);
  } finally {
    await registry.close();
  }
});

test("daemon registry never exposes tools disabled by server config", async () => {
  const fixture = join(projectRoot, "tests", "fixtures", "externalMcpEchoServer.mjs");
  const registry = new ExternalMcpRegistry(
    [
      {
        id: "mcp_filtered_fixture",
        name: "Filtered fixture",
        enabled: true,
        disabledTools: ["echo"],
        transport: {
          type: "stdio",
          command: process.execPath,
          args: [fixture],
        },
      },
    ],
    { saveServers: async () => undefined },
  );
  try {
    assert.deepEqual(await registry.listTools(), []);
    assert.equal(registry.listServers()[0]?.status, "connected");
  } finally {
    await registry.close();
  }
});

test("server instructions are preserved once as untrusted model guidance", async () => {
  const fixture = join(projectRoot, "tests", "fixtures", "externalMcpEchoServer.mjs");
  const registry = new ExternalMcpRegistry(
    [
      {
        id: "mcp_instructions_fixture",
        name: "Instructions fixture",
        enabled: true,
        transport: {
          type: "stdio",
          command: process.execPath,
          args: [fixture],
          env: {
            MCP_FIXTURE_MODE: "structured",
            MCP_FIXTURE_INSTRUCTIONS:
              "Respect quality_status and never treat a failed query as zero.",
          },
        },
      },
    ],
    { saveServers: async () => undefined },
  );
  try {
    const tools = await registry.listTools();
    assert.equal(tools.length, 2);
    assert.equal(
      tools.every((tool) => Boolean(tool.externalMcpToolName)),
      true,
    );
    assert.equal(
      tools.every(
        (tool) =>
          tool.externalMcpServerInstructions ===
          "Respect quality_status and never treat a failed query as zero.",
      ),
      true,
    );
    const definitions = toAiToolDefinitions(tools);
    assert.equal(
      definitions.every(
        (definition) =>
          definition.clientMetadata?.source === "external_mcp" &&
          definition.clientMetadata.externalMcpServerName ===
            "Instructions fixture" &&
          Boolean(definition.clientMetadata.externalMcpToolName) &&
          definition.clientMetadata.annotations?.readOnlyHint === true,
      ),
      true,
    );
    const guidanceCount = definitions.filter((definition) =>
      definition.function.description?.includes("MCP server usage guidance"),
    ).length;
    assert.equal(guidanceCount, 1);
    assert.match(
      definitions.map((definition) => definition.function.description).join("\n"),
      /never treat a failed query as zero/,
    );
  } finally {
    await registry.close();
  }
});

test("duplicate text JSON is removed when structuredContent carries the same result", async () => {
  const fixture = join(projectRoot, "tests", "fixtures", "externalMcpEchoServer.mjs");
  const registry = new ExternalMcpRegistry(
    [
      {
        id: "mcp_structured_fixture",
        name: "Structured fixture",
        enabled: true,
        transport: {
          type: "stdio",
          command: process.execPath,
          args: [fixture],
          env: { MCP_FIXTURE_MODE: "structured" },
        },
      },
    ],
    { saveServers: async () => undefined },
  );
  try {
    const tools = await registry.listTools();
    const structuredTool = tools.find((tool) => tool.title === "structured_echo");
    assert.ok(structuredTool);
    const result = (await registry.callTool(structuredTool.name, {
      text: "structured result",
    })) as {
      content?: unknown[];
      structuredContent?: { text?: string; length?: number };
    };
    assert.deepEqual(result.content, []);
    assert.deepEqual(result.structuredContent, {
      text: "structured result",
      length: 17,
    });
  } finally {
    await registry.close();
  }
});

test("external MCP results larger than 1 MiB remain successful and complete", async () => {
  const fixture = join(projectRoot, "tests", "fixtures", "externalMcpEchoServer.mjs");
  const registry = new ExternalMcpRegistry(
    [
      {
        id: "mcp_large_fixture",
        name: "Large result fixture",
        enabled: true,
        transport: {
          type: "stdio",
          command: process.execPath,
          args: [fixture],
          env: { MCP_FIXTURE_MODE: "large" },
        },
      },
    ],
    { saveServers: async () => undefined },
  );
  try {
    const tools = await registry.listTools();
    const largeTool = tools.find((tool) => tool.title === "large_result");
    assert.ok(largeTool);
    const result = (await registry.callTool(largeTool.name, {
      size: 1_200_000,
    })) as {
      isError?: boolean;
      content?: Array<{ type?: string; text?: string }>;
    };

    assert.notEqual(result.isError, true);
    assert.equal(result.content?.[0]?.text?.length, 1_200_000);
    assert.match(result.content?.[0]?.text ?? "", /CRITICAL_TAIL_EVIDENCE$/);
  } finally {
    await registry.close();
  }
});

test("read-only idempotent transport failure reconnects within a bounded retry budget", async () => {
  const fixture = join(projectRoot, "tests", "fixtures", "externalMcpEchoServer.mjs");
  const dataDir = await createTestDataDirectory("external-mcp-retry-");
  const marker = join(dataDir.rootDir, "failed-once.marker");
  const registry = new ExternalMcpRegistry(
    [
      {
        id: "mcp_retry_fixture",
        name: "Retry fixture",
        enabled: true,
        trustReadOnlyTools: true,
        transport: {
          type: "stdio",
          command: process.execPath,
          args: [fixture],
          env: {
            MCP_FIXTURE_MODE: "retry",
            MCP_FIXTURE_RETRY_MARKER: marker,
          },
        },
      },
    ],
    { saveServers: async () => undefined },
  );
  try {
    const tools = await registry.listTools();
    const flakyTool = tools.find((tool) => tool.title === "flaky_read");
    assert.ok(flakyTool);
    const result = (await registry.callTool(flakyTool.name, {})) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    assert.equal(result.content?.[0]?.text, "recovered after reconnect");
  } finally {
    await registry.close();
    await dataDir.cleanup();
  }
});

test("HTTP 5xx is classified for transport recovery without retrying client errors", () => {
  const gatewayError = Object.assign(
    new Error("Streamable HTTP error: Error POSTing to endpoint: Bad Gateway"),
    { code: 502 },
  );
  const clientError = Object.assign(new Error("Bad Request"), { code: 400 });

  assert.equal(isRecoverableExternalMcpToolFailure(gatewayError), true);
  assert.equal(isRecoverableExternalMcpToolFailure(clientError), false);
  assert.equal(
    isRecoverableExternalMcpToolFailure(new Error("Connection closed")),
    true,
  );
});

test("trusted read-only non-idempotent transport failure reconnects before bounded replay", async () => {
  const fixture = join(projectRoot, "tests", "fixtures", "externalMcpEchoServer.mjs");
  const dataDir = await createTestDataDirectory("external-mcp-read-retry-");
  const marker = join(dataDir.rootDir, "failed-once.marker");
  const registry = new ExternalMcpRegistry(
    [
      {
        id: "mcp_read_retry_fixture",
        name: "Read retry fixture",
        enabled: true,
        autoApproveTools: true,
        transport: {
          type: "stdio",
          command: process.execPath,
          args: [fixture],
          env: {
            MCP_FIXTURE_MODE: "retry",
            MCP_FIXTURE_RETRY_MARKER: marker,
            MCP_FIXTURE_IDEMPOTENT_HINT: "false",
          },
        },
      },
    ],
    { saveServers: async () => undefined },
  );
  try {
    const tools = await registry.listTools();
    const flakyTool = tools.find((tool) => tool.title === "flaky_read");
    assert.ok(flakyTool);
    assert.equal(flakyTool.annotations?.idempotentHint, false);
    const result = (await registry.callTool(flakyTool.name, {})) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    assert.equal(result.content?.[0]?.text, "recovered after reconnect");
    assert.equal(registry.listServers()[0]?.reconnectCount, 1);
  } finally {
    await registry.close();
    await dataDir.cleanup();
  }
});

test("untrusted external annotations never authorize an automatic tool replay", async () => {
  const fixture = join(projectRoot, "tests", "fixtures", "externalMcpEchoServer.mjs");
  const dataDir = await createTestDataDirectory("external-mcp-untrusted-retry-");
  const marker = join(dataDir.rootDir, "failed-once.marker");
  const registry = new ExternalMcpRegistry(
    [
      {
        id: "mcp_untrusted_retry_fixture",
        name: "Untrusted retry fixture",
        enabled: true,
        transport: {
          type: "stdio",
          command: process.execPath,
          args: [fixture],
          env: {
            MCP_FIXTURE_MODE: "retry",
            MCP_FIXTURE_RETRY_MARKER: marker,
          },
        },
      },
    ],
    { saveServers: async () => undefined },
  );
  try {
    const tools = await registry.listTools();
    const flakyTool = tools.find((tool) => tool.title === "flaky_read");
    assert.ok(flakyTool);
    await assert.rejects(
      registry.callTool(flakyTool.name, {}),
      /Connection closed/,
    );
    assert.equal(registry.listServers()[0]?.reconnectCount, 1);
    const explicitRetry = (await registry.callTool(flakyTool.name, {})) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    assert.equal(explicitRetry.content?.[0]?.text, "recovered after reconnect");
  } finally {
    await registry.close();
    await dataDir.cleanup();
  }
});

test("two consecutive transport failures recover without an unbounded retry loop", async () => {
  const fixture = join(projectRoot, "tests", "fixtures", "externalMcpEchoServer.mjs");
  const dataDir = await createTestDataDirectory("external-mcp-two-retries-");
  const marker = join(dataDir.rootDir, "failed-twice.marker");
  const registry = new ExternalMcpRegistry(
    [
      {
        id: "mcp_two_retries_fixture",
        name: "Two retries fixture",
        enabled: true,
        trustReadOnlyTools: true,
        transport: {
          type: "stdio",
          command: process.execPath,
          args: [fixture],
          env: {
            MCP_FIXTURE_MODE: "retry",
            MCP_FIXTURE_RETRY_MARKER: marker,
            MCP_FIXTURE_RETRY_FAILURES: "2",
          },
        },
      },
    ],
    { saveServers: async () => undefined },
  );
  try {
    const tools = await registry.listTools();
    const flakyTool = tools.find((tool) => tool.title === "flaky_read");
    assert.ok(flakyTool);
    const result = (await registry.callTool(flakyTool.name, {})) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    assert.equal(result.content?.[0]?.text, "recovered after reconnect");
  } finally {
    await registry.close();
    await dataDir.cleanup();
  }
});

test("concurrent read-only failures share one reconnect without losing tool routes", async () => {
  const fixture = join(projectRoot, "tests", "fixtures", "externalMcpEchoServer.mjs");
  const dataDir = await createTestDataDirectory("external-mcp-concurrent-retry-");
  const marker = join(dataDir.rootDir, "failed-once.marker");
  const registry = new ExternalMcpRegistry(
    [
      {
        id: "mcp_concurrent_retry_fixture",
        name: "Concurrent retry fixture",
        enabled: true,
        trustReadOnlyTools: true,
        transport: {
          type: "stdio",
          command: process.execPath,
          args: [fixture],
          env: {
            MCP_FIXTURE_MODE: "retry",
            MCP_FIXTURE_RETRY_MARKER: marker,
          },
        },
      },
    ],
    { saveServers: async () => undefined },
  );
  try {
    const tools = await registry.listTools();
    const flakyTool = tools.find((tool) => tool.title === "flaky_read");
    assert.ok(flakyTool);

    const results = (await Promise.all([
      registry.callTool(flakyTool.name, {}),
      registry.callTool(flakyTool.name, {}),
      registry.callTool(flakyTool.name, {}),
    ])) as Array<{ content?: Array<{ type?: string; text?: string }> }>;

    assert.deepEqual(
      results.map((result) => result.content?.[0]?.text),
      [
        "recovered after reconnect",
        "recovered after reconnect",
        "recovered after reconnect",
      ],
    );
    assert.equal(
      (await registry.listTools()).some((tool) => tool.name === flakyTool.name),
      true,
    );
  } finally {
    await registry.close();
    await dataDir.cleanup();
  }
});

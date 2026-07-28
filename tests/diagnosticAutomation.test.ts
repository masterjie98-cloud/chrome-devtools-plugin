import assert from "node:assert/strict";
import test from "node:test";
import { executeMcpToolData, MCP_TOOL_INPUT_SCHEMAS } from "../src/mcp/toolRuntime";
import { MCP_TOOL_NAMES } from "../src/shared/mcpTools";
import { getToolPolicy } from "../src/shared/toolPolicy";
import { findWorkspaceSource } from "../src/mcp/workspaceTools";
import { TOOL_NAMES, validateToolCall } from "../src/shared/tools";
import { fetchStagesForRule } from "../src/background/debuggerAdapter";
import type { PluginWebSocketServer } from "../src/mcp/wsServer";
import type { ArtifactReference } from "../src/shared/artifacts";

const noBrowserBridge = {
  callBrowserTool: async () => {
    throw new Error("unexpected browser call");
  },
} as unknown as PluginWebSocketServer;

test("diagnostic MCP inputs stay bounded and stateful Mock steps are explicit", () => {
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_EXPLAIN_CSS].safeParse({
      selector: "#app",
      properties: ["display", "--brand-color"],
      maxRules: 50,
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[
      MCP_TOOL_NAMES.BROWSER_PERFORMANCE_DIAGNOSTICS
    ].safeParse({ resourceLimit: 101 }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[
      MCP_TOOL_NAMES.BROWSER_PROXY_UPSERT_RULE
    ].safeParse({
      id: "scenario",
      urlContains: "/api/jobs",
      scenarioSteps: [
        { name: "queued", statusCode: 202, responseBody: "{\"state\":\"queued\"}" },
        { name: "done", statusCode: 200, responseBody: "{\"state\":\"done\"}" },
      ],
      scenarioRepeat: "hold-last",
      resetScenario: true,
    }).success,
    true,
  );
  assert.match(
    validateToolCall({
      toolName: TOOL_NAMES.DEBUGGER_PROXY_UPSERT_RULE,
      args: {
        urlContains: "/api/jobs",
        scenarioSteps: [{ name: "empty" }],
      },
    }) ?? "",
    /response action/,
  );
  assert.equal(
    validateToolCall({
      toolName: TOOL_NAMES.DEBUGGER_PROXY_UPSERT_RULE,
      args: {
        urlContains: "/api/jobs",
        scenarioSteps: [{ name: "done", statusCode: 200 }],
        scenarioRepeat: "loop",
      },
    }),
    null,
  );
  assert.deepEqual(
    fetchStagesForRule({
      id: "scenario-only",
      enabled: true,
      priority: 1,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      hitCount: 0,
      urlContains: "/api/jobs",
      mockStage: "request",
      scenarioSteps: [{ statusCode: 200, responseBody: "{}" }],
    }),
    ["request"],
  );
});

test("reproduction recipe creation stores a session-bound bounded manifest", async () => {
  let stored: unknown;
  const artifact: ArtifactReference = {
    id: "artifact-recipe",
    uri: "ai-devtools://artifact/artifact-recipe",
    kind: "payload",
    mimeType: "application/json",
    byteLength: 100,
    sha256: "a".repeat(64),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const result = (await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_CREATE_REPRODUCTION_RECIPE,
    {
      name: "Open settings",
      targetUrlPattern: "https://example.test/*",
      workflow: {
        observation: { mode: "interactive", limit: 20 },
        actions: [{ id: "open", type: "click", selector: "#settings" }],
        checks: [{ id: "url", type: "url_contains", value: "/settings" }],
      },
    },
    noBrowserBridge,
    {
      sessionId: "diagnostic-recipe-test",
      storeJsonArtifact: async (value) => {
        stored = value;
        return artifact;
      },
    },
  )) as Record<string, unknown>;

  assert.equal(result.version, "browser-reproduction-recipe-v1");
  assert.equal(result.stepCount, 1);
  assert.equal(result.checkCount, 1);
  assert.equal((stored as Record<string, unknown>).version, result.version);
  assert.equal(
    JSON.stringify(stored).includes("browser.takeScreenshot"),
    false,
  );
});

test("workspace bridge resolves only bounded configured workspace matches", async () => {
  const previous = process.env.AI_DEVTOOLS_WORKSPACE_ROOTS;
  process.env.AI_DEVTOOLS_WORKSPACE_ROOTS = process.cwd();
  try {
    const result = await findWorkspaceSource({
      sourceHint: `${process.cwd()}/src/mcp/workspaceTools.ts`,
      symbol: "registerWorkspaceSourceTool",
      limit: 5,
      includeExcerpt: true,
    });
    assert.equal(result.version, "browser-workspace-source-v1");
    assert.equal(result.truncated, false);
    assert.equal(result.matches[0]?.path, "src/mcp/workspaceTools.ts");
    assert.equal(result.matches[0]?.reason.includes("symbol content match"), true);
    assert.equal(
      result.matches.every((match) => !match.path.startsWith("..")),
      true,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.AI_DEVTOOLS_WORKSPACE_ROOTS;
    } else {
      process.env.AI_DEVTOOLS_WORKSPACE_ROOTS = previous;
    }
  }
});

test("new diagnostic and replay tools keep explicit trust policy", () => {
  assert.equal(
    getToolPolicy(MCP_TOOL_NAMES.BROWSER_EXPLAIN_CSS).approvalMode,
    "task_grant",
  );
  assert.equal(
    getToolPolicy(MCP_TOOL_NAMES.BROWSER_CREATE_REPRODUCTION_RECIPE)
      .requiresApproval,
    false,
  );
  assert.equal(
    getToolPolicy(MCP_TOOL_NAMES.BROWSER_RUN_REPRODUCTION_RECIPE).approvalMode,
    "decision_barrier",
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import type { PluginWebSocketServer } from "../src/mcp/wsServer";
import {
  MCP_TOOL_INPUT_SCHEMAS,
  executeMcpToolData,
  runtimeToolsForProfile,
} from "../src/mcp/toolRuntime";
import { MCP_TOOL_OUTPUT_SCHEMAS } from "../src/mcp/toolOutputSchemas";
import { MCP_TOOL_NAMES } from "../src/shared/mcpTools";
import { getToolPolicy } from "../src/shared/toolPolicy";
import { TOOL_NAMES, type AnyToolCall } from "../src/shared/tools";
import { paginateSemanticSnapshot } from "../src/shared/semanticSnapshot";
import { browserStateHub } from "../src/mcp/browserStateHub";

const target = {
  url: "https://fixture.test/form",
  title: "Fixture form",
  targetId: "fixture-target",
  tabId: 17,
  windowId: 3,
  frameId: 0,
  documentId: "fixture-document",
  navigationId: "fixture-navigation",
  revision: 4,
};

test("[eval 01] smart profile exposes ten task-oriented tools", () => {
  const tools = runtimeToolsForProfile("smart");
  assert.equal(tools.length, 10);
  assert.deepEqual(
    tools.slice(0, 5).map((tool) => tool.definition.name),
    [
      MCP_TOOL_NAMES.BROWSER_STATUS,
      MCP_TOOL_NAMES.BROWSER_OBSERVE,
      MCP_TOOL_NAMES.BROWSER_ACT,
      MCP_TOOL_NAMES.BROWSER_VERIFY,
      MCP_TOOL_NAMES.BROWSER_DEBUG_ACTIVITY,
    ],
  );
});

test("[eval 02] smart schemas are smaller than the full expert surface", () => {
  const schemaChars = (profile: "smart" | "full") =>
    JSON.stringify(
      runtimeToolsForProfile(profile).map((tool) => ({
        name: tool.definition.name,
        description: tool.definition.description,
        parameters: tool.definition.parameters,
      })),
    ).length;
  assert.equal(schemaChars("smart") < schemaChars("full") / 2, true);
});

test("[eval 03] browser_status reports connection state without page payloads", async () => {
  const result = await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_STATUS,
    {},
    createBridge(),
    { sessionId: "eval-status" },
  );
  assert.equal(read(result, "version"), "browser-status-v1");
  assert.equal("pageContext" in (result as Record<string, unknown>), false);
});

test("[eval 04] browser_observe returns live actionable target refs", async () => {
  const result = await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_OBSERVE,
    { mode: "interactive", limit: 10 },
    createBridge(),
    { sessionId: "eval-observe" },
  );
  assert.equal(read(result, "version"), "browser-semantic-snapshot-v1");
  const snapshot = (result as { snapshot: { nodes: Array<{ targetRef: string }> } })
    .snapshot;
  assert.match(snapshot.nodes[0]?.targetRef ?? "", /^sr1_[a-f0-9]{8}_s1$/);
});

test("[eval 05] browser_act resolves an observed targetRef before execution", async () => {
  const sessionId = "eval-act-ref";
  const calls: AnyToolCall[] = [];
  const observeBridge = createBridge(calls);
  browserStateHub.setCurrentTab(target, sessionId);
  const observed = await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_OBSERVE,
    { mode: "interactive", limit: 10 },
    observeBridge,
    { sessionId },
  );
  const saveRef = (
    observed as {
      snapshot: { nodes: Array<{ name: string; targetRef: string }> };
    }
  ).snapshot.nodes.find((node) => node.name === "Save")?.targetRef;
  assert.ok(saveRef);
  const result = await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_ACT,
    {
      actions: [
        { id: "save", type: "click", ref: saveRef },
      ],
    },
    createBridge(calls),
    { sessionId },
  );
  assert.equal(read(result, "version"), "action-stage-v1");
  assert.equal(read(result, "completed"), 1);
  assert.equal(read(result, "requiresVerification"), true);
  const click = calls.find((call) => call.toolName === TOOL_NAMES.BROWSER_CLICK);
  assert.equal(
    (click?.args as { selector?: string } | undefined)?.selector,
    "#save",
  );
});

test("[eval 06] browser_verify evaluates multiple outcomes from one live read", async () => {
  const calls: AnyToolCall[] = [];
  const result = await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_VERIFY,
    {
      checks: [
        { id: "url", type: "url_contains", value: "/form" },
        { id: "text", type: "text_contains", value: "Save" },
        { id: "target", type: "target_present", selector: "#save" },
      ],
    },
    createBridge(calls),
    { sessionId: "eval-verify" },
  );
  assert.equal(read(result, "passed"), true);
  assert.equal(
    (result as { checks: Array<unknown> }).checks.length,
    3,
  );
  const pageRead = calls.find(
    (call) => call.toolName === TOOL_NAMES.DOM_GET_PAGE_INFO,
  );
  assert.equal(
    (pageRead?.args as { mode?: string } | undefined)?.mode,
    "full",
  );
  assert.equal(
    (pageRead?.args as { sourceLimit?: number } | undefined)?.sourceLimit,
    2_000,
  );
});

test("[eval 07] browser_debug_activity excludes raw response bodies", async () => {
  browserStateHub.setCurrentTab(target, "eval-debug");
  const result = await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_DEBUG_ACTIVITY,
    {},
    createBridge(),
    { sessionId: "eval-debug" },
  );
  assert.equal(read(result, "version"), "browser-debug-activity-v1");
  assert.equal(JSON.stringify(result).includes("responseBody"), false);
});

test("[eval 07b] browser_debug_activity rejects mixed-tab evidence", async () => {
  const sessionId = "eval-debug-mixed-target";
  browserStateHub.setCurrentTab(target, sessionId);
  await assert.rejects(
    executeMcpToolData(
      MCP_TOOL_NAMES.BROWSER_DEBUG_ACTIVITY,
      {},
      createBridge([], { consoleTabId: target.tabId + 1 }),
      { sessionId },
    ),
    /STALE_CONTEXT: Console activity belongs to tab 18/,
  );
});

test("[eval 08] actionable refs and verify inputs fail closed on malformed values", () => {
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_CLICK].safeParse({
      ref: "s1",
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_VERIFY].safeParse({
      checks: [{ id: "missing", type: "target_present" }],
    }).success,
    false,
  );
});

test("[eval 09] high-level tools keep explicit approval modes", () => {
  assert.equal(getToolPolicy(MCP_TOOL_NAMES.BROWSER_OBSERVE).approvalMode, "none");
  assert.equal(
    getToolPolicy(MCP_TOOL_NAMES.BROWSER_DEBUG_ACTIVITY).approvalMode,
    "task_grant",
  );
  assert.equal(
    getToolPolicy(MCP_TOOL_NAMES.BROWSER_ACT).approvalMode,
    "task_grant",
  );
});

test("[eval 10] audit output accepts bounded execution timing metrics", () => {
  const parsed = MCP_TOOL_OUTPUT_SCHEMAS[
    MCP_TOOL_NAMES.BROWSER_GET_AUDIT_EVENTS
  ].safeParse({
    sessionId: "eval",
    filters: {},
    events: [
      {
        id: "event",
        eventType: "tool.completed",
        timestamp: "2026-07-17T00:00:00.000Z",
        requestId: "request",
        sessionId: "eval",
        toolName: "browser_observe",
        policyClass: "safe_read",
        argumentsSha256: "a".repeat(64),
        revision: 1,
        outcome: "completed",
        executorMs: 12,
        transportMs: 4,
        totalMs: 16,
        resultChars: 1024,
        payloadBytes: 512,
      },
    ],
    pagination: {
      version: "collection-page-v1",
      kind: "audit",
      fingerprint: "deadbeef",
      offset: 0,
      limit: 50,
      returnedCount: 1,
      totalCount: 1,
      hasMore: false,
    },
  });
  assert.equal(parsed.success, true);
});

function createBridge(
  calls: AnyToolCall[] = [],
  options: { networkTabId?: number; consoleTabId?: number } = {},
): PluginWebSocketServer {
  return {
    connectedPluginClients: () => 1,
    callBrowserTool: async (call: AnyToolCall) => {
      calls.push(call);
      if (call.toolName === TOOL_NAMES.DOM_GET_PAGE_INFO) {
        return pageSnapshot();
      }
      if (call.toolName === TOOL_NAMES.BROWSER_FILL_FORM) {
        return {
          filled: true,
          fields: [{ selector: "#name", matched: true, action: "fill" }],
        };
      }
      if (call.toolName === TOOL_NAMES.BROWSER_CLICK) {
        return {
          selector: "#save",
          matched: true,
          action: "click",
          inputMode: "cdp",
          x: 120,
          y: 80,
        };
      }
      if (call.toolName === TOOL_NAMES.DEBUGGER_NETWORK_LIST) {
        return {
          attached: true,
          tabId: options.networkTabId ?? target.tabId,
          digestOnly: true,
          total: 1,
          returned: 0,
          requests: [],
          activityDigest: {
            observedRequests: 1,
            totalGroups: 1,
            returnedGroups: 1,
            heartbeatRequestsCollapsed: 0,
            groups: [
              {
                method: "POST",
                url: "https://fixture.test/api/save",
                resourceType: "Fetch",
                status: 200,
                count: 1,
                failedCount: 0,
                latestStartedAt: 1,
                heartbeatLike: false,
              },
            ],
          },
        };
      }
      if (call.toolName === TOOL_NAMES.BROWSER_CONSOLE_MESSAGES) {
        return {
          attached: true,
          tabId: options.consoleTabId ?? target.tabId,
          total: 1,
          returned: 1,
          messages: [{ level: "info", text: "saved" }],
        };
      }
      throw new Error(`Unexpected internal tool ${call.toolName}`);
    },
  } as unknown as PluginWebSocketServer;
}

function pageSnapshot() {
  return {
    url: target.url,
    title: target.title,
    origin: "https://fixture.test",
    capturedAt: "2026-07-17T00:00:00.000Z",
    visibleText: "Name Save",
    domSummary: [],
    nodeCount: 2,
    truncated: false,
    mode: "interactive" as const,
    sourceVisited: 8,
    sourceLimit: 2000,
    domRevision: 4,
    semanticSnapshot: paginateSemanticSnapshot(
      [
        {
          role: "textbox",
          name: "Name",
          selector: "#name",
          tagName: "input",
          bounds: { x: 20, y: 20, width: 200, height: 32 },
        },
        {
          role: "button",
          name: "Save",
          selector: "#save",
          tagName: "button",
          bounds: { x: 80, y: 64, width: 80, height: 32 },
        },
      ],
      { limit: 100 },
      `${target.url}\n${target.title}`,
      false,
    ),
    provenance: {
      source: "chrome-content-script" as const,
      observedAt: "2026-07-17T00:00:00.010Z",
      target,
    },
  };
}

function read(value: unknown, key: string): unknown {
  return (value as Record<string, unknown>)[key];
}

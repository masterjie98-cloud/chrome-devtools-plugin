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

test("[eval 01] smart profile exposes eleven task-oriented tools", () => {
  const tools = runtimeToolsForProfile("smart");
  assert.equal(tools.length, 11);
  assert.deepEqual(
    tools.slice(0, 6).map((tool) => tool.definition.name),
    [
      MCP_TOOL_NAMES.BROWSER_STATUS,
      MCP_TOOL_NAMES.BROWSER_WORKFLOW,
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
  const calls: AnyToolCall[] = [];
  const result = await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_OBSERVE,
    { mode: "interactive", limit: 10 },
    createBridge(calls),
    { sessionId: "eval-observe" },
  );
  assert.equal(read(result, "version"), "browser-semantic-snapshot-v1");
  const snapshot = (
    result as {
      snapshot: {
        nodes: Array<{
          bounds?: unknown;
          ref?: string;
          selector?: string;
          tagName?: string;
          targetRef: string;
        }>;
      };
    }
  ).snapshot;
  assert.match(snapshot.nodes[0]?.targetRef ?? "", /^sr1_[a-f0-9]{8}_s1$/);
  assert.equal(snapshot.nodes[0]?.selector, undefined);
  assert.equal(snapshot.nodes[0]?.tagName, undefined);
  assert.equal(snapshot.nodes[0]?.bounds, undefined);
  assert.equal(snapshot.nodes[0]?.ref, undefined);
  assert.deepEqual(calls[0]?.args, {
    limit: 10,
    mode: "interactive",
    compact: true,
    frameScope: "auto",
  });
});

test("[eval 04a] browser_observe projects only requested model-visible fields", async () => {
  const result = await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_OBSERVE,
    {
      mode: "interactive",
      limit: 10,
      fields: ["name", "value"],
    },
    createBridge(),
    { sessionId: "eval-observe-projection" },
  );
  const node = (
    result as {
      snapshot: {
        nodes: Array<Record<string, unknown>>;
      };
    }
  ).snapshot.nodes[0];
  assert.deepEqual(Object.keys(node ?? {}).sort(), [
    "name",
    "targetRef",
    "value",
  ]);
});

test("[eval 04c] browser_observe returns bounded actionable child-frame references", async () => {
  const childTarget = {
    ...target,
    url: "https://child.fixture.test/frame",
    title: "Child fixture",
    frameId: 7,
    documentId: "child-document",
  };
  const bridge = {
    connectedPluginClients: () => 1,
    callBrowserTool: async () => ({
      version: "multi-frame-page-snapshot-v1",
      tabId: target.tabId,
      selectedFrameId: target.frameId,
      frameScope: "auto",
      capturedAt: "2026-07-17T00:00:00.020Z",
      complete: true,
      omittedFrameCount: 0,
      frames: [
        {
          frame: frameMetadata(target, true),
          pageSnapshot: pageSnapshot(),
        },
        {
          frame: frameMetadata(childTarget, false),
          pageSnapshot: pageSnapshot(childTarget),
        },
      ],
      unavailableFrames: [],
    }),
  } as unknown as PluginWebSocketServer;

  const result = await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_OBSERVE,
    { mode: "interactive", limit: 10, frameScope: "auto" },
    bridge,
    { sessionId: "eval-observe-frames" },
  );
  const frames = (result as {
    frames: Array<{
      actionable: boolean;
      frameRef: string;
      documentId: string;
      target: { frameId: number };
      snapshot: { nodes: Array<{ targetRef?: string }> };
    }>;
  }).frames;
  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.target.frameId, 7);
  assert.equal(frames[0]?.actionable, true);
  assert.match(frames[0]?.frameRef ?? "", /^fr1_[a-f0-9]{8}$/);
  assert.equal(frames[0]?.documentId, "child-document");
  assert.match(
    frames[0]?.snapshot.nodes[0]?.targetRef ?? "",
    /^sr1_[a-f0-9]{8}_s1$/,
  );
  assert.equal(read(result, "complete"), true);
});

test("[eval 04b] browser_observe retries one transient target change internally", async () => {
  const sessionId = "eval-observe-retry";
  const nextTarget = {
    ...target,
    url: "https://fixture.test/form?step=2",
    navigationId: "fixture-navigation-2",
    revision: 5,
  };
  let reads = 0;
  browserStateHub.setCurrentTab(target, sessionId);
  const bridge = {
    connectedPluginClients: () => 1,
    callBrowserTool: async (call: AnyToolCall) => {
      assert.equal(call.toolName, TOOL_NAMES.DOM_GET_PAGE_INFO);
      reads += 1;
      if (reads === 1) {
        browserStateHub.setCurrentTab(nextTarget, sessionId);
      }
      const snapshot = pageSnapshot();
      return {
        ...snapshot,
        url: nextTarget.url,
        provenance: {
          ...snapshot.provenance,
          target: nextTarget,
        },
      };
    },
  } as unknown as PluginWebSocketServer;

  const result = await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_OBSERVE,
    { mode: "interactive", limit: 10 },
    bridge,
    { sessionId },
  );

  assert.equal(reads, 2);
  assert.equal(read(result, "version"), "browser-semantic-snapshot-v1");
  assert.equal(
    (result as { page: { url: string } }).page.url,
    nextTarget.url,
  );
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
  assert.equal(
    (click?.args as { documentId?: string } | undefined)?.documentId,
    target.documentId,
  );
});

test("[eval 05b] browser_act resolves both drag target refs before execution", async () => {
  const sessionId = "eval-act-drag-refs";
  const calls: AnyToolCall[] = [];
  browserStateHub.setCurrentTab(target, sessionId);
  const observed = await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_OBSERVE,
    { mode: "interactive", limit: 10 },
    createBridge(calls),
    { sessionId },
  );
  const nodes = (
    observed as {
      snapshot: { nodes: Array<{ name: string; targetRef: string }> };
    }
  ).snapshot.nodes;
  const sourceRef = nodes.find((node) => node.name === "Name")?.targetRef;
  const targetRef = nodes.find((node) => node.name === "Save")?.targetRef;
  assert.ok(sourceRef);
  assert.ok(targetRef);

  await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_ACT,
    {
      actions: [
        {
          id: "drag",
          type: "drag",
          sourceRef,
          targetRef,
        },
      ],
    },
    createBridge(calls),
    { sessionId },
  );

  const drag = calls.find((call) => call.toolName === TOOL_NAMES.BROWSER_DRAG);
  assert.deepEqual(drag?.args, {
    sourceSelector: "#name",
    targetSelector: "#save",
    frameId: 0,
    documentId: "fixture-document",
  });
});

test("[eval 05c] frameRef and documentId execute directly in a child frame", async () => {
  const sessionId = "eval-child-frame-act";
  const childTarget = {
    ...target,
    url: "https://child.fixture.test/frame",
    title: "Child fixture",
    frameId: 7,
    documentId: "child-document",
  };
  browserStateHub.setCurrentTab(target, sessionId);
  const calls: AnyToolCall[] = [];
  const bridge = {
    connectedPluginClients: () => 1,
    callBrowserTool: async (call: AnyToolCall) => {
      calls.push(call);
      if (call.toolName === TOOL_NAMES.DOM_GET_PAGE_INFO) {
        if (call.args.frameId === 7) {
          return pageSnapshot(childTarget);
        }
        return {
          version: "multi-frame-page-snapshot-v1",
          tabId: target.tabId,
          selectedFrameId: target.frameId,
          frameScope: "auto",
          capturedAt: "2026-07-17T00:00:00.020Z",
          complete: true,
          omittedFrameCount: 0,
          frames: [
            {
              frame: frameMetadata(target, true),
              pageSnapshot: pageSnapshot(),
            },
            {
              frame: frameMetadata(childTarget, false),
              pageSnapshot: pageSnapshot(childTarget),
            },
          ],
          unavailableFrames: [],
        };
      }
      if (call.toolName === TOOL_NAMES.BROWSER_CLICK) {
        return { selector: "#save", matched: true, action: "click" };
      }
      throw new Error(`Unexpected internal tool ${call.toolName}`);
    },
  } as unknown as PluginWebSocketServer;
  const observed = await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_OBSERVE,
    { frameScope: "auto" },
    bridge,
    { sessionId },
  ) as {
    frames: Array<{
      frameRef: string;
      documentId: string;
      snapshot: { nodes: Array<{ name: string; targetRef: string }> };
    }>;
  };
  const child = observed.frames[0];
  const saveRef = child?.snapshot.nodes.find(
    (node) => node.name === "Save",
  )?.targetRef;
  assert.ok(child);
  assert.ok(saveRef);

  await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_ACT,
    {
      actions: [
        {
          id: "child-save",
          type: "click",
          frameRef: child.frameRef,
          documentId: child.documentId,
          ref: saveRef,
        },
      ],
    },
    bridge,
    { sessionId },
  );
  const click = calls.find((call) => call.toolName === TOOL_NAMES.BROWSER_CLICK);
  assert.deepEqual(click?.args, {
    selector: "#save",
    button: undefined,
    doubleClick: undefined,
    frameId: 7,
    documentId: "child-document",
  });
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
        {
          id: "value",
          type: "target_state",
          selector: "#name",
          value: "Ada",
        },
      ],
    },
    createBridge(calls),
    { sessionId: "eval-verify" },
  );
  assert.equal(read(result, "passed"), true);
  assert.equal(
    (result as { checks: Array<unknown> }).checks.length,
    4,
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
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_OBSERVE].safeParse({
      cursor: "ss1_deadbeef_1",
      frameScope: "auto",
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
  assert.equal(
    getToolPolicy(MCP_TOOL_NAMES.BROWSER_WORKFLOW).approvalMode,
    "task_grant",
  );
});

test("[eval 09b] browser_workflow returns action, verification, and correlated evidence", async () => {
  const sessionId = "eval-workflow";
  browserStateHub.setCurrentTab(target, sessionId);
  const result = await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_WORKFLOW,
    {
      observation: {
        mode: "interactive",
        fields: ["role", "name", "value"],
      },
      actions: [
        { id: "name", type: "fill", selector: "#name", value: "Ada" },
      ],
      checks: [
        {
          id: "name-value",
          type: "target_state",
          selector: "#name",
          value: "Ada",
        },
      ],
      evidence: { dom: true, url: true, network: true, console: true },
    },
    createBridge(),
    { sessionId },
  );
  assert.equal(read(result, "version"), "browser-workflow-v1");
  assert.equal(read(result, "status"), "completed");
  const workflow = result as {
    actions: { completed: number; results: Array<Record<string, unknown>> };
    verification: { passed: boolean };
    evidence: { network: unknown; console: unknown };
  };
  assert.equal(workflow.actions.completed, 1);
  assert.equal(workflow.verification.passed, true);
  assert.equal("postState" in (workflow.actions.results[0] ?? {}), true);
  assert.ok(workflow.evidence.network);
  assert.ok(workflow.evidence.console);
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
      if (call.toolName === TOOL_NAMES.BROWSER_DRAG) {
        return {
          sourceSelector: "#name",
          targetSelector: "#save",
          matched: true,
          action: "drag",
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
      if (call.toolName === TOOL_NAMES.DEBUGGER_NETWORK_START) {
        return {
          attached: true,
          networkEnabled: true,
          tabId: target.tabId,
          requestCount: 0,
        };
      }
      if (call.toolName === TOOL_NAMES.DEBUGGER_NETWORK_STOP) {
        return {
          attached: true,
          networkEnabled: false,
          tabId: target.tabId,
          requestCount: 1,
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

function pageSnapshot(snapshotTarget = target) {
  return {
    url: snapshotTarget.url,
    title: snapshotTarget.title,
    origin: new URL(snapshotTarget.url).origin,
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
          value: "Ada",
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
      `${snapshotTarget.url}\n${snapshotTarget.title}`,
      false,
    ),
    provenance: {
      source: "chrome-content-script" as const,
      observedAt: "2026-07-17T00:00:00.010Z",
      target: snapshotTarget,
    },
  };
}

function frameMetadata(
  snapshotTarget: typeof target,
  selected: boolean,
) {
  return {
    tabId: snapshotTarget.tabId,
    frameId: snapshotTarget.frameId,
    documentId: snapshotTarget.documentId,
    url: snapshotTarget.url,
    title: snapshotTarget.title,
    isTop: snapshotTarget.frameId === 0,
    selected,
    lastSeenAt: "2026-07-17T00:00:00.000Z",
  };
}

function read(value: unknown, key: string): unknown {
  return (value as Record<string, unknown>)[key];
}

import assert from "node:assert/strict";
import test from "node:test";
import type { PluginWebSocketServer } from "../src/mcp/wsServer";
import {
  MCP_TOOL_INPUT_SCHEMAS,
  executeMcpToolData,
  listRuntimeMcpTools,
} from "../src/mcp/toolRuntime";
import { MCP_TOOL_OUTPUT_SCHEMAS } from "../src/mcp/toolOutputSchemas";
import {
  screenshotDataUrlToBlob,
  shouldSaveScreenshotToDownloads,
} from "../src/background/toolDispatcher";
import { MCP_TOOL_NAMES } from "../src/shared/mcpTools";
import { getToolPolicy } from "../src/shared/toolPolicy";
import { TOOL_NAMES, type AnyToolCall } from "../src/shared/tools";

test("MCP screenshots never expose implicit Chrome Downloads arguments", () => {
  const schema = MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_TAKE_SCREENSHOT];
  assert.equal(schema.safeParse({ fullPage: true }).success, true);
  assert.equal(
    schema.safeParse({
      ref: "sr1_deadbeef_s1",
      frameRef: "fr1_deadbeef",
      documentId: "document-1",
      diffAgainst: "previous",
      returnImage: "changed",
      diffThreshold: 24,
    }).success,
    true,
  );
  assert.equal(schema.safeParse({ filename: "capture.png" }).success, false);
  assert.equal(schema.safeParse({ saveToDownloads: true }).success, false);

  const definition = listRuntimeMcpTools().find(
    (tool) => tool.name === MCP_TOOL_NAMES.BROWSER_TAKE_SCREENSHOT,
  );
  const properties = definition?.inputSchema.properties ?? {};
  assert.equal("filename" in properties, false);
  assert.equal("saveToDownloads" in properties, false);
  assert.equal("ref" in properties, true);
  assert.equal("frameRef" in properties, true);
  assert.equal("documentId" in properties, true);
  assert.equal("diffAgainst" in properties, true);
});

test("internal screenshot naming does not imply a local download", () => {
  assert.equal(shouldSaveScreenshotToDownloads({}), false);
  assert.equal(
    shouldSaveScreenshotToDownloads({ filename: "ai-devtools/capture.png" }),
    false,
  );
  assert.equal(shouldSaveScreenshotToDownloads({ saveToDownloads: false }), false);
  assert.equal(shouldSaveScreenshotToDownloads({ saveToDownloads: true }), true);
});

test("screenshot diff decodes data URLs without extension fetch", async () => {
  const blob = screenshotDataUrlToBlob(
    "data:image/png;base64,aGVsbG8=",
  );
  assert.equal(blob.type, "image/png");
  assert.equal(blob.size, 5);
  assert.equal(Buffer.from(await blob.arrayBuffer()).toString("utf8"), "hello");
  assert.throws(
    () => screenshotDataUrlToBlob("data:text/plain;base64,aGVsbG8="),
    /SCREENSHOT_DIFF_INVALID_IMAGE/,
  );
});

test("browser_query_dom accepts bounded batches and exact visual style projections", async () => {
  const args = {
    queries: [
      {
        query: "main",
        limit: 1,
        computedStyleProperties: ["display", "background-color"],
      },
      {
        query: "button.primary",
        limit: 2,
        includeOuterHTML: false,
        computedStyleProperties: ["color", "font-size"],
      },
    ],
  };
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_QUERY_DOM].safeParse(args)
      .success,
    true,
  );

  const calls: AnyToolCall[] = [];
  const bridge = {
    connectedPluginClients: () => 1,
    callBrowserTool: async (call: AnyToolCall) => {
      calls.push(call);
      const queryArgs = call.args as Record<string, unknown>;
      const query = String(queryArgs.query);
      return {
        query,
        queryType: queryArgs.queryType,
        count: 1,
        returnedCount: 1,
        truncated: false,
        elements: [
          {
            selector: query,
            tagName: query === "main" ? "main" : "button",
            outerHTML: "",
            attributes: {},
            computedStyle: {},
            rect: {
              x: 0,
              y: 0,
              top: 0,
              right: 1,
              bottom: 1,
              left: 0,
              width: 1,
              height: 1,
            },
          },
        ],
      };
    },
  } as unknown as PluginWebSocketServer;

  const result = await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_QUERY_DOM,
    args,
    bridge,
  );
  assert.deepEqual(
    calls.map((call) => call.toolName),
    [TOOL_NAMES.DOM_QUERY, TOOL_NAMES.DOM_QUERY],
  );
  assert.deepEqual(
    calls.map(
      (call) =>
        (call.args as Record<string, unknown>).computedStyleProperties,
    ),
    [
      ["display", "background-color"],
      ["color", "font-size"],
    ],
  );
  assert.deepEqual(
    (result as { results: Array<{ query: string }> }).results.map(
      (entry) => entry.query,
    ),
    ["main", "button.primary"],
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_QUERY_DOM].safeParse(result)
      .success,
    true,
  );
});

test("DOM batch schemas reject ambiguous or unsupported requests", () => {
  const schema = MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_QUERY_DOM];
  assert.equal(
    schema.safeParse({ query: "main", queries: [{ query: "button" }] }).success,
    false,
  );
  assert.equal(
    schema.safeParse({
      query: "main",
      computedStyleProperties: ["background-image"],
    }).success,
    false,
  );
  assert.equal(
    schema.safeParse({
      query: "main",
      includeComputedStyle: false,
      computedStyleProperties: ["color"],
    }).success,
    false,
  );
  assert.equal(
    schema.safeParse({
      queries: [{ query: "body", maxOuterHTMLLength: 0 }],
    }).success,
    false,
  );
  assert.equal(
    schema.safeParse({
      queries: [
        { query: "main", limit: 60 },
        { query: "aside", limit: 60 },
      ],
    }).success,
    false,
  );
});

test("an unbounded item inside a DOM batch retains sensitive-read approval", () => {
  const policy = getToolPolicy(MCP_TOOL_NAMES.BROWSER_QUERY_DOM, {
    queries: [
      { query: "main", limit: 1 },
      { query: "body", maxOuterHTMLLength: 0 },
    ],
  });
  assert.equal(policy.policyClass, "sensitive_read");
  assert.equal(policy.requiresApproval, true);
});

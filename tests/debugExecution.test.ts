import assert from "node:assert/strict";
import test from "node:test";
import {
  executeMcpToolData,
  MCP_TOOL_INPUT_SCHEMAS,
} from "../src/mcp/toolRuntime";
import { MCP_TOOL_OUTPUT_SCHEMAS } from "../src/mcp/toolOutputSchemas";
import { MCP_TOOL_NAMES } from "../src/shared/mcpTools";
import { TOOL_NAMES, validateToolCall } from "../src/shared/tools";
import type { PluginWebSocketServer } from "../src/mcp/wsServer";

test("debug execution schemas enforce code, timeout, breakpoint, and call-frame bounds", () => {
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_EVALUATE].safeParse({
      expression: "window.app?.runTest?.()",
      awaitPromise: true,
      timeoutMs: 5_000,
      allowBreakpoints: false,
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_EVALUATE].safeParse({
      expression: "1",
      timeoutMs: 10_001,
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[
      MCP_TOOL_NAMES.BROWSER_DEBUGGER_BREAKPOINT
    ].safeParse({
      action: "set",
      url: "https://example.test/app.js",
      urlRegex: "app\\.js$",
      lineNumber: 12,
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[
      MCP_TOOL_NAMES.BROWSER_DEBUGGER_BREAKPOINT
    ].safeParse({
      action: "set",
      url: "https://example.test/app.js",
      lineNumber: 12,
      columnNumber: 0,
      condition: "window.debugEnabled === true",
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[
      MCP_TOOL_NAMES.BROWSER_DEBUGGER_CONTROL
    ].safeParse({
      action: "evaluate_on_call_frame",
      expression: "localState",
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[
      MCP_TOOL_NAMES.BROWSER_DEBUGGER_CONTROL
    ].safeParse({
      action: "set_pause_on_exceptions",
    }).success,
    false,
  );
});

test("internal debug calls reject malformed high-risk operations before approval", () => {
  assert.equal(
    validateToolCall({
      toolName: TOOL_NAMES.BROWSER_EVALUATE,
      args: {
        expression: "document.body.dataset.debug = '1'",
        allowBreakpoints: true,
      },
    }),
    null,
  );
  assert.match(
    validateToolCall({
      toolName: TOOL_NAMES.DEBUGGER_BREAKPOINT,
      args: { action: "set", url: "app.js", lineNumber: 0 },
    }) ?? "",
    /1-based/,
  );
  assert.match(
    validateToolCall({
      toolName: TOOL_NAMES.DEBUGGER_CONTROL,
      args: {
        action: "evaluate_on_call_frame",
        callFrameId: "frame-1",
      },
    }) ?? "",
    /expression is required/,
  );
});

test("MCP debug tools enter only their declared CDP executors", async () => {
  const calls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  const bridge = {
    callBrowserTool: async (call: {
      toolName: string;
      args: Record<string, unknown>;
    }) => {
      calls.push(call);
      if (call.toolName === TOOL_NAMES.BROWSER_EVALUATE) {
        return {
          evaluated: true,
          tabId: 9,
          frameId: 0,
          elapsedMs: 1,
          result: { type: "number", value: 4, truncated: false },
        };
      }
      if (call.toolName === TOOL_NAMES.DEBUGGER_BREAKPOINT) {
        return {
          action: "list",
          tabId: 9,
          breakpoints: [],
        };
      }
      return {
        action: "status",
        tabId: 9,
        frameId: 0,
        paused: false,
        pauseOnExceptions: "none",
      };
    },
  } as unknown as PluginWebSocketServer;

  await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_EVALUATE,
    { expression: "2 + 2" },
    bridge,
  );
  await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_DEBUGGER_BREAKPOINT,
    { action: "list" },
    bridge,
  );
  await executeMcpToolData(
    MCP_TOOL_NAMES.BROWSER_DEBUGGER_CONTROL,
    { action: "status" },
    bridge,
  );

  assert.deepEqual(
    calls.map((call) => call.toolName),
    [
      TOOL_NAMES.BROWSER_EVALUATE,
      TOOL_NAMES.DEBUGGER_BREAKPOINT,
      TOOL_NAMES.DEBUGGER_CONTROL,
    ],
  );
});

test("debug execution output contracts stay bounded and structured", () => {
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_EVALUATE].safeParse({
      evaluated: true,
      tabId: 9,
      frameId: 0,
      elapsedMs: 2,
      result: { type: "number", value: 4, truncated: false },
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[
      MCP_TOOL_NAMES.BROWSER_DEBUGGER_BREAKPOINT
    ].safeParse({
      action: "list",
      tabId: 9,
      breakpoints: [],
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[
      MCP_TOOL_NAMES.BROWSER_DEBUGGER_CONTROL
    ].safeParse({
      action: "status",
      tabId: 9,
      frameId: 0,
      paused: false,
      pauseOnExceptions: "none",
    }).success,
    true,
  );
});

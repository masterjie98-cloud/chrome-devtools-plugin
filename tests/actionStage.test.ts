import assert from "node:assert/strict";
import test from "node:test";
import type { PluginWebSocketServer } from "../src/mcp/wsServer";
import {
  MCP_RUNTIME_TOOL_REGISTRY,
  MCP_TOOL_INPUT_SCHEMAS,
} from "../src/mcp/toolRuntime";
import { MCP_TOOL_NAMES } from "../src/shared/mcpTools";
import { TOOL_NAMES, type AnyToolCall } from "../src/shared/tools";

test("action stage batches independent fields but preserves dependency barriers", async () => {
  const browserCalls: AnyToolCall[] = [];
  const bridge: PluginWebSocketServer = {
    close: async () => undefined,
    ready: async () => ({ host: "127.0.0.1", port: 17321 }),
    connectedClients: () => 1,
    connectedPluginClients: () => 1,
    callBrowserTool: async (call) => {
      browserCalls.push(call);
      return { filled: true };
    },
  };
  const registration = MCP_RUNTIME_TOOL_REGISTRY.find(
    ({ definition }) =>
      definition.name === MCP_TOOL_NAMES.BROWSER_EXECUTE_ACTION_STAGE,
  );
  assert.ok(registration);

  const result = await registration.execute(
    {
      actions: [
        { id: "name", type: "fill", selector: "#name", value: "Ada" },
        { id: "team", type: "fill", selector: "#team", value: "Platform" },
        {
          id: "dependent",
          type: "fill",
          selector: "#dependent",
          value: "after-name",
          dependsOn: ["name"],
        },
      ],
    },
    bridge,
  );

  assert.equal(browserCalls.length, 2);
  assert.deepEqual(
    browserCalls.map((call) => call.args),
    [
      {
        fields: [
          { selector: "#name", value: "Ada" },
          { selector: "#team", value: "Platform" },
        ],
      },
      {
        fields: [{ selector: "#dependent", value: "after-name" }],
      },
    ],
  );
  assert.equal((result as { completed: number }).completed, 3);
});

test("smart action stage exposes existing pointer, drag, scroll, and viewport primitives", async () => {
  const browserCalls: AnyToolCall[] = [];
  const bridge = {
    connectedPluginClients: () => 1,
    callBrowserTool: async (call: AnyToolCall) => {
      browserCalls.push(call);
      return { completed: true };
    },
  } as unknown as PluginWebSocketServer;
  const registration = MCP_RUNTIME_TOOL_REGISTRY.find(
    ({ definition }) => definition.name === MCP_TOOL_NAMES.BROWSER_ACT,
  );
  assert.ok(registration);

  const input = {
    actions: [
      { id: "hover", type: "hover", selector: "#menu" },
      {
        id: "double",
        type: "click",
        selector: "#row",
        doubleClick: true,
      },
      {
        id: "drag",
        type: "drag",
        sourceSelector: "#source",
        targetSelector: "#target",
      },
      { id: "scroll", type: "scroll", deltaY: 480 },
      { id: "resize", type: "resize", width: 1280, height: 720 },
    ],
  };
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_ACT].safeParse(input).success,
    true,
  );

  const result = await registration.execute(input, bridge);

  assert.deepEqual(
    browserCalls.map((call) => call.toolName),
    [
      TOOL_NAMES.BROWSER_HOVER,
      TOOL_NAMES.BROWSER_CLICK,
      TOOL_NAMES.BROWSER_DRAG,
      TOOL_NAMES.BROWSER_MOUSE_WHEEL,
      TOOL_NAMES.BROWSER_RESIZE,
    ],
  );
  assert.deepEqual(browserCalls[1]?.args, {
    selector: "#row",
    button: undefined,
    doubleClick: true,
  });
  assert.deepEqual(browserCalls[2]?.args, {
    sourceSelector: "#source",
    targetSelector: "#target",
  });
  assert.equal((result as { completed: number }).completed, 5);
  assert.equal((result as { requiresVerification: boolean }).requiresVerification, true);
});

test("smart action stage rejects incomplete drag and scroll requests", () => {
  const schema = MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_ACT];
  assert.equal(
    schema.safeParse({
      actions: [{ id: "drag", type: "drag", sourceSelector: "#source" }],
    }).success,
    false,
  );
  assert.equal(
    schema.safeParse({ actions: [{ id: "scroll", type: "scroll" }] }).success,
    false,
  );
});

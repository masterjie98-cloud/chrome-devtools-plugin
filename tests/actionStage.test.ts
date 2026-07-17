import assert from "node:assert/strict";
import test from "node:test";
import type { PluginWebSocketServer } from "../src/mcp/wsServer";
import { MCP_RUNTIME_TOOL_REGISTRY } from "../src/mcp/toolRuntime";
import { MCP_TOOL_NAMES } from "../src/shared/mcpTools";
import type { AnyToolCall } from "../src/shared/tools";

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

import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySensitiveEgress,
  serializedEgressPayloadBytes,
} from "../src/shared/egressMetrics";
import { MCP_TOOL_NAMES } from "../src/shared/mcpTools";

test("sensitive egress is classified without inspecting result content", () => {
  assert.equal(
    classifySensitiveEgress(MCP_TOOL_NAMES.BROWSER_COOKIE_LIST),
    "cookies",
  );
  assert.equal(
    classifySensitiveEgress(MCP_TOOL_NAMES.BROWSER_STORAGE_STATE),
    "storage",
  );
  assert.equal(
    classifySensitiveEgress(
      MCP_TOOL_NAMES.BROWSER_NETWORK_GET_RESPONSE_BODY,
    ),
    "response_body",
  );
  assert.equal(
    classifySensitiveEgress(MCP_TOOL_NAMES.BROWSER_NETWORK_GET_REQUEST),
    "network_metadata",
  );
  assert.equal(
    classifySensitiveEgress(MCP_TOOL_NAMES.BROWSER_TAKE_SCREENSHOT),
    "screenshot",
  );
  assert.equal(classifySensitiveEgress("third_party_tool"), "external_tool");
});

test("egress byte accounting uses the exact serialized UTF-8 payload", () => {
  const payload = { text: "页面", values: [1, 2, 3] };
  assert.equal(
    serializedEgressPayloadBytes(payload),
    Buffer.byteLength(JSON.stringify(payload), "utf8"),
  );
});

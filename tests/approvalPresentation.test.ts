import assert from "node:assert/strict";
import test from "node:test";
import { getApprovalEgressDestinations } from "../src/sidepanel/services/approvalPresentation";

test("embedded Agent approvals show only the configured AI Provider origin", () => {
  assert.deepEqual(
    getApprovalEgressDestinations({
      requesterRole: "ui",
      toolName: "browser_storage_state",
      aiProviderUrl: "https://provider.example/v1/chat/completions?token=hidden",
    }),
    ["AI Provider: https://provider.example"],
  );
});

test("MCP approvals do not misattribute client-managed egress to the extension Provider", () => {
  assert.deepEqual(
    getApprovalEgressDestinations({
      requesterRole: "mcp",
      toolName: "browser_storage_state",
      aiProviderUrl: "https://provider.example/v1",
    }),
    ["MCP 客户端：后续模型或数据出站目标由该客户端配置"],
  );
  assert.deepEqual(
    getApprovalEgressDestinations({
      requesterRole: "mcp",
      toolName: "web_search",
      aiProviderUrl: "https://provider.example/v1",
    }),
    ["MCP 客户端：后续模型或数据出站目标由该客户端配置"],
  );
});

test("local web search approvals enumerate both possible search destinations", () => {
  assert.deepEqual(
    getApprovalEgressDestinations({
      toolName: "web_search",
      aiProviderUrl: "https://provider.example/v1",
    }),
    [
      "Bing RSS: https://www.bing.com",
      "DuckDuckGo fallback: https://api.duckduckgo.com",
    ],
  );
});

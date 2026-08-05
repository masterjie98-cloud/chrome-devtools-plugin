import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_EXTERNAL_MCP_SELECTION } from "../src/shared/externalMcp";
import {
  buildMcpCapabilityOverview,
  getCapabilityOverviewLocale,
  isGeneratedMcpCapabilityGreeting,
  MCP_CAPABILITY_GREETING_HEADING,
} from "../src/sidepanel/services/mcpCapabilityGreeting";

test("new conversations enable external MCP auto-selection by default", () => {
  assert.deepEqual(DEFAULT_EXTERNAL_MCP_SELECTION, {
    mode: "auto",
    serverIds: [],
  });
});

test("legacy generated MCP greetings remain recognizable for old empty conversations", () => {
  const greeting = `AI 已就绪。\n\n${MCP_CAPABILITY_GREETING_HEADING}\n- **旧服务**：旧能力`;
  assert.equal(
    isGeneratedMcpCapabilityGreeting(greeting, "AI 已就绪。"),
    true,
  );
});

test("capability overview is only triggered by a strict greeting or capability question", () => {
  assert.equal(getCapabilityOverviewLocale("你好！"), "zh-CN");
  assert.equal(getCapabilityOverviewLocale("hello"), "en");
  assert.equal(getCapabilityOverviewLocale("MCP 有哪些工具？"), "zh-CN");
  assert.equal(getCapabilityOverviewLocale("What can you do?"), "en");
  assert.equal(
    getCapabilityOverviewLocale("hello，请帮我检查当前页面的 Network"),
    undefined,
  );
  assert.equal(getCapabilityOverviewLocale("检查当前页面报错"), undefined);
});

test("Chinese capability overview localizes tool categories without leaking raw English descriptions", () => {
  const overview = buildMcpCapabilityOverview(
    [
      {
        name: "extmcp__prometheus__prometheus_query_123456",
        title: "Instant Prometheus query",
        description:
          "Registered Prometheus health: Return bounded build and runtime health facts",
        externalMcpServerId: "prometheus",
        externalMcpServerName: "Prometheus Infra MCP",
        inputSchema: { type: "object" },
      },
      {
        name: "extmcp__prometheus__list_sources_123456",
        title: "List sources",
        description: "List server-registered source IDs and environments.",
        externalMcpServerId: "prometheus",
        externalMcpServerName: "Prometheus Infra MCP",
        inputSchema: { type: "object" },
      },
    ],
    "zh-CN",
  );

  assert.match(overview, /调试当前页面/);
  assert.match(overview, /Prometheus 指标查询/);
  assert.match(overview, /数据源查看/);
  assert.match(overview, /2 个工具/);
  assert.doesNotMatch(overview, /Registered Prometheus health/);
  assert.doesNotMatch(overview, /List server-registered/);
});

test("English capability overview stays concise and uses English UI copy", () => {
  const overview = buildMcpCapabilityOverview([], "en");
  assert.match(overview, /^Hello, I'm ready\./);
  assert.match(overview, /Debug the current page/);
  assert.doesNotMatch(overview, /我可以帮你|已连接/);
  assert.ok(overview.length < 400);
});

test("capability overview escapes untrusted MCP server Markdown", () => {
  const overview = buildMcpCapabilityOverview(
    [
      {
        name: "extmcp__unsafe__tool_123456",
        externalMcpServerId: "unsafe",
        externalMcpServerName: "**unsafe**",
        inputSchema: { type: "object" },
      },
    ],
    "zh-CN",
  );
  assert.doesNotMatch(overview, /\*\*unsafe\*\*/);
  assert.match(overview, /\\\*\\\*unsafe\\\*\\\*/);
});

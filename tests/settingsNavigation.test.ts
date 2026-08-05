import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("chat MCP management opens the MCP settings tab explicitly", async () => {
  const [appSource, chatSource] = await Promise.all([
    readFile(new URL("../src/sidepanel/App.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/sidepanel/components/ChatPanel.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(chatSource, /onOpenSettings=\{\(\) => onOpenSettings\("mcp"\)\}/);
  assert.match(appSource, /initialTab=\{aiSettingsTab\}/);
  assert.match(appSource, /onOpenSettings=\{openAiSettings\}/);
});

test("settings use model management and keep MCP isolated from model credentials", async () => {
  const source = await readFile(
    new URL("../src/sidepanel/components/AiSettingsDrawer.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /\{ key: "model", label: "模型管理" \}/);
  assert.match(source, /mode="multiple"/);
  assert.match(source, /添加选中模型/);
  assert.match(source, /保存模型/);
  assert.match(source, /保存页面与工具设置/);
  assert.doesNotMatch(source, /配置方案|方案名称|未命名方案/);
  assert.match(source, /settingsTab === "model" \? \([\s\S]*API Key 可选/);
  assert.match(source, /settingsTab === "model" \|\| settingsTab === "page"/);
  assert.match(
    source,
    /<section hidden=\{settingsTab !== "mcp"\}[\s\S]*<McpSettingsSection/,
  );
});

test("switching a chat model probes and stores capabilities for that model", async () => {
  const source = await readFile(
    new URL("../src/sidepanel/App.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const changeActiveAiProfile = \(profileId: string\)/);
  assert.match(source, /detectAiCapabilities\(active\.config\)/);
  assert.match(
    source,
    /applyAiModelCapabilities\(\s*currentState,\s*active\.id,\s*capabilityResult,/,
  );
  assert.match(source, /modelCapabilityProbeSequenceRef/);
});

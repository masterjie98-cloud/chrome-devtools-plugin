import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyCollaborationWorkspace,
  upsertCollaborationItem,
} from "../src/shared/collaborationWorkspace";
import { buildRelevantCollaborationContext } from "../src/sidepanel/services/aiClient";

test("Agent receives only relevant non-sensitive shared collaboration context", () => {
  const style = upsertCollaborationItem(
    createEmptyCollaborationWorkspace(),
    {
      id: "ctx_button_style",
      kind: "page.style",
      title: "Save button layout",
      summary: "Computed width and display for the save button.",
      content: { selector: "#save", display: "flex", width: "120px" },
      sensitivity: "page_content",
      tags: ["button", "layout"],
    },
    { actor: "extension_agent" },
    "2026-07-14T08:00:00.000Z",
  );
  const finding = upsertCollaborationItem(
    style.workspace,
    {
      id: "ctx_codex_finding",
      kind: "code.finding",
      title: "Button token source",
      summary: "Codex found the width token in styles.css.",
      content: { file: "src/sidepanel/styles.css" },
      sensitivity: "safe",
      tags: ["button", "source"],
    },
    { actor: "mcp_agent" },
    "2026-07-14T08:00:01.000Z",
  );
  const sensitive = upsertCollaborationItem(
    finding.workspace,
    {
      id: "ctx_sensitive_trace",
      kind: "network.trace",
      title: "Authenticated response",
      summary: "Must not enter provider context.",
      content: { body: "protected" },
      sensitivity: "sensitive",
    },
    { actor: "extension_agent" },
    "2026-07-14T08:00:02.000Z",
  );

  const withPage = buildRelevantCollaborationContext(
    sensitive.workspace,
    "检查 save button 的宽度来自哪里",
    true,
  );
  assert.ok(withPage);
  assert.match(withPage, /ctx_button_style/);
  assert.match(withPage, /ctx_codex_finding/);
  assert.doesNotMatch(withPage, /ctx_sensitive_trace|protected/);

  const withoutPage = buildRelevantCollaborationContext(
    sensitive.workspace,
    "检查 save button 的宽度来自哪里",
    false,
  );
  assert.ok(withoutPage);
  assert.doesNotMatch(withoutPage, /ctx_button_style/);
  assert.match(withoutPage, /ctx_codex_finding/);
});

test("blocked task context is selected for resume intent but not unrelated chat", () => {
  const task = upsertCollaborationItem(
    createEmptyCollaborationWorkspace(),
    {
      id: "ctx_blocked_task",
      kind: "task.state",
      title: "创建服务并验证",
      summary: "安全预算停止，等待继续。",
      content: { phase: "blocked", nextAction: "读取当前页面状态" },
      sensitivity: "page_content",
      status: "active",
    },
    { actor: "extension_agent" },
    "2026-07-14T08:00:00.000Z",
  );

  assert.equal(
    buildRelevantCollaborationContext(task.workspace, "解释一下 flex", true),
    null,
  );
  assert.match(
    buildRelevantCollaborationContext(task.workspace, "继续刚才未完成的任务", true) ?? "",
    /ctx_blocked_task/,
  );
});

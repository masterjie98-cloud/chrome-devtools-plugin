import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("chat-local scroll and disclosure state is scoped to the active conversation", async () => {
  const source = await readFile(
    new URL("../src/sidepanel/App.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /<ChatPanel\s+key=\{activeConversationId\}\s+messages=\{displayedChatMessages\}/,
  );
});

test("chat viewport owns its height without creating an empty page scrollbar", async () => {
  const styles = await readFile(
    new URL("../src/sidepanel/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(
    styles,
    /body\s*\{[^}]*height:\s*100vh;[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    styles,
    /\.app-shell\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    styles,
    /\.chat-panel\s*\{[^}]*height:\s*calc\(100vh - 38px\);[^}]*min-height:\s*0;[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto;[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    styles,
    /\.workspace-tabs\s*\{[^}]*display:\s*flex;[^}]*height:\s*100%;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    styles,
    /\.workspace-tabs\s*>\s*\.ant-tabs-content-holder\s*\{[^}]*min-height:\s*0;[^}]*flex:\s*1;[^}]*overflow:\s*hidden;/s,
  );
});

test("model, MCP, capability, approval and context controls live in the composer", async () => {
  const source = await readFile(
    new URL("../src/sidepanel/components/ChatPanel.tsx", import.meta.url),
    "utf8",
  );
  const composerStart = source.indexOf('<div className="composer-footer">');
  const composerEnd = source.indexOf('<div className="composer-run-actions">');
  const composerControls = source.slice(composerStart, composerEnd);
  const statusControls = source.slice(
    source.indexOf('<div className="chat-status-row">'),
    source.indexOf('<div className="chat-messages"'),
  );

  assert.ok(composerStart >= 0 && composerEnd > composerStart);
  assert.match(composerControls, /className="composer-add-button"/);
  assert.match(composerControls, /label: "附加当前页截图"/);
  assert.match(composerControls, /label: "上传图片"/);
  assert.match(composerControls, /label: "导入文本文件"/);
  assert.match(composerControls, /className="composer-page-action"/);
  assert.match(composerControls, /aria-label="读取当前页面"/);
  assert.match(composerControls, /选择页面元素/);
  assert.match(composerControls, /<ModelProfileControl/);
  assert.match(composerControls, /<McpModeControl/);
  assert.match(composerControls, /className="composer-capability-trigger"/);
  assert.match(composerControls, /<ExecutionApprovalModeBar/);
  assert.match(composerControls, /className="context-usage-trigger"/);
  assert.doesNotMatch(statusControls, /<ModelProfileControl/);
  assert.doesNotMatch(statusControls, /className="chat-permission-row"/);
});

test("version and dropdown states stay visible and explain their active state", async () => {
  const [source, styles] = await Promise.all([
    readFile(
      new URL("../src/sidepanel/components/ChatPanel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/sidepanel/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /className=\{`chat-version-status/);
  assert.match(source, /`v\$\{runningVersion\} → v\$\{latestVersion\}`/);
  assert.match(source, /composer-control-chevron/);
  assert.match(source, /menuOpen \? " is-expanded" : ""/);
  assert.match(
    styles,
    /\.composer-control-chevron\.is-expanded\s*\{[^}]*rotate\(180deg\)/s,
  );
  assert.match(
    styles,
    /\.execution-approval-mode\.ant-btn\.is-agent\s*\{[^}]*#eff6ff/s,
  );
  assert.match(
    styles,
    /\.execution-approval-mode\.ant-btn\.is-ask:hover,[^}]*border-color:\s*#dce3eb;[^}]*background:\s*#f8fafc;/s,
  );

  const approvalControl = source.slice(
    source.indexOf("function ExecutionApprovalModeBar("),
    source.indexOf("function formatApprovalArguments("),
  );
  assert.match(approvalControl, /<Button[\s\S]*className=\{`execution-approval-mode/);
  assert.doesNotMatch(approvalControl, /<button/);

  const approvalStyles = styles.slice(
    styles.indexOf(".execution-approval-mode.ant-btn"),
    styles.indexOf(".disclosure-chevron"),
  );
  assert.doesNotMatch(approvalStyles, /justify-content:\s*space-between/);
  assert.doesNotMatch(styles, /\.composer-actions \.execution-approval-mode[^}]*min-width:\s*88px/s);

  const modelControl = source.slice(
    source.indexOf("function ModelProfileControl("),
    source.indexOf("function PermissionSwitch("),
  );
  assert.doesNotMatch(modelControl, /ThunderboltOutlined/);
});

test("composer controls keep readable widths instead of collapsing into each other", async () => {
  const styles = await readFile(
    new URL("../src/sidepanel/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(
    styles,
    /\.composer-actions\s*\{[^}]*flex:\s*1 1 auto;[^}]*overflow-x:\s*auto;[^}]*white-space:\s*nowrap;/s,
  );
  assert.match(
    styles,
    /\.composer-actions \.model-profile-button\.ant-btn,[^}]*\.composer-actions \.execution-approval-mode\.ant-btn\s*\{[^}]*flex:\s*0 0 auto;/s,
  );
  assert.match(
    styles,
    /\.composer-actions \.ant-btn,[^}]*\.composer-control\.ant-btn\s*\{[^}]*gap:\s*4px;/s,
  );
});

test("tool rows distinguish external MCP from built-in tools without competing accents", async () => {
  const [source, styles] = await Promise.all([
    readFile(
      new URL("../src/sidepanel/components/ChatPanel.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/sidepanel/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(
    source,
    /tool-message-source is-\$\{externalMcp \? "mcp" : "builtin"\}/,
  );
  assert.match(styles, /\.tool-message-source\.is-mcp\s*\{[^}]*#1677ff/s);
  assert.match(styles, /\.tool-message-source\.is-builtin\s*\{[^}]*#64748b/s);
});

test("closed execution targets are shown as unavailable and cannot offer a stale return action", async () => {
  const source = await readFile(
    new URL("../src/sidepanel/components/ChatPanel.tsx", import.meta.url),
    "utf8",
  );
  const targetBar = source.slice(
    source.indexOf("function ExecutionTargetBar("),
    source.indexOf("function ActivityMonitorBar("),
  );

  assert.match(targetBar, /目标页已关闭/);
  assert.match(targetBar, /页面相关工具不会再发送到该 Tab/);
  assert.match(targetBar, /viewingAnotherTab && !unavailable/);
});

test("sending from a different foreground tab requires an explicit target choice", async () => {
  const source = await readFile(
    new URL("../src/sidepanel/components/ChatPanel.tsx", import.meta.url),
    "utf8",
  );
  const bottomStack = source.slice(
    source.indexOf('<div className="chat-bottom-stack">'),
    source.indexOf(
      '<div className={`chat-composer ${composerFocused ? "chat-composer-focused" : ""}`}>',
    ),
  );
  const targetDecisionCard = source.slice(
    source.indexOf("function TargetBindingDecisionCard("),
    source.indexOf("function AgentBudgetDecisionCard("),
  );

  assert.match(source, /当前对话绑定页与正在浏览页不同/);
  assert.match(source, /继续原 Tab/);
  assert.match(source, /改绑当前 Tab/);
  assert.match(source, /新建对话并发送/);
  assert.match(bottomStack, /TargetBindingDecisionCard/);
  assert.match(
    targetDecisionCard,
    /className="tool-approval-card target-binding-decision-card"/,
  );
  assert.doesNotMatch(source, /<Modal/);
  assert.doesNotMatch(source, /新消息将作为独立任务排队到此页/);
});

test("a new chat binds the foreground tab without blocking general questions when no tab exists", async () => {
  const source = await readFile(
    new URL("../src/sidepanel/App.tsx", import.meta.url),
    "utf8",
  );
  const clearChat = source.slice(
    source.indexOf("const clearChat = () =>"),
    source.indexOf("const startConversationBranch ="),
  );
  const handleSend = source.slice(
    source.indexOf("const handleSendChat = ("),
    source.indexOf("const processNextQueuedSubmission ="),
  );

  assert.match(clearChat, /const target = toStoredConversationTarget\(/);
  assert.match(clearChat, /target,/);
  assert.doesNotMatch(handleSend, /请先打开一个可用页面，再发送这条消息/);
});

test("stop and interrupt supersede the active run without changing ordinary FIFO queueing", async () => {
  const source = await readFile(
    new URL("../src/sidepanel/App.tsx", import.meta.url),
    "utf8",
  );
  const runSubmission = source.slice(
    source.indexOf("const runChatSubmission = async"),
    source.indexOf("const processNextQueuedSubmission ="),
  );
  const sendChat = source.slice(
    source.indexOf("const handleSendChat = ("),
    source.indexOf("const removeQueuedChatSubmission ="),
  );
  const stopChat = source.slice(
    source.indexOf("const runQueuedChatSubmissionNow ="),
    source.indexOf("const requestToolApproval ="),
  );

  assert.match(runSubmission, /runId: agentRunId,[\s\S]*role: "user"/);
  assert.match(runSubmission, /supersedeConversationTask/);
  assert.match(runSubmission, /message\.runId !== submission\.supersedesRunId/);
  assert.match(runSubmission, /turnControl:[\s\S]*mode: "supersede"/);
  assert.match(sendChat, /mode === "interrupt" \? "front" : "back"/);
  assert.match(sendChat, /supersedeActiveAgentRun\(conversationId\)/);
  assert.match(stopChat, /const handleStopAi = \(\) => \{[\s\S]*supersedeActiveAgentRun\(conversationId\)/);
});

test("new MCP delegations create a dedicated collaboration conversation", async () => {
  const source = await readFile(
    new URL("../src/sidepanel/App.tsx", import.meta.url),
    "utf8",
  );
  const acceptTask = source.slice(
    source.indexOf("const acceptDelegatedTask = async"),
    source.indexOf("const restoreDelegatedTask = async"),
  );
  const restoreTask = source.slice(
    source.indexOf("const restoreDelegatedTask = async"),
    source.indexOf("const dismissDelegatedTask = async"),
  );

  assert.match(acceptTask, /shouldCreateMcpConversation/);
  assert.match(acceptTask, /kind: "mcp_collaboration"/);
  assert.match(acceptTask, /delegatedTaskId: task\.taskId/);
  assert.match(acceptTask, /toDelegatedTaskChatMessage\(task\)/);
  assert.match(acceptTask, /conversationId: acceptedConversationId/);
  assert.match(acceptTask, /restorePreviousConversation/);
  assert.match(restoreTask, /kind: "mcp_collaboration"/);
  assert.match(restoreTask, /toDelegatedTaskChatMessage\(task\)/);
  assert.doesNotMatch(restoreTask, /const messages = createInitialChat\(\)/);
});

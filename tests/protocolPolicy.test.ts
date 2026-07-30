import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PROTOCOL_VIOLATIONS,
  INBOUND_MESSAGE_BYTE_LIMITS,
  PROTOCOL_VIOLATION_WINDOW_MS,
  UNKNOWN_COMMAND_MAX_BYTES,
  consumeProtocolViolation,
  inboundMessageByteLimit,
  isCommandAllowedForRole,
  utf8MessageByteLength,
  type ProtocolViolationState,
} from "../src/mcp/protocolPolicy";
import { pluginToMcpMessageSchema } from "../src/mcp/wsSchemas";
import {
  sanitizeCollaborationItemInput,
  toCollaborationTargetBinding,
} from "../src/shared/collaborationWorkspace";
import {
  sanitizeBrowserActivityEventInput,
} from "../src/shared/browserActivity";
import {
  sanitizeActiveTabForMcp,
  sanitizePageSnapshotForMcp,
  WS_COMMANDS,
} from "../src/shared/wsProtocol";

test("protocol role policy permits only role-specific inbound commands", () => {
  assert.equal(
    isCommandAllowedForRole("browser", WS_COMMANDS.BROWSER_TOOL_RESULT),
    true,
  );
  assert.equal(
    isCommandAllowedForRole("browser", WS_COMMANDS.MCP_TOOL_CALL),
    false,
  );
  assert.equal(
    isCommandAllowedForRole("observer", WS_COMMANDS.MCP_LIST_TOOLS),
    true,
  );
  assert.equal(
    isCommandAllowedForRole("observer", WS_COMMANDS.MCP_TOOL_CALL),
    false,
  );
  assert.equal(
    isCommandAllowedForRole("mcp", WS_COMMANDS.ARTIFACT_GET),
    true,
  );
  assert.equal(
    isCommandAllowedForRole("mcp", WS_COMMANDS.APPROVAL_RESPONSE),
    false,
  );
  assert.equal(
    isCommandAllowedForRole("ui", WS_COMMANDS.COLLABORATION_ITEM_UPSERT),
    true,
  );
  assert.equal(
    isCommandAllowedForRole("mcp", WS_COMMANDS.COLLABORATION_ITEM_UPSERT),
    false,
  );
  assert.equal(
    isCommandAllowedForRole("ui", WS_COMMANDS.COLLABORATION_WORKSPACE_UPDATED),
    false,
  );
});

test("protocol commands have discoverable message-specific UTF-8 byte limits", () => {
  assert.equal(
    inboundMessageByteLimit(WS_COMMANDS.HEARTBEAT),
    2 * 1024,
  );
  assert.equal(
    inboundMessageByteLimit("UNKNOWN_COMMAND"),
    UNKNOWN_COMMAND_MAX_BYTES,
  );
  assert.equal(utf8MessageByteLength("页面"), Buffer.byteLength("页面", "utf8"));
  assert.equal(
    Object.values(INBOUND_MESSAGE_BYTE_LIMITS).every(
      (limit) => Number.isSafeInteger(limit) && limit > 0 && limit <= 8 * 1024 * 1024,
    ),
    true,
  );
});

test("protocol violations close at the threshold and reset after the window", () => {
  let current: ProtocolViolationState | undefined;
  for (let count = 1; count <= MAX_PROTOCOL_VIOLATIONS; count += 1) {
    const result = consumeProtocolViolation(current, 1_000 + count);
    current = result.state;
    assert.equal(result.shouldClose, count === MAX_PROTOCOL_VIOLATIONS);
  }

  assert.ok(current);
  const reset = consumeProtocolViolation(
    current,
    current.windowStartedAt + PROTOCOL_VIOLATION_WINDOW_MS,
  );
  assert.equal(reset.state.count, 1);
  assert.equal(reset.shouldClose, false);
});

test("sanitized page context stays within the websocket schema limits", () => {
  const url = "https://page-context.example/";
  const target = {
    url,
    title: "Fixture",
    targetId: "1234567890",
    tabId: 1,
    frameId: 0,
    documentId: "document-1",
    navigationId: "navigation-1",
    revision: 1,
  };
  const pageContext = sanitizePageSnapshotForMcp({
    url,
    title: "Fixture",
    origin: new URL(url).origin,
    capturedAt: "2026-07-14T00:00:00.000Z",
    visibleText: "visible text",
    domSummary: [],
    nodeCount: 1,
    truncated: false,
    semanticSnapshot: {
      version: "semantic-snapshot-v1",
      fingerprint: "1234abcd",
      nodes: [
        {
          ref: "s1",
          targetRef: "sr1_1234abcd_s1",
          role: "button",
          name: "n".repeat(400),
          selector: "#long-name",
          tagName: "button",
          bounds: { x: 0, y: 0, width: 120, height: 40 },
        },
      ],
      pagination: {
        offset: 0,
        limit: 10,
        returnedCount: 1,
        collectedCount: 1,
        totalKnown: true,
        hasMore: false,
      },
      stats: { sourceTruncated: false, outputChars: 400 },
    },
    provenance: {
      source: "chrome-content-script",
      observedAt: "2026-07-14T00:00:00.010Z",
      target,
    },
  });

  const parsed = pluginToMcpMessageSchema.safeParse({
    requestId: "page-context-schema-regression",
    command: WS_COMMANDS.PAGE_CONTEXT_UPDATED,
    sentAt: "2026-07-14T00:00:00.020Z",
    payload: { activeTab: target, pageContext },
  });

  assert.equal(pageContext.semanticSnapshot?.nodes[0]?.name.length, 240);
  assert.equal(
    pageContext.provenance?.target.targetId,
    sanitizeActiveTabForMcp(target).targetId,
  );
  assert.equal(parsed.success, true);
});

test("browser activity transport sanitizes long URLs and DOM samples before schema validation", () => {
  const event = sanitizeBrowserActivityEventInput({
    kind: "dom",
    observedAt: "2026-07-29T00:00:00.000Z",
    target: {
      url: `https://example.test/page?payload=${"页".repeat(20_000)}`,
      title: "页面".repeat(1_000),
      targetId: "target-1",
      tabId: 7,
      frameId: 0,
    },
    summary: {
      url: `https://example.test/api?payload=${"网".repeat(20_000)}`,
      message: "消息".repeat(10_000),
      domSamples: Array.from({ length: 30 }, (_, index) => ({
        changeType: index % 2 === 0 ? "added" as const : "text" as const,
        selector: `#${"选".repeat(2_000)}`,
        text: "内容".repeat(2_000),
      })),
      domSamplesOmitted: 18,
    },
  });
  const message = {
    requestId: "activity-schema-regression",
    command: WS_COMMANDS.BROWSER_ACTIVITY_EVENT,
    sentAt: "2026-07-29T00:00:00.010Z",
    payload: { event },
  };
  const serialized = JSON.stringify(message);
  const parsed = pluginToMcpMessageSchema.safeParse(message);

  assert.equal(parsed.success, true);
  assert.equal(event.summary.domSamples?.length, 12);
  assert.ok((event.summary.url?.length ?? 0) <= 1_200);
  assert.ok(
    utf8MessageByteLength(serialized) <=
      inboundMessageByteLimit(WS_COMMANDS.BROWSER_ACTIVITY_EVENT),
  );
});

test("collaboration publication schema accepts projected targets and rejects unbounded input", () => {
  const valid = pluginToMcpMessageSchema.safeParse({
    requestId: "collaboration-upsert",
    command: WS_COMMANDS.COLLABORATION_ITEM_UPSERT,
    sentAt: "2026-07-14T08:00:00.000Z",
    payload: {
      item: {
        id: "ctx_page_style",
        kind: "page.style",
        title: "Selected element style",
        summary: "Share only layout properties.",
        content: { display: "flex" },
        sensitivity: "page_content",
        target: toCollaborationTargetBinding({
          url: "https://example.test/form",
          title: "Page-only title",
          targetId: "target-a",
          tabId: 7,
          frameId: 0,
          navigationId: "navigation-a",
          revision: 12,
        }),
      },
    },
  });
  assert.equal(valid.success, true);

  const unprojectedPageTarget = pluginToMcpMessageSchema.safeParse({
    requestId: "collaboration-unprojected-target",
    command: WS_COMMANDS.COLLABORATION_ITEM_UPSERT,
    sentAt: "2026-07-14T08:00:00.000Z",
    payload: {
      item: {
        kind: "task.state",
        title: "Agent task",
        summary: "The strict collaboration binding must not receive page-only fields.",
        target: {
          url: "https://example.test/form",
          title: "Page-only title",
          targetId: "target-a",
          tabId: 7,
          frameId: 0,
          navigationId: "navigation-a",
          revision: 12,
        },
      },
    },
  });
  assert.equal(unprojectedPageTarget.success, false);

  const spoofed = pluginToMcpMessageSchema.safeParse({
    requestId: "collaboration-spoof",
    command: WS_COMMANDS.COLLABORATION_ITEM_UPSERT,
    sentAt: "2026-07-14T08:00:00.000Z",
    payload: {
      item: {
        kind: "note",
        title: "Spoofed",
        summary: "Must not choose a daemon-owned source.",
        source: { actor: "mcp_agent" },
      },
    },
  });
  assert.equal(spoofed.success, false);
});

test("collaboration transport bounds long Agent titles before websocket validation", () => {
  const item = sanitizeCollaborationItemInput({
    id: "ctx_task_long_title",
    kind: "task.state",
    title: "长任务标题".repeat(200),
    summary: "Agent task is running.",
    content: {
      status: "running",
      token: "must-not-cross-the-transport",
      optionalState: undefined,
      recentEvents: [undefined, { status: "running", detail: undefined }],
    },
    visibility: "shared",
    sensitivity: "page_content",
    status: "active",
  });
  const parsed = pluginToMcpMessageSchema.safeParse({
    requestId: "collaboration-long-title-regression",
    command: WS_COMMANDS.COLLABORATION_ITEM_UPSERT,
    sentAt: "2026-07-29T00:00:00.000Z",
    payload: { item },
  });

  assert.equal(parsed.success, true);
  assert.ok(item.title.length <= 240);
  assert.equal(JSON.stringify(item).includes("must-not-cross"), false);
  assert.deepEqual(item.content, {
    status: "running",
    token: "[redacted]",
    recentEvents: [null, { status: "running" }],
  });
});

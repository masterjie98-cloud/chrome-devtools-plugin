import type {
  DomElementInfo,
  DomSummaryNode,
  PageSnapshot,
  ScreenshotCaptureResult,
} from "./dom";
import { SUPPORTED_COMPUTED_STYLE_PROPERTIES } from "./dom";
import type { AgentSessionSnapshot } from "./agentSession";
import {
  SANITIZE_LIMITS,
  sanitizeAttributeValue,
  sanitizeHtmlSnippet,
  sanitizeText,
  sanitizeUrl,
} from "./sanitize";
import type { AnyToolCall, ToolName } from "./tools";
import type { ArtifactReference } from "./artifacts";
import type { SignedExecutionGrant } from "./executionGrant";
import type {
  SemanticSnapshotCollection,
  SemanticSnapshotNode,
} from "./semanticSnapshot";
import { redactSensitiveData } from "./sensitiveData";
import type {
  CollaborationItem,
  CollaborationItemInput,
  CollaborationWorkspaceSnapshot,
} from "./collaborationWorkspace";
import type { TaskGrantPrincipal } from "./taskCapabilityGrant";
import type {
  ToolApprovalMode,
  ToolCapability,
} from "./toolPolicy";

export const MCP_WS_URL = "ws://127.0.0.1:17321";
// Bump whenever an extension-visible tool/resource schema changes so a newly
// loaded extension cannot silently keep using an older daemon process.
export const WS_PROTOCOL_VERSION = 6;
export const WS_HEARTBEAT_INTERVAL_MS = 15_000;

export const WS_COMMANDS = {
  CLIENT_HELLO: "CLIENT_HELLO",
  SERVER_WELCOME: "SERVER_WELCOME",
  HEARTBEAT: "HEARTBEAT",
  ACTIVE_TAB_UPDATED: "ACTIVE_TAB_UPDATED",
  ELEMENT_SELECTED: "ELEMENT_SELECTED",
  PLUGIN_CHAT_MESSAGE_CREATED: "PLUGIN_CHAT_MESSAGE_CREATED",
  PLUGIN_CONVERSATION_STARTED: "PLUGIN_CONVERSATION_STARTED",
  SCREENSHOT_CAPTURED: "SCREENSHOT_CAPTURED",
  PAGE_CONTEXT_UPDATED: "PAGE_CONTEXT_UPDATED",
  AGENT_SESSION_SYNC: "AGENT_SESSION_SYNC",
  COLLABORATION_ITEM_UPSERT: "COLLABORATION_ITEM_UPSERT",
  COLLABORATION_WORKSPACE_UPDATED: "COLLABORATION_WORKSPACE_UPDATED",
  MCP_LIST_TOOLS: "MCP_LIST_TOOLS",
  MCP_LIST_TOOLS_RESULT: "MCP_LIST_TOOLS_RESULT",
  MCP_TOOL_CALL: "MCP_TOOL_CALL",
  MCP_TOOL_RESULT: "MCP_TOOL_RESULT",
  STATE_GET: "STATE_GET",
  STATE_GET_RESULT: "STATE_GET_RESULT",
  ARTIFACT_GET: "ARTIFACT_GET",
  ARTIFACT_GET_RESULT: "ARTIFACT_GET_RESULT",
  APPROVAL_REQUEST: "APPROVAL_REQUEST",
  APPROVAL_RESPONSE: "APPROVAL_RESPONSE",
  APPROVAL_CANCELLED: "APPROVAL_CANCELLED",
  TASK_GRANT_REVOKE: "TASK_GRANT_REVOKE",
  REQUEST_CANCEL: "REQUEST_CANCEL",
  BROWSER_TOOL_CALL: "BROWSER_TOOL_CALL",
  BROWSER_TOOL_RESULT: "BROWSER_TOOL_RESULT",
} as const;

export type WsCommand = (typeof WS_COMMANDS)[keyof typeof WS_COMMANDS];

export type WsClientRole = "plugin" | "observer" | "browser" | "ui" | "mcp";

export interface ClientHelloPayload {
  protocolVersion: number;
  clientRole: WsClientRole;
  clientName?: string;
  installationId?: string;
  sessionId?: string;
  bridgeToken?: string;
}

export interface HeartbeatPayload {
  sessionId?: string;
}

export interface ProtocolLimits {
  maxFrameBytes: number;
  maxInboundMessageBytes: Record<string, number>;
  maxConnections: number;
  maxMessagesPerMinute: number;
  clientHelloTimeoutMs: number;
  protocolViolationWindowMs: number;
  maxProtocolViolations: number;
  idleTimeoutMs: number;
  maxPendingBrowserTools: number;
  maxPendingApprovals: number;
  maxRequestDeadlineMs: number;
}

export interface ServerWelcomePayload {
  protocolVersion: number;
  connectionId: string;
  assignedRole: WsClientRole;
  sessionId?: string;
  limits: ProtocolLimits;
}

export interface ActiveTabSnapshot {
  url: string;
  title: string;
  targetId?: string;
  tabId?: number;
  windowId?: number;
  frameId?: number;
  documentId?: string;
  navigationId?: string;
  revision?: number;
}

export interface PluginChatMessageSnapshot {
  id: string;
  conversationId?: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
}

export interface PluginConversationStartedPayload {
  conversationId: string;
  startedAt: string;
}

export type ScreenshotSnapshot = ScreenshotCaptureResult;

export interface ElementSelectedPayload {
  activeTab: ActiveTabSnapshot;
  selectedElement: DomElementInfo;
}

export interface ActiveTabUpdatedPayload {
  activeTab: ActiveTabSnapshot;
}

export interface PluginChatMessageCreatedPayload {
  message: PluginChatMessageSnapshot;
}

export interface ScreenshotCapturedPayload {
  screenshot: ScreenshotSnapshot;
}

export interface PageContextUpdatedPayload {
  activeTab: ActiveTabSnapshot;
  pageContext: PageSnapshot;
}

export interface AgentSessionSyncPayload {
  session: AgentSessionSnapshot;
}

export interface CollaborationItemUpsertPayload {
  item: CollaborationItemInput;
}

export interface CollaborationWorkspaceUpdatedPayload {
  workspace: CollaborationWorkspaceSnapshot;
  item?: CollaborationItem;
}

export interface BrowserToolCallPayload {
  call: AnyToolCall;
  executionGrant: SignedExecutionGrant;
}

export interface McpAvailableTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
    [key: string]: unknown;
  };
  outputSchema?: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
    [key: string]: unknown;
  };
}

export interface McpListToolsPayload {
  includeExternal?: boolean;
}

export interface McpToolCallPayload {
  call: {
    toolName: string;
    args: Record<string, unknown>;
  };
  taskContext?: {
    taskId: string;
    egressDestinations: string[];
  };
}

export const DAEMON_STATE_RESOURCE_KEYS = [
  "activeTab",
  "selectedElement",
  "pluginConversation",
  "currentConversationId",
  "lastPluginMessage",
  "lastScreenshot",
  "pageContext",
  "contextDigest",
  "collaborationWorkspace",
  "agentSessions",
  "activeAgentSession",
  "lastAgentConclusion",
] as const;

export type DaemonStateResourceKey =
  (typeof DAEMON_STATE_RESOURCE_KEYS)[number];

export interface StateGetPayload {
  key: DaemonStateResourceKey;
  sessionId?: string;
}

export type StateGetResultPayload =
  | {
      ok: true;
      key: DaemonStateResourceKey;
      data: unknown;
    }
  | {
      ok: false;
      key?: DaemonStateResourceKey;
      error: string;
    };

export interface ArtifactGetPayload {
  artifactId: string;
}

export type ArtifactGetResultPayload =
  | {
      ok: true;
      artifact: ArtifactReference;
      dataBase64: string;
    }
  | {
      ok: false;
      artifactId: string;
      error: string;
    };

export interface ApprovalRequestPayload {
  approvalId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  policyClass: string;
  approvalMode: ToolApprovalMode;
  capability?: ToolCapability;
  reason: string;
  requestedAt: string;
  expiresAt?: string;
  sessionId: string;
  revision: number;
  requester: {
    role: WsClientRole;
    clientName?: string;
    connectionId: string;
  };
  target?: ActiveTabSnapshot;
  preview: {
    summary: string;
    egress: string[];
    sideEffects: string[];
  };
}

export interface ApprovalResponsePayload {
  approvalId: string;
  approved: boolean;
  respondedAt: string;
  rememberForTask?: {
    taskId: string;
    principals: TaskGrantPrincipal[];
    egressDestinations: string[];
    ttlMs?: number;
  };
}

export interface TaskGrantRevokePayload {
  taskId: string;
  reason: string;
}

export interface ApprovalCancelledPayload {
  approvalId: string;
  reason: string;
}

export interface RequestCancelPayload {
  targetRequestId: string;
  reason?: string;
}

export type ProtocolErrorCode =
  | "APPROVAL_DENIED"
  | "APPROVAL_REQUIRED"
  | "EXECUTION_GRANT_INVALID"
  | "IDEMPOTENCY_CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "REQUEST_CANCELLED"
  | "REQUEST_DEADLINE_EXCEEDED"
  | "ROLE_FORBIDDEN"
  | "STALE_CONTEXT"
  | "TOOL_FAILED";

export type BrowserToolResultPayload =
  | {
      ok: true;
      toolName: ToolName;
      data: unknown;
    }
  | {
      ok: false;
      errorCode?: ProtocolErrorCode;
      error: string;
      details?: unknown;
    };

export type McpToolResultPayload =
  | {
      ok: true;
      toolName: string;
      data: unknown;
    }
  | {
      ok: false;
      toolName?: string;
      errorCode?: ProtocolErrorCode;
      error: string;
      details?: unknown;
    };

export type McpListToolsResultPayload =
  | {
      ok: true;
      tools: McpAvailableTool[];
    }
  | {
      ok: false;
      error: string;
    };

export type PluginToMcpMessage =
  | {
      requestId: string;
      command: typeof WS_COMMANDS.CLIENT_HELLO;
      sentAt: string;
      payload: ClientHelloPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.HEARTBEAT;
      sentAt: string;
      payload: HeartbeatPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.ACTIVE_TAB_UPDATED;
      sentAt: string;
      payload: ActiveTabUpdatedPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.ELEMENT_SELECTED;
      sentAt: string;
      payload: ElementSelectedPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.PLUGIN_CHAT_MESSAGE_CREATED;
      sentAt: string;
      payload: PluginChatMessageCreatedPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.PLUGIN_CONVERSATION_STARTED;
      sentAt: string;
      payload: PluginConversationStartedPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.SCREENSHOT_CAPTURED;
      sentAt: string;
      payload: ScreenshotCapturedPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.PAGE_CONTEXT_UPDATED;
      sentAt: string;
      payload: PageContextUpdatedPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.AGENT_SESSION_SYNC;
      sentAt: string;
      payload: AgentSessionSyncPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.COLLABORATION_ITEM_UPSERT;
      sentAt: string;
      payload: CollaborationItemUpsertPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.COLLABORATION_WORKSPACE_UPDATED;
      sentAt: string;
      payload: CollaborationWorkspaceUpdatedPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.MCP_LIST_TOOLS;
      sentAt: string;
      payload: McpListToolsPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.MCP_TOOL_CALL;
      sentAt: string;
      deadlineAt?: string;
      idempotencyKey?: string;
      payload: McpToolCallPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.STATE_GET;
      sentAt: string;
      payload: StateGetPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.ARTIFACT_GET;
      sentAt: string;
      payload: ArtifactGetPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.APPROVAL_RESPONSE;
      sentAt: string;
      payload: ApprovalResponsePayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.TASK_GRANT_REVOKE;
      sentAt: string;
      payload: TaskGrantRevokePayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.REQUEST_CANCEL;
      sentAt: string;
      payload: RequestCancelPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.BROWSER_TOOL_CALL;
      sentAt: string;
      deadlineAt?: string;
      idempotencyKey?: string;
      payload: BrowserToolCallPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.BROWSER_TOOL_RESULT;
      sentAt: string;
      payload: BrowserToolResultPayload;
    };

export type McpToPluginMessage =
  | {
      requestId: string;
      command: typeof WS_COMMANDS.SERVER_WELCOME;
      sentAt: string;
      payload: ServerWelcomePayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.ACTIVE_TAB_UPDATED;
      sentAt: string;
      payload: ActiveTabUpdatedPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.ELEMENT_SELECTED;
      sentAt: string;
      payload: ElementSelectedPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.PLUGIN_CHAT_MESSAGE_CREATED;
      sentAt: string;
      payload: PluginChatMessageCreatedPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.PLUGIN_CONVERSATION_STARTED;
      sentAt: string;
      payload: PluginConversationStartedPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.SCREENSHOT_CAPTURED;
      sentAt: string;
      payload: ScreenshotCapturedPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.PAGE_CONTEXT_UPDATED;
      sentAt: string;
      payload: PageContextUpdatedPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.AGENT_SESSION_SYNC;
      sentAt: string;
      payload: AgentSessionSyncPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.COLLABORATION_WORKSPACE_UPDATED;
      sentAt: string;
      payload: CollaborationWorkspaceUpdatedPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.MCP_LIST_TOOLS_RESULT;
      sentAt: string;
      payload: McpListToolsResultPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.MCP_TOOL_RESULT;
      sentAt: string;
      payload: McpToolResultPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.STATE_GET_RESULT;
      sentAt: string;
      payload: StateGetResultPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.ARTIFACT_GET_RESULT;
      sentAt: string;
      payload: ArtifactGetResultPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.APPROVAL_REQUEST;
      sentAt: string;
      payload: ApprovalRequestPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.APPROVAL_CANCELLED;
      sentAt: string;
      payload: ApprovalCancelledPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.REQUEST_CANCEL;
      sentAt: string;
      payload: RequestCancelPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.BROWSER_TOOL_CALL;
      sentAt: string;
      deadlineAt?: string;
      idempotencyKey?: string;
      payload: BrowserToolCallPayload;
    }
  | {
      requestId: string;
      command: typeof WS_COMMANDS.BROWSER_TOOL_RESULT;
      sentAt: string;
      payload: BrowserToolResultPayload;
    };

export type McpWsAck =
  | {
      requestId: string;
      ok: true;
      receivedAt: string;
    }
  | {
      requestId: string;
      ok: false;
      receivedAt: string;
      error: string;
    };

const COMPUTED_STYLE_PROPERTY_SET = new Set<string>(
  SUPPORTED_COMPUTED_STYLE_PROPERTIES,
);

export function sanitizeElementForMcp(element: DomElementInfo): DomElementInfo {
  const computedStyle = Object.fromEntries(
    Object.entries(element.computedStyle)
      .filter(([key]) => COMPUTED_STYLE_PROPERTY_SET.has(key))
      .map(([key, value]) => [key, sanitizeText(value, 240)]),
  );

  const attributes = Object.fromEntries(
    Object.entries(element.attributes).map(([key, value]) => [
      key,
      sanitizeAttributeValue(key, value),
    ]),
  );

  return {
    ...element,
    id: element.id ? sanitizeText(element.id, 160) : undefined,
    className: element.className
      ? sanitizeText(element.className, 240)
      : undefined,
    text: element.text
      ? sanitizeText(element.text, SANITIZE_LIMITS.elementText)
      : undefined,
    outerHTML: sanitizeHtmlSnippet(
      element.outerHTML,
      SANITIZE_LIMITS.outerHTML,
    ),
    attributes,
    computedStyle,
  };
}

export function sanitizeActiveTabForMcp(
  activeTab: ActiveTabSnapshot,
): ActiveTabSnapshot {
  return {
    url: sanitizeUrl(activeTab.url),
    title: sanitizeText(activeTab.title, 300),
    targetId: activeTab.targetId
      ? boundOpaqueRoutingId(activeTab.targetId, 160)
      : undefined,
    tabId: activeTab.tabId,
    windowId: activeTab.windowId,
    frameId: activeTab.frameId,
    documentId: activeTab.documentId
      ? boundOpaqueRoutingId(activeTab.documentId, 300)
      : undefined,
    navigationId: activeTab.navigationId
      ? boundOpaqueRoutingId(activeTab.navigationId, 300)
      : undefined,
    revision: activeTab.revision,
  };
}

export function sanitizePageSnapshotForMcp(
  pageSnapshot: PageSnapshot,
): PageSnapshot {
  return {
    url: sanitizeUrl(pageSnapshot.url),
    title: sanitizeText(pageSnapshot.title, 300),
    origin: sanitizeUrl(pageSnapshot.origin),
    capturedAt: pageSnapshot.capturedAt,
    visibleText: sanitizeText(
      pageSnapshot.visibleText,
      SANITIZE_LIMITS.visibleText,
    ),
    domSummary: pageSnapshot.domSummary.map(sanitizeDomSummaryNode),
    nodeCount: pageSnapshot.nodeCount,
    truncated: pageSnapshot.truncated,
    mode: pageSnapshot.mode,
    sourceVisited: pageSnapshot.sourceVisited,
    sourceLimit: pageSnapshot.sourceLimit,
    domRevision: pageSnapshot.domRevision,
    delta: pageSnapshot.delta,
    timing: pageSnapshot.timing
      ? {
          totalMs: safeNonNegativeNumber(pageSnapshot.timing.totalMs),
          scanMs: safeNonNegativeNumber(pageSnapshot.timing.scanMs),
        }
      : undefined,
    semanticSnapshot: pageSnapshot.semanticSnapshot
      ? sanitizeSemanticSnapshot(pageSnapshot.semanticSnapshot)
      : undefined,
    provenance: pageSnapshot.provenance
      ? {
          source: "chrome-content-script",
          observedAt: sanitizeText(pageSnapshot.provenance.observedAt, 80),
          target: sanitizePageSnapshotTarget(pageSnapshot.provenance.target),
        }
      : undefined,
  };
}

function safeNonNegativeNumber(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function sanitizePageSnapshotTarget(
  target: import("./dom").PageSnapshotTarget,
): import("./dom").PageSnapshotTarget {
  return {
    url: sanitizeUrl(target.url),
    title: sanitizeText(target.title, 300),
    targetId: boundOpaqueRoutingId(target.targetId, 160),
    tabId: safeInteger(target.tabId),
    windowId:
      target.windowId === undefined ? undefined : safeInteger(target.windowId),
    frameId: safeInteger(target.frameId),
    documentId: target.documentId
      ? boundOpaqueRoutingId(target.documentId, 300)
      : undefined,
    navigationId: boundOpaqueRoutingId(target.navigationId, 300),
    revision: safeNonNegativeInteger(target.revision),
  };
}

function boundOpaqueRoutingId(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function sanitizeSemanticSnapshot(
  snapshot: SemanticSnapshotCollection,
): SemanticSnapshotCollection {
  return {
    version: "semantic-snapshot-v1",
    fingerprint: /^[a-f0-9]{8}$/.test(snapshot.fingerprint)
      ? snapshot.fingerprint
      : "00000000",
    nodes: snapshot.nodes.slice(0, 100).map(sanitizeSemanticSnapshotNode),
    pagination: {
      offset: safeNonNegativeInteger(snapshot.pagination.offset),
      limit: Math.min(100, Math.max(1, safeNonNegativeInteger(snapshot.pagination.limit))),
      returnedCount: safeNonNegativeInteger(snapshot.pagination.returnedCount),
      collectedCount: safeNonNegativeInteger(snapshot.pagination.collectedCount),
      totalKnown: Boolean(snapshot.pagination.totalKnown),
      hasMore: Boolean(snapshot.pagination.hasMore),
      nextCursor:
        snapshot.pagination.nextCursor &&
        /^ss1_[a-f0-9]{8}_\d{1,6}$/.test(snapshot.pagination.nextCursor)
          ? snapshot.pagination.nextCursor
          : undefined,
    },
    stats: {
      sourceTruncated: Boolean(snapshot.stats.sourceTruncated),
      outputChars: safeNonNegativeInteger(snapshot.stats.outputChars),
    },
  };
}

function sanitizeSemanticSnapshotNode(
  node: SemanticSnapshotNode,
): SemanticSnapshotNode {
  return {
    ref: /^s\d{1,6}$/.test(node.ref) ? node.ref : "s0",
    targetRef: /^sr1_[a-f0-9]{8}_s\d{1,6}$/.test(node.targetRef)
      ? node.targetRef
      : "sr1_00000000_s0",
    role: sanitizeText(node.role, 80),
    name: sanitizeText(node.name, 240),
    selector: sanitizeText(node.selector, 400),
    tagName: sanitizeText(node.tagName, 60),
    description: node.description
      ? sanitizeText(node.description, 300)
      : undefined,
    href: node.href ? sanitizeUrl(node.href) : undefined,
    disabled: node.disabled,
    checked: node.checked,
    pressed: node.pressed,
    expanded: node.expanded,
    selected: node.selected,
    required: node.required,
    readOnly: node.readOnly,
    focused: node.focused,
    level: node.level,
    bounds: {
      x: safeFiniteNumber(node.bounds.x),
      y: safeFiniteNumber(node.bounds.y),
      width: Math.max(0, safeFiniteNumber(node.bounds.width)),
      height: Math.max(0, safeFiniteNumber(node.bounds.height)),
    },
  };
}

function safeNonNegativeInteger(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeInteger(value: number): number {
  return Number.isSafeInteger(value) ? value : 0;
}

function safeFiniteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function sanitizeScreenshotForMcp(
  screenshot: ScreenshotSnapshot,
): ScreenshotSnapshot {
  const mimeType =
    screenshot.mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
  const prefix = `data:${mimeType};base64,`;

  return {
    capturedAt: screenshot.capturedAt,
    mimeType,
    dataUrl: screenshot.dataUrl.startsWith(prefix)
      ? screenshot.dataUrl
      : prefix,
    artifact: screenshot.artifact
      ? sanitizeArtifactReference(screenshot.artifact)
      : undefined,
    method: screenshot.method,
    fullPage: screenshot.fullPage,
    selector: screenshot.selector,
    width: screenshot.width,
    height: screenshot.height,
    filename: screenshot.filename,
    savedAs: screenshot.savedAs,
  };
}

function sanitizeArtifactReference(
  artifact: ArtifactReference,
): ArtifactReference | undefined {
  if (
    !/^art_[a-f0-9]{32}$/.test(artifact.id) ||
    artifact.uri !== `ai-devtools://artifact/${artifact.id}` ||
    !Number.isSafeInteger(artifact.byteLength) ||
    artifact.byteLength <= 0 ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256)
  ) {
    return undefined;
  }
  return {
    id: artifact.id,
    uri: artifact.uri,
    kind: artifact.kind,
    mimeType: sanitizeText(artifact.mimeType, 100),
    byteLength: artifact.byteLength,
    sha256: artifact.sha256,
    createdAt: artifact.createdAt,
    expiresAt: artifact.expiresAt,
  };
}

export function normalizeBrowserToolResultData(data: unknown): unknown {
  return data === undefined ? null : redactSensitiveData(data);
}

function sanitizeDomSummaryNode(node: DomSummaryNode): DomSummaryNode {
  return {
    tagName: sanitizeText(node.tagName, 60),
    selector: sanitizeText(node.selector, 400),
    id: node.id ? sanitizeText(node.id, 100) : undefined,
    className: node.className ? sanitizeText(node.className, 160) : undefined,
    role: node.role ? sanitizeText(node.role, 120) : undefined,
    ariaLabel: node.ariaLabel ? sanitizeText(node.ariaLabel, 160) : undefined,
    text: node.text
      ? sanitizeText(node.text, SANITIZE_LIMITS.domSummaryText)
      : undefined,
    childElementCount: node.childElementCount,
    children: node.children?.map(sanitizeDomSummaryNode),
  };
}

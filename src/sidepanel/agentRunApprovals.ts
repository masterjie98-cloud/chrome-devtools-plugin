import type { ApprovalRequestPayload } from "../shared/wsProtocol";

export type ToolApprovalDecision =
  | "deny"
  | "allow_once"
  | "allow_conversation_origin"
  | "allow_external_mcp";

export type ExecutionApprovalMode = "ask" | "agent" | "full";

export interface ConversationExecutionApproval {
  mode: Exclude<ExecutionApprovalMode, "ask">;
  conversationId: string;
  scope:
    | {
        kind: "origin";
        origin: string;
      }
    | {
        kind: "tab";
        tabId: number;
        targetId?: string;
      };
  sessionId: string;
  egressDestinations: string[];
}

export interface AgentConversationOriginApprovalScope {
  toolName: string;
  policyClass: string;
  approvalMode?: string;
  requester?: ApprovalRequestPayload["requester"];
  requesterOwnedByCurrentPanel?: boolean;
  sessionId?: string;
  target?: ApprovalRequestPayload["target"];
  egressDestinations?: string[];
}

export interface AgentConversationOriginApprovalGrant {
  conversationId: string;
  origin: string;
  sessionId: string;
  egressDestinations: string[];
  requesterRole: "ui" | "mcp";
}

export type AgentConversationOriginInvalidationReason =
  | "conversation_changed"
  | "origin_changed"
  | "target_changed"
  | "profile_changed"
  | "provider_changed";

const CONVERSATION_ORIGIN_POLICY_CLASSES = new Set([
  "sensitive_read",
  "reversible_write",
  "page_action",
]);

export function createConversationExecutionApproval(
  mode: ExecutionApprovalMode,
  current: {
    conversationId: string;
    pageUrl?: string;
    tabId?: number;
    targetId?: string;
    sessionId?: string;
    egressDestinations: string[];
  },
): ConversationExecutionApproval | null {
  const origin = getApprovalTargetOrigin(current.pageUrl);
  if (
    mode === "ask" ||
    !current.conversationId ||
    !current.sessionId
  ) {
    return null;
  }
  const scope =
    mode === "agent"
      ? origin
        ? ({ kind: "origin", origin } as const)
        : null
      : Number.isSafeInteger(current.tabId)
        ? ({
            kind: "tab",
            tabId: current.tabId as number,
            ...(current.targetId ? { targetId: current.targetId } : {}),
          } as const)
        : null;
  if (!scope) {
    return null;
  }
  return {
    mode,
    conversationId: current.conversationId,
    scope,
    sessionId: current.sessionId,
    egressDestinations: normalizeDestinations(current.egressDestinations),
  };
}

export function executionApprovalModeAllows(
  mode: ExecutionApprovalMode,
  approvalMode: string | undefined,
): boolean {
  if (mode === "full") {
    return (
      approvalMode === "task_grant" ||
      approvalMode === "decision_barrier" ||
      approvalMode === "always"
    );
  }
  return mode === "agent" && approvalMode === "task_grant";
}

export function matchesConversationExecutionApproval(
  approval: ConversationExecutionApproval,
  current: {
    conversationId: string;
    targetUrl?: string;
    targetTabId?: number;
    targetId?: string;
    sessionId?: string;
  },
): boolean {
  return (
    approval.conversationId === current.conversationId &&
    matchesExecutionApprovalScope(approval.scope, current) &&
    approval.sessionId === current.sessionId
  );
}

export function createAgentConversationOriginApprovalGrant(
  conversationId: string,
  scope: AgentConversationOriginApprovalScope,
): AgentConversationOriginApprovalGrant | null {
  const origin = getApprovalTargetOrigin(scope.target?.url);
  if (
    !conversationId ||
    !CONVERSATION_ORIGIN_POLICY_CLASSES.has(scope.policyClass) ||
    scope.approvalMode !== "task_grant" ||
    (scope.requester?.role !== "ui" && scope.requester?.role !== "mcp") ||
    (scope.requester.role === "ui" && !scope.requesterOwnedByCurrentPanel) ||
    !scope.sessionId ||
    !origin
  ) {
    return null;
  }

  return {
    conversationId,
    origin,
    sessionId: scope.sessionId,
    egressDestinations: normalizeDestinations(scope.egressDestinations),
    requesterRole: scope.requester.role,
  };
}

export function matchesAgentConversationOriginApproval(
  grant: AgentConversationOriginApprovalGrant,
  conversationId: string,
  scope: AgentConversationOriginApprovalScope,
): boolean {
  const candidate = createAgentConversationOriginApprovalGrant(
    conversationId,
    scope,
  );
  return Boolean(
    candidate &&
      candidate.conversationId === grant.conversationId &&
      candidate.origin === grant.origin &&
      candidate.sessionId === grant.sessionId &&
      candidate.requesterRole === grant.requesterRole &&
      arraysEqual(candidate.egressDestinations, grant.egressDestinations),
  );
}

export function getApprovalTargetOrigin(
  targetUrl: string | undefined,
): string | null {
  if (!targetUrl) {
    return null;
  }
  try {
    const parsed = new URL(targetUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

export function getAgentConversationOriginInvalidationReason(
  grant: AgentConversationOriginApprovalGrant | ConversationExecutionApproval,
  current: {
    conversationId: string;
    pageUrl?: string;
    tabId?: number;
    targetId?: string;
    sessionId?: string;
    hubConnected: boolean;
    egressDestinations: string[];
  },
): AgentConversationOriginInvalidationReason | null {
  if (grant.conversationId !== current.conversationId) {
    return "conversation_changed";
  }
  if ("scope" in grant) {
    if (
      grant.scope.kind === "origin" &&
      current.pageUrl &&
      getApprovalTargetOrigin(current.pageUrl) !== grant.scope.origin
    ) {
      return "origin_changed";
    }
    if (
      grant.scope.kind === "tab" &&
      ((current.tabId !== undefined && current.tabId !== grant.scope.tabId) ||
        (grant.scope.targetId !== undefined &&
          current.targetId !== undefined &&
          current.targetId !== grant.scope.targetId))
    ) {
      return "target_changed";
    }
  } else if (
    current.pageUrl &&
    getApprovalTargetOrigin(current.pageUrl) !== grant.origin
  ) {
    return "origin_changed";
  }
  if (current.sessionId && current.sessionId !== grant.sessionId) {
    return "profile_changed";
  }
  if (
    !arraysEqual(
      normalizeDestinations(current.egressDestinations),
      grant.egressDestinations,
    )
  ) {
    return "provider_changed";
  }
  return null;
}

function matchesExecutionApprovalScope(
  scope: ConversationExecutionApproval["scope"],
  current: {
    targetUrl?: string;
    targetTabId?: number;
    targetId?: string;
  },
): boolean {
  if (scope.kind === "origin") {
    return scope.origin === getApprovalTargetOrigin(current.targetUrl);
  }
  return (
    scope.tabId === current.targetTabId &&
    (!scope.targetId ||
      !current.targetId ||
      scope.targetId === current.targetId)
  );
}

export async function createAgentToolIdempotencyKey(
  agentRunId: string,
  toolCallId: string,
): Promise<string> {
  const canonical = JSON.stringify([agentRunId, toolCallId]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `agent:v1:${hex}`;
}

function normalizeDestinations(destinations: string[] | undefined): string[] {
  return [...new Set(destinations ?? [])].sort();
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

import type { ApprovalRequestPayload } from "../shared/wsProtocol";

export type ToolApprovalDecision =
  | "deny"
  | "allow_once"
  | "allow_conversation_origin";

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
  | "provider_changed"
  | "hub_disconnected";

const CONVERSATION_ORIGIN_POLICY_CLASSES = new Set([
  "sensitive_read",
  "reversible_write",
  "page_action",
]);

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
  grant: AgentConversationOriginApprovalGrant,
  current: {
    conversationId: string;
    pageUrl?: string;
    hubConnected: boolean;
    egressDestinations: string[];
  },
): AgentConversationOriginInvalidationReason | null {
  if (grant.conversationId !== current.conversationId) {
    return "conversation_changed";
  }
  if (
    current.pageUrl &&
    getApprovalTargetOrigin(current.pageUrl) !== grant.origin
  ) {
    return "origin_changed";
  }
  if (
    !arraysEqual(
      normalizeDestinations(current.egressDestinations),
      grant.egressDestinations,
    )
  ) {
    return "provider_changed";
  }
  return current.hubConnected ? null : "hub_disconnected";
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

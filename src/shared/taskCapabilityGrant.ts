import type {
  ToolApprovalMode,
  ToolCapability,
  ToolPolicy,
} from "./toolPolicy";
import type { ActiveTabSnapshot, WsClientRole } from "./wsProtocol";

export const TASK_CAPABILITY_GRANT_VERSION = 1 as const;
export const TASK_CAPABILITY_GRANT_TTL_MS = 60 * 60 * 1000;

export type TaskGrantPrincipal = Extract<WsClientRole, "ui" | "mcp">;

export interface TaskCapabilityGrant {
  version: typeof TASK_CAPABILITY_GRANT_VERSION;
  grantId: string;
  revision: number;
  taskId: string;
  sessionId: string;
  origin: string;
  targetId?: string;
  tabId?: number;
  principals: TaskGrantPrincipal[];
  requesterClientNames: string[];
  egressDestinations: string[];
  capabilities: ToolCapability[];
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string;
  revokeReason?: string;
}

export interface TaskGrantMatchContext {
  now?: number;
  taskId?: string;
  sessionId: string;
  requesterRole: WsClientRole;
  requesterClientName?: string;
  target?: ActiveTabSnapshot;
  egressDestinations: string[];
  policy: ToolPolicy;
}

export function normalizeHttpOrigin(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

export function isTaskGrantEligiblePolicy(policy: ToolPolicy): boolean {
  return policy.approvalMode === "task_grant" && Boolean(policy.capability);
}

export function matchesTaskCapabilityGrant(
  grant: TaskCapabilityGrant,
  context: TaskGrantMatchContext,
): boolean {
  if (
    grant.revokedAt ||
    Date.parse(grant.expiresAt) <= (context.now ?? Date.now()) ||
    !context.taskId ||
    grant.taskId !== context.taskId ||
    grant.sessionId !== context.sessionId ||
    !isTaskGrantPrincipal(context.requesterRole) ||
    !grant.principals.includes(context.requesterRole) ||
    !context.policy.capability ||
    !grant.capabilities.includes(context.policy.capability)
  ) {
    return false;
  }
  const origin = normalizeHttpOrigin(context.target?.url);
  if (!origin || origin !== grant.origin) {
    return false;
  }
  if (grant.tabId !== undefined && grant.tabId !== context.target?.tabId) {
    return false;
  }
  if (grant.targetId && grant.targetId !== context.target?.targetId) {
    return false;
  }
  if (
    grant.requesterClientNames.length > 0 &&
    (!context.requesterClientName ||
      !grant.requesterClientNames.includes(context.requesterClientName))
  ) {
    return false;
  }
  return arraysEqual(
    normalizeStrings(grant.egressDestinations),
    normalizeStrings(context.egressDestinations),
  );
}

export function approvalModeNeedsDecision(
  mode: ToolApprovalMode,
  hasMatchingTaskGrant: boolean,
): boolean {
  return mode !== "none" && !(mode === "task_grant" && hasMatchingTaskGrant);
}

export function isTaskGrantPrincipal(
  role: WsClientRole,
): role is TaskGrantPrincipal {
  return role === "ui" || role === "mcp";
}

export function normalizeStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

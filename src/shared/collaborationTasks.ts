import type {
  CollaborationItem,
  CollaborationJsonValue,
  CollaborationWorkspaceSnapshot,
} from "./collaborationWorkspace";

export const DELEGATED_TASK_VERSION = "delegated-task-v1" as const;
export const DELEGATED_TASK_ID_PATTERN = /^task_[A-Za-z0-9_-]{8,120}$/;
export const DELEGATED_TASK_CONVERSATION_KEY_PATTERN =
  /^conv_(?:[a-p]{4}){1,200}$/;

export const COLLABORATION_TOOL_NAMES = {
  PUBLISH_ITEM: "browser_publish_collaboration_item",
  DELEGATE_TASK: "browser_delegate_collaboration_task",
  WAIT_FOR_TASK_RESULT: "browser_wait_for_collaboration_result",
  CLAIM_TASK: "browser_claim_collaboration_task",
  COMPLETE_TASK: "browser_complete_collaboration_task",
} as const;

export const DELEGATED_TASK_REQUEST_TYPES = ["question", "task"] as const;
export type DelegatedTaskRequestType =
  (typeof DELEGATED_TASK_REQUEST_TYPES)[number];

export const DELEGATED_TASK_RESULT_STATUSES = [
  "completed",
  "failed",
  "rejected",
  "cancelled",
] as const;
export type DelegatedTaskResultStatus =
  (typeof DELEGATED_TASK_RESULT_STATUSES)[number];
export const DELEGATED_TASK_PHASES = [
  "pending",
  "claimed",
  ...DELEGATED_TASK_RESULT_STATUSES,
] as const;

export interface DelegatedTaskRequestContent {
  version: typeof DELEGATED_TASK_VERSION;
  type: "request";
  taskId: string;
  requestType: DelegatedTaskRequestType;
  instruction: string;
  acceptanceCriteria: string[];
  requestFingerprint: string;
}

export interface DelegatedTaskClaimContent {
  version: typeof DELEGATED_TASK_VERSION;
  type: "claim";
  taskId: string;
  attempt: number;
  claimedAt: string;
  resumed: boolean;
  requiresReobservation: boolean;
  conversationKey?: string;
}

export interface DelegatedTaskResultContent {
  version: typeof DELEGATED_TASK_VERSION;
  type: "result";
  taskId: string;
  status: DelegatedTaskResultStatus;
  summary: string;
  output?: CollaborationJsonValue;
  agentSessionId?: string;
  completedAt: string;
  resultFingerprint: string;
}

export type DelegatedTaskPhase = (typeof DELEGATED_TASK_PHASES)[number];

export interface DelegatedTaskSnapshot {
  taskId: string;
  phase: DelegatedTaskPhase;
  requestItem: CollaborationItem;
  request: DelegatedTaskRequestContent;
  claimItem?: CollaborationItem;
  claim?: DelegatedTaskClaimContent;
  resultItem?: CollaborationItem;
  result?: DelegatedTaskResultContent;
}

export function delegatedTaskRequestItemId(taskId: string): string {
  assertDelegatedTaskId(taskId);
  return `ctx_delegate_${taskId.slice("task_".length)}`;
}

export function delegatedTaskClaimItemId(taskId: string): string {
  assertDelegatedTaskId(taskId);
  return `ctx_claim_${taskId.slice("task_".length)}`;
}

export function delegatedTaskResultItemId(taskId: string): string {
  assertDelegatedTaskId(taskId);
  return `ctx_result_${taskId.slice("task_".length)}`;
}

export function assertDelegatedTaskId(taskId: string): void {
  if (!DELEGATED_TASK_ID_PATTERN.test(taskId)) {
    throw new Error(
      "Delegated task ID must match task_[A-Za-z0-9_-]{8,120}.",
    );
  }
}

export function listDelegatedTasks(
  workspace: CollaborationWorkspaceSnapshot | undefined,
): DelegatedTaskSnapshot[] {
  if (!workspace) {
    return [];
  }
  return workspace.items
    .flatMap((item) => {
      const request = parseDelegatedTaskRequest(item);
      if (!request) {
        return [];
      }
      const children = workspace.items.filter(
        (candidate) => candidate.parentId === item.id,
      );
      const claimEntries = children
        .map((candidate) => ({
          item: candidate,
          content: parseDelegatedTaskClaim(candidate),
        }))
        .filter(
          (
            candidate,
          ): candidate is {
            item: CollaborationItem;
            content: DelegatedTaskClaimContent;
          } => candidate.content?.taskId === request.taskId,
        )
        .sort((left, right) =>
          right.item.updatedAt.localeCompare(left.item.updatedAt),
        );
      const resultEntries = children
        .map((candidate) => ({
          item: candidate,
          content: parseDelegatedTaskResult(candidate),
        }))
        .filter(
          (
            candidate,
          ): candidate is {
            item: CollaborationItem;
            content: DelegatedTaskResultContent;
          } => candidate.content?.taskId === request.taskId,
        )
        .sort((left, right) =>
          right.item.updatedAt.localeCompare(left.item.updatedAt),
        );
      const claimEntry = claimEntries[0];
      const resultEntry = resultEntries[0];
      return [
        {
          taskId: request.taskId,
          phase: resultEntry
            ? resultEntry.content.status
            : claimEntry
              ? "claimed"
              : "pending",
          requestItem: item,
          request,
          claimItem: claimEntry?.item,
          claim: claimEntry?.content,
          resultItem: resultEntry?.item,
          result: resultEntry?.content,
        } satisfies DelegatedTaskSnapshot,
      ];
    })
    .sort((left, right) =>
      right.requestItem.createdAt.localeCompare(left.requestItem.createdAt),
    );
}

export function findDelegatedTask(
  workspace: CollaborationWorkspaceSnapshot | undefined,
  taskId: string,
): DelegatedTaskSnapshot | undefined {
  return listDelegatedTasks(workspace).find((task) => task.taskId === taskId);
}

export function delegatedTaskConversationKey(conversationId: string): string {
  const normalized = conversationId.trim();
  if (!isDelegatedTaskConversationId(normalized)) {
    throw new Error("Delegated task conversation ID is invalid.");
  }
  const alphabet = "abcdefghijklmnop";
  let encoded = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    encoded += alphabet[(code >>> 12) & 0x0f];
    encoded += alphabet[(code >>> 8) & 0x0f];
    encoded += alphabet[(code >>> 4) & 0x0f];
    encoded += alphabet[code & 0x0f];
  }
  return `conv_${encoded}`;
}

export function isDelegatedTaskConversationId(value: string): boolean {
  const normalized = value.trim();
  return Boolean(
    normalized &&
      normalized.length <= 200 &&
      !/[\u0000-\u001f\u007f]/.test(normalized),
  );
}

export function isDelegatedTaskBoundToConversation(
  task: DelegatedTaskSnapshot,
  conversationId: string,
): boolean {
  if (!isDelegatedTaskConversationId(conversationId)) {
    return false;
  }
  return task.claim?.conversationKey === delegatedTaskConversationKey(conversationId);
}

export function isDelegatedTaskInboxActionable(
  task: DelegatedTaskSnapshot,
): boolean {
  return (
    task.claim?.conversationKey === undefined &&
    (task.phase === "pending" || task.phase === "claimed")
  );
}

export function parseDelegatedTaskRequest(
  item: CollaborationItem,
): DelegatedTaskRequestContent | undefined {
  if (
    item.kind !== "task.request" ||
    item.source.actor !== "mcp_agent" ||
    !isRecord(item.content) ||
    item.content.version !== DELEGATED_TASK_VERSION ||
    item.content.type !== "request" ||
    typeof item.content.taskId !== "string" ||
    !DELEGATED_TASK_ID_PATTERN.test(item.content.taskId) ||
    !isDelegatedTaskRequestType(item.content.requestType) ||
    typeof item.content.instruction !== "string" ||
    !Array.isArray(item.content.acceptanceCriteria) ||
    !item.content.acceptanceCriteria.every(
      (criterion) => typeof criterion === "string",
    ) ||
    typeof item.content.requestFingerprint !== "string"
  ) {
    return undefined;
  }
  return {
    version: DELEGATED_TASK_VERSION,
    type: "request",
    taskId: item.content.taskId,
    requestType: item.content.requestType,
    instruction: item.content.instruction,
    acceptanceCriteria: [...item.content.acceptanceCriteria],
    requestFingerprint: item.content.requestFingerprint,
  };
}

export function parseDelegatedTaskClaim(
  item: CollaborationItem,
): DelegatedTaskClaimContent | undefined {
  if (
    item.kind !== "task.state" ||
    item.source.actor !== "extension_agent" ||
    !isRecord(item.content) ||
    item.content.version !== DELEGATED_TASK_VERSION ||
    item.content.type !== "claim" ||
    typeof item.content.taskId !== "string" ||
    !DELEGATED_TASK_ID_PATTERN.test(item.content.taskId) ||
    !Number.isSafeInteger(item.content.attempt) ||
    Number(item.content.attempt) < 1 ||
    typeof item.content.resumed !== "boolean" ||
    typeof item.content.requiresReobservation !== "boolean" ||
    (item.content.conversationKey !== undefined &&
      (typeof item.content.conversationKey !== "string" ||
        !DELEGATED_TASK_CONVERSATION_KEY_PATTERN.test(
          item.content.conversationKey,
        )))
  ) {
    return undefined;
  }
  return {
    version: DELEGATED_TASK_VERSION,
    type: "claim",
    taskId: item.content.taskId,
    attempt: Number(item.content.attempt),
    claimedAt: item.updatedAt,
    resumed: item.content.resumed,
    requiresReobservation: item.content.requiresReobservation,
    conversationKey: item.content.conversationKey as string | undefined,
  };
}

export function parseDelegatedTaskResult(
  item: CollaborationItem,
): DelegatedTaskResultContent | undefined {
  if (
    item.kind !== "task.result" ||
    item.source.actor !== "extension_agent" ||
    !isRecord(item.content) ||
    item.content.version !== DELEGATED_TASK_VERSION ||
    item.content.type !== "result" ||
    typeof item.content.taskId !== "string" ||
    !DELEGATED_TASK_ID_PATTERN.test(item.content.taskId) ||
    !isDelegatedTaskResultStatus(item.content.status) ||
    typeof item.content.summary !== "string" ||
    typeof item.content.resultFingerprint !== "string" ||
    (item.content.agentSessionId !== undefined &&
      typeof item.content.agentSessionId !== "string")
  ) {
    return undefined;
  }
  return {
    version: DELEGATED_TASK_VERSION,
    type: "result",
    taskId: item.content.taskId,
    status: item.content.status,
    summary: item.content.summary,
    output: item.content.output as CollaborationJsonValue | undefined,
    agentSessionId: item.content.agentSessionId,
    completedAt: item.updatedAt,
    resultFingerprint: item.content.resultFingerprint,
  };
}

function isDelegatedTaskRequestType(
  value: unknown,
): value is DelegatedTaskRequestType {
  return DELEGATED_TASK_REQUEST_TYPES.includes(
    value as DelegatedTaskRequestType,
  );
}

function isDelegatedTaskResultStatus(
  value: unknown,
): value is DelegatedTaskResultStatus {
  return DELEGATED_TASK_RESULT_STATUSES.includes(
    value as DelegatedTaskResultStatus,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

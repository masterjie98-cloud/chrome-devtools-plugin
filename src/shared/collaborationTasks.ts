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
  UPDATE_TASK: "browser_update_collaboration_task",
  CANCEL_TASK: "browser_cancel_collaboration_task",
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
export const DELEGATED_TASK_EVENT_TYPES = [
  "progress",
  "clarification",
  "requirement",
  "evidence",
] as const;
export type DelegatedTaskEventType =
  (typeof DELEGATED_TASK_EVENT_TYPES)[number];
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
  rebound: boolean;
  previousConversationKey?: string;
  reboundAt?: string;
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

export interface DelegatedTaskEventContent {
  version: typeof DELEGATED_TASK_VERSION;
  type: "event";
  taskId: string;
  eventId: string;
  eventType: DelegatedTaskEventType;
  message: string;
  progress?: number;
  requirements?: string[];
  artifactUris?: string[];
  eventFingerprint: string;
  publishedAt: string;
}

export type DelegatedTaskPhase = (typeof DELEGATED_TASK_PHASES)[number];

export interface DelegatedTaskSnapshot {
  taskId: string;
  phase: DelegatedTaskPhase;
  requestItem: CollaborationItem;
  request: DelegatedTaskRequestContent;
  claimItem?: CollaborationItem;
  claim?: DelegatedTaskClaimContent;
  events: Array<{
    item: CollaborationItem;
    content: DelegatedTaskEventContent;
  }>;
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

export function delegatedTaskEventItemId(
  taskId: string,
  eventId: string,
): string {
  assertDelegatedTaskId(taskId);
  if (!/^evt_[A-Za-z0-9_-]{8,80}$/.test(eventId)) {
    throw new Error(
      "Delegated task event ID must match evt_[A-Za-z0-9_-]{8,80}.",
    );
  }
  const itemId =
    `ctx_event_${taskId.slice("task_".length)}_${eventId.slice("evt_".length)}`;
  if (itemId.length <= 200) {
    return itemId;
  }
  const suffix = stableIdFingerprint(itemId);
  return `${itemId.slice(0, 200 - suffix.length - 1)}_${suffix}`;
}

function stableIdFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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
      const eventEntries = children
        .map((candidate) => ({
          item: candidate,
          content: parseDelegatedTaskEvent(candidate),
        }))
        .filter(
          (
            candidate,
          ): candidate is {
            item: CollaborationItem;
            content: DelegatedTaskEventContent;
          } => candidate.content?.taskId === request.taskId,
        )
        .sort((left, right) =>
          left.item.createdAt.localeCompare(right.item.createdAt),
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
          events: eventEntries,
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

export function decodeDelegatedTaskConversationKey(
  conversationKey: string,
): string | undefined {
  if (!DELEGATED_TASK_CONVERSATION_KEY_PATTERN.test(conversationKey)) {
    return undefined;
  }
  const alphabet = "abcdefghijklmnop";
  const encoded = conversationKey.slice("conv_".length);
  let decoded = "";
  for (let index = 0; index < encoded.length; index += 4) {
    const a = alphabet.indexOf(encoded[index] ?? "");
    const b = alphabet.indexOf(encoded[index + 1] ?? "");
    const c = alphabet.indexOf(encoded[index + 2] ?? "");
    const d = alphabet.indexOf(encoded[index + 3] ?? "");
    if (a < 0 || b < 0 || c < 0 || d < 0) {
      return undefined;
    }
    decoded += String.fromCharCode((a << 12) | (b << 8) | (c << 4) | d);
  }
  return isDelegatedTaskConversationId(decoded) ? decoded : undefined;
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
  knownConversationIds?: readonly string[],
): boolean {
  const knownConversationKeys = new Set(
    (knownConversationIds ?? [])
      .filter(isDelegatedTaskConversationId)
      .map(delegatedTaskConversationKey),
  );
  return (
    (task.claim?.conversationKey === undefined ||
      (knownConversationIds !== undefined &&
        !task.result &&
        !knownConversationKeys.has(task.claim.conversationKey))) &&
    (task.phase === "pending" || task.phase === "claimed")
  );
}

export function isDelegatedTaskOrphaned(
  task: DelegatedTaskSnapshot,
  knownConversationIds: readonly string[],
): boolean {
  if (!task.claim?.conversationKey || task.result) {
    return false;
  }
  return !knownConversationIds
    .filter(isDelegatedTaskConversationId)
    .map(delegatedTaskConversationKey)
    .includes(task.claim.conversationKey);
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
    (item.content.rebound !== undefined &&
      typeof item.content.rebound !== "boolean") ||
    (item.content.conversationKey !== undefined &&
      (typeof item.content.conversationKey !== "string" ||
        !DELEGATED_TASK_CONVERSATION_KEY_PATTERN.test(
          item.content.conversationKey,
        ))) ||
    (item.content.previousConversationKey !== undefined &&
      (typeof item.content.previousConversationKey !== "string" ||
        !DELEGATED_TASK_CONVERSATION_KEY_PATTERN.test(
          item.content.previousConversationKey,
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
    rebound: item.content.rebound === true,
    previousConversationKey: item.content.previousConversationKey as
      | string
      | undefined,
    reboundAt: item.content.rebound === true ? item.updatedAt : undefined,
  };
}

export function parseDelegatedTaskResult(
  item: CollaborationItem,
): DelegatedTaskResultContent | undefined {
  if (
    item.kind !== "task.result" ||
    (item.source.actor !== "extension_agent" &&
      !(
        item.source.actor === "mcp_agent" &&
        isRecord(item.content) &&
        item.content.status === "cancelled"
      )) ||
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

export function parseDelegatedTaskEvent(
  item: CollaborationItem,
): DelegatedTaskEventContent | undefined {
  if (
    item.kind !== "task.state" ||
    (item.source.actor !== "extension_agent" &&
      item.source.actor !== "mcp_agent") ||
    !isRecord(item.content) ||
    item.content.version !== DELEGATED_TASK_VERSION ||
    item.content.type !== "event" ||
    typeof item.content.taskId !== "string" ||
    !DELEGATED_TASK_ID_PATTERN.test(item.content.taskId) ||
    typeof item.content.eventId !== "string" ||
    !/^evt_[A-Za-z0-9_-]{8,80}$/.test(item.content.eventId) ||
    !DELEGATED_TASK_EVENT_TYPES.includes(
      item.content.eventType as DelegatedTaskEventType,
    ) ||
    typeof item.content.message !== "string" ||
    typeof item.content.eventFingerprint !== "string" ||
    (item.content.progress !== undefined &&
      (typeof item.content.progress !== "number" ||
        item.content.progress < 0 ||
        item.content.progress > 100)) ||
    (item.content.requirements !== undefined &&
      (!Array.isArray(item.content.requirements) ||
        !item.content.requirements.every((value) => typeof value === "string"))) ||
    (item.content.artifactUris !== undefined &&
      (!Array.isArray(item.content.artifactUris) ||
        !item.content.artifactUris.every((value) => typeof value === "string")))
  ) {
    return undefined;
  }
  return {
    version: DELEGATED_TASK_VERSION,
    type: "event",
    taskId: item.content.taskId,
    eventId: item.content.eventId,
    eventType: item.content.eventType as DelegatedTaskEventType,
    message: item.content.message,
    progress: item.content.progress as number | undefined,
    requirements: item.content.requirements as string[] | undefined,
    artifactUris: item.content.artifactUris as string[] | undefined,
    eventFingerprint: item.content.eventFingerprint,
    publishedAt: item.updatedAt,
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

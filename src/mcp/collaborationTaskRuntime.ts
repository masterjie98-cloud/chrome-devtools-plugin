import { createHash } from "node:crypto";
import type { ActiveTabSnapshot } from "../shared/wsProtocol";
import type {
  CollaborationItem,
  CollaborationWorkspaceMutationResult,
} from "../shared/collaborationWorkspace";
import {
  DELEGATED_TASK_VERSION,
  delegatedTaskConversationKey,
  delegatedTaskClaimItemId,
  delegatedTaskEventItemId,
  delegatedTaskRequestItemId,
  delegatedTaskResultItemId,
  findDelegatedTask,
  type DelegatedTaskResultStatus,
} from "../shared/collaborationTasks";
import {
  browserStateHub,
  type BrowserStateHub,
} from "./browserStateHub";
import type {
  claimCollaborationTaskInputSchema,
  cancelCollaborationTaskInputSchema,
  completeCollaborationTaskInputSchema,
  delegateCollaborationTaskInputSchema,
  updateCollaborationTaskInputSchema,
} from "./collaborationTools";
import { ExecutionBrokerError } from "../daemon/executionBroker";
import type { z } from "zod";

type DelegateArgs = z.infer<typeof delegateCollaborationTaskInputSchema>;
type ClaimArgs = z.infer<typeof claimCollaborationTaskInputSchema>;
type CompleteArgs = z.infer<typeof completeCollaborationTaskInputSchema>;
type UpdateArgs = z.infer<typeof updateCollaborationTaskInputSchema>;
type CancelArgs = z.infer<typeof cancelCollaborationTaskInputSchema>;

export interface CollaborationTaskMutation<T> {
  data: T;
  mutation?: CollaborationWorkspaceMutationResult;
}

export function delegateCollaborationTask(
  args: DelegateArgs,
  sessionId: string,
  clientId: string,
  hub: BrowserStateHub = browserStateHub,
): CollaborationTaskMutation<Record<string, unknown>> {
  const snapshot = hub.snapshot(sessionId);
  const target = args.scope === "target" ? snapshot.currentTab : undefined;
  if (args.scope === "target" && !target) {
    throw new ExecutionBrokerError(
      "STALE_CONTEXT",
      "The selected Chrome Profile has no current page target for this delegated task.",
    );
  }
  const fingerprint = hashStable({
    taskId: args.taskId,
    requestType: args.requestType,
    title: args.title,
    instruction: args.instruction,
    acceptanceCriteria: args.acceptanceCriteria,
    scope: args.scope,
    sensitivity: args.sensitivity,
    expiresAt: args.expiresAt ?? null,
    target: target ?? null,
  });
  const existing = findDelegatedTask(
    snapshot.collaborationWorkspace,
    args.taskId,
  );
  if (existing) {
    if (existing.request.requestFingerprint !== fingerprint) {
      throw new ExecutionBrokerError(
        "IDEMPOTENCY_CONFLICT",
        `taskId ${args.taskId} already belongs to a different delegated request.`,
      );
    }
    return {
      data: {
        taskId: args.taskId,
        state: existing.phase,
        deduplicated: true,
        workspaceRevision: snapshot.collaborationWorkspace.revision,
        item: existing.requestItem,
        ...(existing.resultItem ? { resultItem: existing.resultItem } : {}),
      },
    };
  }

  const mutation = hub.upsertCollaborationItem(
    {
      id: delegatedTaskRequestItemId(args.taskId),
      kind: "task.request",
      title: args.title,
      summary: args.instruction.slice(0, 2000),
      content: {
        version: DELEGATED_TASK_VERSION,
        type: "request",
        taskId: args.taskId,
        requestType: args.requestType,
        instruction: args.instruction,
        acceptanceCriteria: args.acceptanceCriteria,
        requestFingerprint: fingerprint,
      },
      tags: ["delegated-task", args.requestType],
      visibility: "shared",
      sensitivity: args.sensitivity,
      status: "active",
      target,
      expiresAt: args.expiresAt,
    },
    { actor: "mcp_agent", clientId },
    sessionId,
  );
  return {
    mutation,
    data: {
      taskId: args.taskId,
      state: "pending",
      deduplicated: false,
      workspaceRevision: mutation.workspace.revision,
      item: mutation.item,
    },
  };
}

export function claimCollaborationTask(
  args: ClaimArgs,
  sessionId: string,
  clientId: string,
  hub: BrowserStateHub = browserStateHub,
): CollaborationTaskMutation<Record<string, unknown>> {
  const snapshot = hub.snapshot(sessionId);
  const task = requireDelegatedTask(snapshot.collaborationWorkspace, args.taskId);
  if (task.result) {
    throw new ExecutionBrokerError(
      "IDEMPOTENCY_CONFLICT",
      `Delegated task ${args.taskId} is already ${task.result.status}.`,
    );
  }
  assertTaskTargetFresh(task.requestItem.target, snapshot.currentTab);
  const conversationKey = delegatedTaskConversationKey(args.conversationId);
  if (
    task.claim?.conversationKey &&
    task.claim.conversationKey !== conversationKey
  ) {
    throw new ExecutionBrokerError(
      "STALE_CONTEXT",
      `Delegated task ${args.taskId} is bound to another plugin conversation. Open that conversation before resuming it.`,
    );
  }

  if (task.claim && !args.resume) {
    return {
      data: {
        taskId: args.taskId,
        claimed: false,
        resumed: task.claim.resumed,
        attempt: task.claim.attempt,
        workspaceRevision: snapshot.collaborationWorkspace.revision,
        claimItem: task.claimItem,
      },
    };
  }

  const attempt = (task.claim?.attempt ?? 0) + 1;
  const resumed = Boolean(task.claim);
  const mutation = hub.upsertCollaborationItem(
    {
      id: delegatedTaskClaimItemId(args.taskId),
      kind: "task.state",
      title: `Accepted: ${task.requestItem.title}`,
      summary: resumed
        ? "The user explicitly resumed this task after a previous sidepanel run stopped or disconnected. Re-observe before any write."
        : "The user accepted this delegated task in the extension inbox.",
      content: {
        version: DELEGATED_TASK_VERSION,
        type: "claim",
        taskId: args.taskId,
        attempt,
        resumed,
        requiresReobservation: resumed,
        conversationKey,
      },
      tags: ["delegated-task", resumed ? "resume" : "accepted"],
      visibility: "shared",
      sensitivity: task.requestItem.sensitivity,
      status: "active",
      parentId: task.requestItem.id,
      expectedRevision: task.claimItem?.revision,
      target: task.requestItem.target,
    },
    { actor: "extension_agent", clientId },
    sessionId,
  );
  return {
    mutation,
    data: {
      taskId: args.taskId,
      claimed: true,
      resumed,
      attempt,
      workspaceRevision: mutation.workspace.revision,
      claimItem: mutation.item,
    },
  };
}

export function completeCollaborationTask(
  args: CompleteArgs,
  sessionId: string,
  clientId: string,
  hub: BrowserStateHub = browserStateHub,
  actor: "extension_agent" | "mcp_agent" = "extension_agent",
): CollaborationTaskMutation<Record<string, unknown>> {
  if (actor === "mcp_agent" && args.status !== "cancelled") {
    throw new ExecutionBrokerError(
      "ROLE_FORBIDDEN",
      "The MCP Agent may cancel delegated work but cannot publish an extension Agent result.",
    );
  }
  const snapshot = hub.snapshot(sessionId);
  const task = requireDelegatedTask(snapshot.collaborationWorkspace, args.taskId);
  const staleUnclaimedCancellation =
    args.status === "cancelled" &&
    !task.claim &&
    task.requestItem.target !== undefined &&
    getTaskTargetMismatches(task.requestItem.target, snapshot.currentTab).length >
      0;
  if (
    args.status !== "rejected" &&
    !task.claim &&
    !staleUnclaimedCancellation &&
    actor !== "mcp_agent"
  ) {
    throw new ExecutionBrokerError(
      "ROLE_FORBIDDEN",
      `Delegated task ${args.taskId} must be accepted before it can finish as ${args.status}.`,
    );
  }
  const resultFingerprint = hashStable({
    taskId: args.taskId,
    status: args.status,
    summary: args.summary,
    output: args.output ?? null,
    agentSessionId: args.agentSessionId ?? null,
  });
  if (task.result && task.resultItem) {
    if (task.result.resultFingerprint !== resultFingerprint) {
      throw new ExecutionBrokerError(
        "IDEMPOTENCY_CONFLICT",
        `Delegated task ${args.taskId} already has an immutable ${task.result.status} result.`,
      );
    }
    return {
      data: {
        taskId: args.taskId,
        status: task.result.status,
        deduplicated: true,
        workspaceRevision: snapshot.collaborationWorkspace.revision,
        resultItem: task.resultItem,
      },
    };
  }
  if (task.claim && actor === "extension_agent") {
    if (!task.claim.conversationKey) {
      throw new ExecutionBrokerError(
        "ROLE_FORBIDDEN",
        `Delegated task ${args.taskId} was accepted before conversation binding existed. Explicitly resume it in a plugin conversation before completing it.`,
      );
    }
    if (!args.conversationId) {
      throw new ExecutionBrokerError(
        "ROLE_FORBIDDEN",
        `Delegated task ${args.taskId} completion requires its bound plugin conversation.`,
      );
    }
    if (
      task.claim.conversationKey !==
      delegatedTaskConversationKey(args.conversationId)
    ) {
      throw new ExecutionBrokerError(
        "STALE_CONTEXT",
        `Delegated task ${args.taskId} cannot be completed from another plugin conversation.`,
      );
    }
  }

  const mutation = hub.upsertCollaborationItem(
    {
      id: delegatedTaskResultItemId(args.taskId),
      kind: "task.result",
      title: `Result: ${task.requestItem.title}`,
      summary: args.summary,
      content: {
        version: DELEGATED_TASK_VERSION,
        type: "result",
        taskId: args.taskId,
        status: args.status,
        summary: args.summary,
        ...(args.output !== undefined ? { output: args.output } : {}),
        ...(args.agentSessionId !== undefined
          ? { agentSessionId: args.agentSessionId }
          : {}),
        resultFingerprint,
      },
      tags: ["delegated-task", "result", args.status],
      visibility: "shared",
      sensitivity: task.requestItem.sensitivity,
      status: "resolved",
      parentId: task.requestItem.id,
      target: task.requestItem.target,
    },
    { actor, clientId },
    sessionId,
  );
  return {
    mutation,
    data: {
      taskId: args.taskId,
      status: args.status,
      deduplicated: false,
      workspaceRevision: mutation.workspace.revision,
      resultItem: mutation.item,
    },
  };
}

export function updateCollaborationTask(
  args: UpdateArgs,
  sessionId: string,
  clientId: string,
  actor: "extension_agent" | "mcp_agent",
  hub: BrowserStateHub = browserStateHub,
): CollaborationTaskMutation<Record<string, unknown>> {
  const snapshot = hub.snapshot(sessionId);
  const task = requireDelegatedTask(snapshot.collaborationWorkspace, args.taskId);
  if (task.result) {
    throw new ExecutionBrokerError(
      "IDEMPOTENCY_CONFLICT",
      `Delegated task ${args.taskId} is already ${task.result.status}.`,
    );
  }
  if (actor === "extension_agent") {
    if (!task.claim?.conversationKey || !args.conversationId) {
      throw new ExecutionBrokerError(
        "ROLE_FORBIDDEN",
        `Delegated task ${args.taskId} progress requires its bound plugin conversation.`,
      );
    }
    if (
      task.claim.conversationKey !==
      delegatedTaskConversationKey(args.conversationId)
    ) {
      throw new ExecutionBrokerError(
        "STALE_CONTEXT",
        `Delegated task ${args.taskId} cannot be updated from another plugin conversation.`,
      );
    }
  }

  const eventFingerprint = hashStable({
    taskId: args.taskId,
    eventId: args.eventId,
    eventType: args.eventType,
    message: args.message,
    progress: args.progress ?? null,
    requirements: args.requirements ?? null,
    artifactUris: args.artifactUris ?? null,
    actor,
  });
  const itemId = delegatedTaskEventItemId(args.taskId, args.eventId);
  const existing = snapshot.collaborationWorkspace.items.find(
    (item) => item.id === itemId,
  );
  if (existing) {
    const content =
      existing.content && typeof existing.content === "object"
        ? (existing.content as Record<string, unknown>)
        : {};
    if (content.eventFingerprint !== eventFingerprint) {
      throw new ExecutionBrokerError(
        "IDEMPOTENCY_CONFLICT",
        `eventId ${args.eventId} already belongs to different task progress.`,
      );
    }
    return {
      data: {
        taskId: args.taskId,
        eventId: args.eventId,
        deduplicated: true,
        workspaceRevision: snapshot.collaborationWorkspace.revision,
        eventItem: existing,
      },
    };
  }

  const mutation = hub.upsertCollaborationItem(
    {
      id: itemId,
      kind: "task.state",
      title: `${args.eventType}: ${task.requestItem.title}`,
      summary: args.message,
      content: {
        version: DELEGATED_TASK_VERSION,
        type: "event",
        taskId: args.taskId,
        eventId: args.eventId,
        eventType: args.eventType,
        message: args.message,
        ...(args.progress !== undefined ? { progress: args.progress } : {}),
        ...(args.requirements ? { requirements: args.requirements } : {}),
        ...(args.artifactUris ? { artifactUris: args.artifactUris } : {}),
        eventFingerprint,
      },
      tags: ["delegated-task", "event", args.eventType],
      visibility: "shared",
      sensitivity: task.requestItem.sensitivity,
      status: "active",
      parentId: task.requestItem.id,
      target: task.requestItem.target,
    },
    { actor, clientId },
    sessionId,
  );
  return {
    mutation,
    data: {
      taskId: args.taskId,
      eventId: args.eventId,
      deduplicated: false,
      workspaceRevision: mutation.workspace.revision,
      eventItem: mutation.item,
    },
  };
}

export function cancelCollaborationTask(
  args: CancelArgs,
  sessionId: string,
  clientId: string,
  hub: BrowserStateHub = browserStateHub,
): CollaborationTaskMutation<Record<string, unknown>> {
  return completeCollaborationTask(
    {
      taskId: args.taskId,
      status: "cancelled",
      summary: args.reason,
    },
    sessionId,
    clientId,
    hub,
    "mcp_agent",
  );
}

export async function waitForCollaborationTaskResult(
  taskId: string,
  sessionId: string,
  signal: AbortSignal,
  hub: BrowserStateHub = browserStateHub,
): Promise<Record<string, unknown>> {
  const readResult = (): Record<string, unknown> | undefined => {
    const snapshot = hub.snapshot(sessionId);
    const task = requireDelegatedTask(
      snapshot.collaborationWorkspace,
      taskId,
    );
    if (!task.result || !task.resultItem) {
      return undefined;
    }
    return {
      taskId,
      status: task.result.status,
      workspaceRevision: snapshot.collaborationWorkspace.revision,
      requestItem: task.requestItem,
      resultItem: task.resultItem,
    };
  };

  throwIfAborted(signal);
  const existing = readResult();
  if (existing) {
    return existing;
  }

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const cleanup = () => {
      unsubscribe();
      signal.removeEventListener("abort", onAbort);
    };
    const finish = () => {
      if (settled) {
        return;
      }
      try {
        const result = readResult();
        if (!result) {
          return;
        }
        settled = true;
        cleanup();
        resolve(result);
      } catch (error) {
        settled = true;
        cleanup();
        reject(error);
      }
    };
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new ExecutionBrokerError(
              "REQUEST_CANCELLED",
              "delegated task result wait was cancelled.",
            ),
      );
    };
    unsubscribe = hub.subscribePersistence(finish);
    signal.addEventListener("abort", onAbort, { once: true });
    finish();
  });
}

function requireDelegatedTask(
  workspace: ReturnType<BrowserStateHub["snapshot"]>["collaborationWorkspace"],
  taskId: string,
) {
  const task = findDelegatedTask(workspace, taskId);
  if (!task) {
    throw new ExecutionBrokerError(
      "STALE_CONTEXT",
      `Unknown delegated task ${taskId} in the selected Chrome Profile.`,
    );
  }
  return task;
}

function assertTaskTargetFresh(
  expected: CollaborationItem["target"],
  current: ActiveTabSnapshot | undefined,
): void {
  if (!expected) {
    return;
  }
  const mismatches = getTaskTargetMismatches(expected, current);
  if (mismatches.includes("currentTarget")) {
    throw new ExecutionBrokerError(
      "STALE_CONTEXT",
      "The delegated task is page-scoped but the selected Profile has no current target.",
    );
  }
  if (mismatches.length > 0) {
    throw new ExecutionBrokerError(
      "STALE_CONTEXT",
      `The delegated task target changed before acceptance (fields=${mismatches.join(",")}). Ask Codex to delegate a fresh task for the current page.`,
    );
  }
}

function getTaskTargetMismatches(
  expected: CollaborationItem["target"],
  current: ActiveTabSnapshot | undefined,
): string[] {
  if (!expected) {
    return [];
  }
  if (!current) {
    return ["currentTarget"];
  }
  const fields = [
    "targetId",
    "tabId",
    "windowId",
    "frameId",
    "documentId",
    "navigationId",
  ] as const;
  return fields.filter(
    (field) =>
      expected[field] !== undefined && expected[field] !== current[field],
  );
}

function hashStable(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("base64url");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new ExecutionBrokerError(
        "REQUEST_CANCELLED",
        "delegated task result wait was cancelled.",
      );
}

export function isTerminalDelegatedTaskStatus(
  value: string,
): value is DelegatedTaskResultStatus {
  return (
    value === "completed" ||
    value === "failed" ||
    value === "rejected" ||
    value === "cancelled"
  );
}

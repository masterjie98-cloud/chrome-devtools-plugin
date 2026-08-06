import type {
  ActiveTabSnapshot,
  McpToolCallPayload,
  WsClientRole,
} from "./wsProtocol";

export type TaskExecutionBindingMismatch =
  | "conversationId"
  | "tabId"
  | "targetId";

export function resolveTaskBindingConversationId(
  requesterRole: WsClientRole,
  connectionConversationId: string | undefined,
  sessionConversationId: string,
): string {
  if (requesterRole === "ui" && connectionConversationId?.trim()) {
    return connectionConversationId.trim();
  }
  return sessionConversationId;
}

export function getTaskExecutionBindingMismatch(
  taskContext: McpToolCallPayload["taskContext"],
  currentConversationId: string,
  currentTarget: ActiveTabSnapshot | undefined,
): TaskExecutionBindingMismatch | null {
  if (
    taskContext?.conversationId &&
    taskContext.conversationId !== currentConversationId
  ) {
    return "conversationId";
  }
  if (
    taskContext?.target &&
    taskContext.target.tabId !== currentTarget?.tabId
  ) {
    return "tabId";
  }
  if (
    taskContext?.target?.targetId !== undefined &&
    taskContext.target.targetId !== currentTarget?.targetId
  ) {
    return "targetId";
  }
  return null;
}

export function getTaskTargetSelectionMismatch(
  taskContext: McpToolCallPayload["taskContext"],
  requestedTabId: number,
): "tabId" | null {
  return taskContext?.target &&
    taskContext.target.tabId !== requestedTabId
    ? "tabId"
    : null;
}

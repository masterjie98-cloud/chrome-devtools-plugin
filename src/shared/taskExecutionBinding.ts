import type { ActiveTabSnapshot, McpToolCallPayload } from "./wsProtocol";

export type TaskExecutionBindingMismatch =
  | "conversationId"
  | "tabId"
  | "targetId";

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

import type {
  ChatConversationSummary,
  ExecutionTaskBinding,
  PendingToolApproval,
  QueuedChatSubmission,
} from "../types";

export interface BackgroundConversationWork {
  conversationId: string;
  conversationTitle: string;
  target: ExecutionTaskBinding["target"];
  pendingApprovalCount: number;
  queuedCount: number;
  recoverableDelegatedTask: boolean;
}

export function listConversationApprovals(
  approvals: readonly PendingToolApproval[],
  conversationId: string,
): PendingToolApproval[] {
  return approvals.filter(
    (approval) => approval.conversationId === conversationId,
  );
}

export function listConversationQueue(
  queued: readonly QueuedChatSubmission[],
  conversationId: string,
): QueuedChatSubmission[] {
  return queued.filter(
    (submission) => submission.conversationId === conversationId,
  );
}

export function getBackgroundConversationWork(input: {
  activeConversationId: string;
  activeExecutionBinding?: ExecutionTaskBinding;
  conversations: readonly ChatConversationSummary[];
  approvals: readonly PendingToolApproval[];
  queued: readonly QueuedChatSubmission[];
  activeDelegatedTaskId?: string;
}): BackgroundConversationWork | undefined {
  const binding = input.activeExecutionBinding;
  if (!binding || binding.conversationId === input.activeConversationId) {
    return undefined;
  }
  return {
    conversationId: binding.conversationId,
    conversationTitle:
      input.conversations.find(
        (conversation) => conversation.id === binding.conversationId,
      )?.title ?? "后台对话",
    target: binding.target,
    pendingApprovalCount: listConversationApprovals(
      input.approvals,
      binding.conversationId,
    ).length,
    queuedCount: listConversationQueue(
      input.queued,
      binding.conversationId,
    ).length,
    recoverableDelegatedTask: Boolean(input.activeDelegatedTaskId),
  };
}

export function listBackgroundConversationWork(input: {
  activeConversationId: string;
  activeExecutionBindings: readonly ExecutionTaskBinding[];
  conversations: readonly ChatConversationSummary[];
  approvals: readonly PendingToolApproval[];
  queued: readonly QueuedChatSubmission[];
  activeDelegatedTaskIds?: ReadonlySet<string>;
}): BackgroundConversationWork[] {
  return input.activeExecutionBindings.flatMap((binding) => {
    const work = getBackgroundConversationWork({
      activeConversationId: input.activeConversationId,
      activeExecutionBinding: binding,
      conversations: input.conversations,
      approvals: input.approvals,
      queued: input.queued,
      activeDelegatedTaskId: input.activeDelegatedTaskIds?.has(binding.taskId)
        ? binding.taskId
        : undefined,
    });
    return work ? [work] : [];
  });
}

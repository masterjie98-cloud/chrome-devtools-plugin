export interface ConversationDeletionPlan {
  allowed: boolean;
  stopActiveRun: boolean;
  removeQueuedSubmissions: boolean;
  reason?: "active_conversation";
}

export function planConversationDeletion(input: {
  conversationId: string;
  activeConversationId: string;
  activeAgentConversationId?: string | null;
  queuedConversationIds: readonly string[];
}): ConversationDeletionPlan {
  if (input.conversationId === input.activeConversationId) {
    return {
      allowed: false,
      stopActiveRun: false,
      removeQueuedSubmissions: false,
      reason: "active_conversation",
    };
  }
  return {
    allowed: true,
    stopActiveRun:
      input.activeAgentConversationId === input.conversationId,
    removeQueuedSubmissions: input.queuedConversationIds.includes(
      input.conversationId,
    ),
  };
}

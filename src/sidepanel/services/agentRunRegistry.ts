import type { ExecutionTaskBinding } from "../types";

export interface ActiveAgentRun {
  runId: string;
  conversationId: string;
  assistantMessageId: string;
  controller: AbortController;
  executionBinding?: ExecutionTaskBinding;
  delegatedTaskId?: string;
  /** Restored handle for a run whose model loop is owned by the daemon. */
  remote?: boolean;
}

/**
 * Sidepanel-local handles for concurrent runs. Durable progress is mirrored to
 * the daemon through AgentSession snapshots; credentials and AbortControllers
 * deliberately remain memory-only.
 */
export class AgentRunRegistry {
  private readonly byConversationId = new Map<string, ActiveAgentRun>();
  private readonly latestRunIdByConversation = new Map<string, string>();

  start(run: ActiveAgentRun): void {
    if (this.byConversationId.has(run.conversationId)) {
      throw new Error(
        `AGENT_CONVERSATION_BUSY: ${run.conversationId} already has an active run.`,
      );
    }
    this.byConversationId.set(run.conversationId, run);
    this.latestRunIdByConversation.set(run.conversationId, run.runId);
  }

  get(conversationId: string): ActiveAgentRun | undefined {
    return this.byConversationId.get(conversationId);
  }

  isCurrent(conversationId: string, runId: string): boolean {
    return this.byConversationId.get(conversationId)?.runId === runId;
  }

  /**
   * Unlike isCurrent(), this remains true after a run finishes and turns false
   * only when a newer run starts in the same conversation.
   */
  isLatest(conversationId: string, runId: string): boolean {
    return this.latestRunIdByConversation.get(conversationId) === runId;
  }

  list(): ActiveAgentRun[] {
    return Array.from(this.byConversationId.values());
  }

  finish(conversationId: string, runId: string): boolean {
    if (!this.isCurrent(conversationId, runId)) {
      return false;
    }
    this.byConversationId.delete(conversationId);
    return true;
  }

  cancel(conversationId: string, reason?: unknown): boolean {
    const run = this.byConversationId.get(conversationId);
    if (!run) {
      return false;
    }
    run.controller.abort(reason);
    return true;
  }
}

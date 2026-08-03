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

  start(run: ActiveAgentRun): void {
    if (this.byConversationId.has(run.conversationId)) {
      throw new Error(
        `AGENT_CONVERSATION_BUSY: ${run.conversationId} already has an active run.`,
      );
    }
    this.byConversationId.set(run.conversationId, run);
  }

  get(conversationId: string): ActiveAgentRun | undefined {
    return this.byConversationId.get(conversationId);
  }

  isCurrent(conversationId: string, runId: string): boolean {
    return this.byConversationId.get(conversationId)?.runId === runId;
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

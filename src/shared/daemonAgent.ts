import type { AgentRunBudgetLimits } from "./agentRunBudget";
import type { AgentSessionExecutionBinding, AgentSessionSnapshot } from "./agentSession";
import type { BrowserActivityCursor } from "./browserActivity";
import type { CollaborationWorkspaceSnapshot } from "./collaborationWorkspace";
import type { DomElementInfo, PageSnapshot } from "./dom";

export interface DaemonAgentConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxHistory: number;
  contextWindowTokens: number;
  maxOutputTokens?: number;
  supportsVision: boolean;
  includeImageHistory: boolean;
  fastAgentMode: boolean;
  autoReadPage: boolean;
  enableTools: boolean;
  allowPseudoToolCalls: boolean;
  maxToolRounds: number;
  autoContinueAfterToolRoundLimit: boolean;
  includePageContext: boolean;
  includeDomSummary: boolean;
  includeSelectedElement: boolean;
  visibleTextLimit: number;
  domSummaryLimit: number;
  supportsWebSearch: boolean;
  enableWebSearch: boolean;
  capabilityDetection: {
    checkedAt?: string;
    visionError?: string;
    webSearchError?: string;
  };
}

export interface DaemonAgentMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  source?: "user" | "extension_ai" | "mcp_ai" | "system";
  delegatedTaskId?: string;
  toolName?: string;
  status?: string;
  attachments?: DaemonAgentAttachment[];
}

export interface DaemonAgentAttachment {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  createdAt: string;
  source: "upload" | "screenshot";
  visualPurpose?: "fast_checkpoint";
  savedAs?: string;
  width?: number;
  height?: number;
}

export interface DaemonAgentToolDefinition {
  type: "function" | "builtin_function";
  function: {
    name: string;
    description?: string;
    parameters: unknown;
  };
}

export interface DaemonAgentContext {
  pageSnapshot?: PageSnapshot;
  selectedElement?: DomElementInfo;
  collaborationWorkspace?: CollaborationWorkspaceSnapshot;
  activityCursor?: BrowserActivityCursor;
  contextReadError?: string;
}

export interface DaemonAgentStartPayload {
  runId: string;
  conversationId: string;
  assistantMessageId: string;
  config: DaemonAgentConfig;
  messages: DaemonAgentMessage[];
  input: string;
  attachments: DaemonAgentAttachment[];
  context: DaemonAgentContext;
  tools?: DaemonAgentToolDefinition[];
  executionBinding?: AgentSessionExecutionBinding;
  runBudgetLimits?: Partial<AgentRunBudgetLimits>;
  egressDestinations: string[];
}

export interface DaemonAgentCancelPayload {
  runId: string;
  conversationId: string;
  reason?: string;
}

export interface DaemonAgentCompletionResult {
  finalContent: string;
  session: AgentSessionSnapshot;
  status: "completed" | "blocked" | "failed" | "cancelled";
  errorDetail?: string;
}

/**
 * Reconstruct a daemon result from its durable AgentSession checkpoint. This
 * lets a reconnected sidepanel finish an in-flight Promise even when the
 * one-shot completion event was sent while its WebSocket was unavailable.
 */
export function daemonAgentResultFromSession(
  session: AgentSessionSnapshot,
): DaemonAgentCompletionResult | undefined {
  if (session.status === "running") {
    return undefined;
  }

  const finalContent =
    session.finalContent ??
    session.visibleContent ??
    (session.status === "cancelled"
      ? "Agent 任务已取消。"
      : "Agent 任务已结束，但没有返回可显示的内容。");
  return {
    finalContent,
    session,
    status: session.status,
    ...(session.status === "failed" ? { errorDetail: finalContent } : {}),
  };
}

export type DaemonAgentStartResultPayload =
  | {
      ok: true;
      runId: string;
      conversationId: string;
      acceptedAt: string;
    }
  | {
      ok: false;
      runId: string;
      conversationId: string;
      error: string;
    };

export interface DaemonAgentToolMessage {
  id: string;
  assistantMessageId: string;
  toolCallId: string;
  toolName: string;
  content: string;
  createdAt: string;
  attachments?: DaemonAgentAttachment[];
}

export type DaemonAgentEventPayload =
  | {
      runId: string;
      conversationId: string;
      kind: "visible_content";
      content: string;
    }
  | {
      runId: string;
      conversationId: string;
      kind: "status";
      status?: string;
    }
  | {
      runId: string;
      conversationId: string;
      kind: "session";
      session: AgentSessionSnapshot;
    }
  | {
      runId: string;
      conversationId: string;
      kind: "tool_message";
      message: DaemonAgentToolMessage;
    }
  | {
      runId: string;
      conversationId: string;
      kind: "completed";
      result: DaemonAgentCompletionResult;
    }
  | {
      runId: string;
      conversationId: string;
      kind: "failed";
      error: string;
    };

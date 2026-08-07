import type {
  AgentRunBudgetExtensionDecision,
  AgentRunBudgetExtensionRequest,
  AgentRunBudgetLimits,
} from "./agentRunBudget";
import type { AgentSessionExecutionBinding, AgentSessionSnapshot } from "./agentSession";
import type { BrowserActivityCursor } from "./browserActivity";
import type { CollaborationWorkspaceSnapshot } from "./collaborationWorkspace";
import type { DomElementInfo, PageSnapshot } from "./dom";
import type { AiContextUsageSnapshot } from "./aiContextUsage";
import type {
  ConversationMemoryPatch,
  ConversationMemoryV1,
} from "./conversationMemory";

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
  runId?: string;
  turnId?: string;
  toolCallId?: string;
  assistantMessageId?: string;
  conversationId?: string;
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

export interface AgentToolClientMetadata {
  source: "builtin" | "external_mcp";
  displayName?: string;
  externalMcpServerId?: string;
  externalMcpServerName?: string;
  externalMcpToolName?: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface DaemonAgentToolDefinition {
  type: "function" | "builtin_function";
  function: {
    name: string;
    description?: string;
    parameters: unknown;
  };
  /** Client-only execution metadata. Never forward this object to the LLM API. */
  clientMetadata?: AgentToolClientMetadata;
}

export interface DaemonAgentContext {
  pageSnapshot?: PageSnapshot;
  selectedElement?: DomElementInfo;
  collaborationWorkspace?: CollaborationWorkspaceSnapshot;
  activityCursor?: BrowserActivityCursor;
  contextReadError?: string;
  toolScope?: "browser" | "mixed" | "external_only";
  memory?: ConversationMemoryV1;
  turnControl?: {
    mode: "supersede";
    supersededRunId: string;
  };
}

export interface DaemonAgentStartPayload {
  runId: string;
  conversationId: string;
  assistantMessageId: string;
  userMessageId?: string;
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

/**
 * Project UI messages to the minimal wire representation accepted by the
 * daemon protocol. ChatMessage is structurally compatible with
 * DaemonAgentMessage, so TypeScript does not reject UI-only fields such as
 * toolResultMeta. Keeping this projection at the transport boundary prevents
 * those fields from failing the daemon's strict schema after a tool round.
 */
export function toDaemonAgentMessages(
  messages: readonly DaemonAgentMessage[],
): DaemonAgentMessage[] {
  return messages.map((message) => ({
    id: message.id,
    ...(message.runId ? { runId: message.runId } : {}),
    ...(message.turnId ? { turnId: message.turnId } : {}),
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
    ...(message.assistantMessageId
      ? { assistantMessageId: message.assistantMessageId }
      : {}),
    ...(message.conversationId
      ? { conversationId: message.conversationId }
      : {}),
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    ...(message.source ? { source: message.source } : {}),
    ...(message.delegatedTaskId
      ? { delegatedTaskId: message.delegatedTaskId }
      : {}),
    ...(message.toolName ? { toolName: message.toolName } : {}),
    ...(message.status ? { status: message.status } : {}),
    ...(message.attachments
      ? {
          attachments: message.attachments.map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            dataUrl: attachment.dataUrl,
            createdAt: attachment.createdAt,
            source: attachment.source,
            ...(attachment.visualPurpose
              ? { visualPurpose: attachment.visualPurpose }
              : {}),
            ...(attachment.savedAs ? { savedAs: attachment.savedAs } : {}),
            ...(attachment.width !== undefined
              ? { width: attachment.width }
              : {}),
            ...(attachment.height !== undefined
              ? { height: attachment.height }
              : {}),
          })),
        }
      : {}),
  }));
}

export interface DaemonAgentCancelPayload {
  runId: string;
  conversationId: string;
  reason?: string;
}

export interface DaemonAgentCancelResultPayload {
  runId: string;
  conversationId: string;
  accepted: boolean;
  state: "cancelling" | "not_active";
  session?: AgentSessionSnapshot;
}

export interface DaemonAgentBudgetDecisionPayload {
  runId: string;
  conversationId: string;
  budgetRequestId: string;
  decision: AgentRunBudgetExtensionDecision;
}

export interface DaemonAgentCompletionResult {
  finalContent: string;
  session: AgentSessionSnapshot;
  status: "completed" | "blocked" | "failed" | "cancelled";
  errorDetail?: string;
  memoryPatch?: ConversationMemoryPatch;
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
  turnId?: string;
  toolName: string;
  toolSource?: AgentToolClientMetadata["source"];
  toolDisplayName?: string;
  toolServerName?: string;
  requestArguments?: string;
  content: string;
  resultMeta?: {
    originalCharCount: number;
    displayedSourceCharCount: number;
    truncated: boolean;
  };
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
      kind: "context_usage";
      report: AiContextUsageSnapshot;
    }
  | {
      runId: string;
      conversationId: string;
      kind: "memory_patch";
      baseRevision: number;
      patch: ConversationMemoryPatch;
      source: "ai" | "fallback";
      modelRequestCount: number;
    }
  | {
      runId: string;
      conversationId: string;
      kind: "budget_request";
      budgetRequestId: string;
      request: AgentRunBudgetExtensionRequest;
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

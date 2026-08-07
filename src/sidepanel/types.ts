import type { ApprovalRequestPayload } from "../shared/wsProtocol";
import type { AgentRunBudgetExtensionRequest } from "../shared/agentRunBudget";
import type { ToolResultPresentationMeta } from "./toolResultPresentation";

export type ChatRole = "user" | "assistant" | "tool";
export type ChatConversationKind = "local" | "mcp_collaboration";
export type ChatMessageSource =
  | "user"
  | "extension_ai"
  | "mcp_ai"
  | "system";

export interface ChatMessage {
  id: string;
  /** Stable projection keys. Chat bubbles can be rebuilt from the durable run. */
  runId?: string;
  turnId?: string;
  toolCallId?: string;
  assistantMessageId?: string;
  conversationId?: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  /** Model that produced this assistant message, captured at run start. */
  model?: string;
  source?: ChatMessageSource;
  delegatedTaskId?: string;
  toolName?: string;
  toolSource?: "builtin" | "external_mcp";
  toolDisplayName?: string;
  toolServerName?: string;
  toolRequestArguments?: string;
  toolResultMeta?: ToolResultPresentationMeta;
  status?: string;
  attachments?: ChatImageAttachment[];
}

export interface ToolLogEntry {
  id: string;
  toolName: string;
  label: string;
  status: "running" | "success" | "error";
  createdAt: string;
  detail?: string;
}

export interface ChatImageAttachment {
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

export interface QueuedChatSubmission {
  id: string;
  conversationId: string;
  input: string;
  attachments: ChatImageAttachment[];
  createdAt: string;
  /** The user explicitly stopped this run before sending the new request. */
  supersedesRunId?: string;
  executionMode?: "standard" | "safe_retry";
  executionBinding?: ExecutionTaskBinding;
  delegatedTask?: {
    taskId: string;
    conversationId: string;
    requestItemId: string;
    title: string;
    instruction: string;
    acceptanceCriteria: string[];
    resumed: boolean;
    attempt: number;
  };
}

export interface ExecutionTaskBinding {
  taskId: string;
  conversationId: string;
  target: {
    tabId: number;
    windowId?: number;
    targetId?: string;
    title?: string;
    url?: string;
  };
}

export type ChatSendMode = "normal" | "queue" | "interrupt";
export type ChatSendTargetChoice =
  | "conversation"
  | "foreground"
  | "new_conversation";

export interface ChatConversationSummary {
  id: string;
  kind: ChatConversationKind;
  delegatedTaskId?: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  hasDraft: boolean;
  forked: boolean;
  searchText: string;
  exportMarkdown: string;
  exportJson: string;
}

export interface PendingToolApproval {
  id: string;
  conversationId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  policyClass: string;
  approvalMode: ApprovalRequestPayload["approvalMode"];
  reason: string;
  requester?: ApprovalRequestPayload["requester"];
  target?: ApprovalRequestPayload["target"];
  preview?: ApprovalRequestPayload["preview"];
  egressDestinations?: string[];
  conversationOrigin?: string;
  allowForConversationOriginAvailable: boolean;
  externalMcp?: ApprovalRequestPayload["externalMcp"];
}

export interface PendingAgentBudgetRequest {
  id: string;
  runId: string;
  conversationId: string;
  request: AgentRunBudgetExtensionRequest;
}

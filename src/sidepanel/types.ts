import type { ApprovalRequestPayload } from "../shared/wsProtocol";
import type { ToolResultPresentationMeta } from "./toolResultPresentation";

export type ChatRole = "user" | "assistant" | "tool";
export type ChatMessageSource =
  | "user"
  | "extension_ai"
  | "mcp_ai"
  | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  source?: ChatMessageSource;
  delegatedTaskId?: string;
  toolName?: string;
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
  input: string;
  attachments: ChatImageAttachment[];
  createdAt: string;
  executionMode?: "standard" | "safe_retry";
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

export type ChatSendMode = "normal" | "queue" | "interrupt";

export interface ChatConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  hasDraft: boolean;
  forked: boolean;
}

export interface PendingToolApproval {
  id: string;
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
}

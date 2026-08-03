import {
  createAgentTaskState,
  transitionAgentTaskState,
  type AgentTaskState,
  type AgentTaskStatePatch,
} from "./agentTaskState";

export type AgentSessionStatus =
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export type AgentSessionEventType =
  | "started"
  | "context"
  | "tool_calls"
  | "tool_results"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export interface AgentSessionToolCallSnapshot {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentSessionToolResultSnapshot {
  toolCallId: string;
  name: string;
  content: string;
}

export interface AgentSessionEventSnapshot {
  id: string;
  type: AgentSessionEventType;
  createdAt: string;
  summary: string;
  data?: {
    contextReadError?: string;
    toolCalls?: AgentSessionToolCallSnapshot[];
    toolResults?: AgentSessionToolResultSnapshot[];
  };
}

export interface AgentSessionExecutionBinding {
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

export interface AgentSessionSnapshot {
  id: string;
  assistantMessageId?: string;
  status: AgentSessionStatus;
  input: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  finalContent?: string;
  /** Bounded checkpoint used to restore the chat UI after sidepanel reload. */
  visibleContent?: string;
  executionOwner?: "sidepanel" | "extension_background" | "daemon";
  executionBinding?: AgentSessionExecutionBinding;
  taskState: AgentTaskState;
  events: AgentSessionEventSnapshot[];
}

export function sanitizeAgentToolCallForPersistence(
  toolCall: AgentSessionToolCallSnapshot,
): AgentSessionToolCallSnapshot {
  return {
    id: toolCall.id,
    name: toolCall.name,
    arguments: Object.fromEntries(
      Object.keys(toolCall.arguments).map((key) => [key, "[value omitted]"]),
    ),
  };
}

export function sanitizeAgentToolResultForPersistence(
  toolResult: AgentSessionToolResultSnapshot,
): AgentSessionToolResultSnapshot {
  const existing = parseOmittedToolResult(toolResult.content);
  return {
    toolCallId: toolResult.toolCallId,
    name: toolResult.name,
    content: JSON.stringify(
      existing ?? {
        contentOmitted: true,
        originalCharCount: toolResult.content.length,
      },
    ),
  };
}

function parseOmittedToolResult(
  content: string,
): { contentOmitted: true; originalCharCount: number } | undefined {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (
      parsed.contentOmitted === true &&
      typeof parsed.originalCharCount === "number" &&
      Number.isSafeInteger(parsed.originalCharCount) &&
      parsed.originalCharCount >= 0
    ) {
      return {
        contentOmitted: true,
        originalCharCount: parsed.originalCharCount,
      };
    }
  } catch {
    // Raw or non-JSON tool content is intentionally replaced below.
  }
  return undefined;
}

export function createAgentSessionSnapshot(
  id: string,
  input: string,
  startedAt = new Date().toISOString(),
  executionBinding?: AgentSessionExecutionBinding,
  assistantMessageId?: string,
): AgentSessionSnapshot {
  return {
    id,
    ...(assistantMessageId ? { assistantMessageId } : {}),
    status: "running",
    input,
    startedAt,
    updatedAt: startedAt,
    executionBinding,
    executionOwner: "sidepanel",
    taskState: createAgentTaskState(input, startedAt),
    events: [],
  };
}

export function updateAgentSessionTaskState(
  session: AgentSessionSnapshot,
  patch: AgentTaskStatePatch,
  updatedAt = new Date().toISOString(),
): AgentSessionSnapshot {
  return {
    ...session,
    updatedAt,
    taskState: transitionAgentTaskState(session.taskState, patch, updatedAt),
  };
}

export function appendAgentSessionEvent(
  session: AgentSessionSnapshot,
  event: AgentSessionEventSnapshot,
): AgentSessionSnapshot {
  return {
    ...session,
    updatedAt: event.createdAt,
    events: [...session.events, event].slice(-80),
  };
}

export function finalizeAgentSession(
  session: AgentSessionSnapshot,
  status: Extract<
    AgentSessionStatus,
    "completed" | "blocked" | "failed" | "cancelled"
  >,
  finalContent: string,
  completedAt = new Date().toISOString(),
): AgentSessionSnapshot {
  return {
    ...session,
    status,
    finalContent,
    updatedAt: completedAt,
    completedAt,
  };
}

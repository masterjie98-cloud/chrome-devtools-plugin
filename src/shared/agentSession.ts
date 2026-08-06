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

export const AGENT_RUN_SCHEMA_VERSION = 2 as const;

export const AGENT_RUN_PHASES = [
  "starting",
  "reading_context",
  "model_planning",
  "model_analysis",
  "tool_execution",
  "waiting_approval",
  "summarizing",
  "cancelling",
  "completed",
  "blocked",
  "failed",
  "cancelled",
] as const;

export type AgentRunPhase = (typeof AGENT_RUN_PHASES)[number];

export type AgentTurnStatus = "running" | "completed" | "failed" | "cancelled";
export type AgentToolCallStatus =
  | "requested"
  | "running"
  | "returned"
  | "failed"
  | "cancelled";

export type AgentSessionEventType =
  | "started"
  | "context"
  | "phase"
  | "heartbeat"
  | "diagnostic"
  | "compaction"
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

export interface AgentRunToolCallSnapshot extends AgentSessionToolCallSnapshot {
  status: AgentToolCallStatus;
  requestedAt: string;
  updatedAt: string;
  completedAt?: string;
  resultCharCount?: number;
  errorCode?: string;
}

export interface AgentTurnSnapshot {
  id: string;
  index: number;
  phase: AgentRunPhase;
  status: AgentTurnStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  toolCalls: AgentRunToolCallSnapshot[];
}

export interface AgentRunDiagnosticsSnapshot {
  phase: AgentRunPhase;
  phaseStartedAt: string;
  lastHeartbeatAt: string;
  lastProgressAt: string;
  lastStatus?: string;
  modelRequestCount: number;
  toolCallCount: number;
  completedToolCallCount: number;
  providerStreamBytes?: number;
  stalledSince?: string;
  lastErrorCode?: string;
  lastErrorSummary?: string;
}

export interface AgentRuntimeEnvironmentSnapshot {
  capturedAt: string;
  runtimeBuildId: string;
  model: string;
  providerOrigin: string;
  contextWindowTokens: number;
  maxOutputTokens: number;
  toolScope: "browser" | "mixed" | "external_only";
  enabledToolNames: string[];
  externalMcpServerIds: string[];
  targetTabId?: number;
  targetId?: string;
  permissionMode: "approval_required" | "tools_disabled";
}

export interface AgentSessionToolResultSnapshot {
  toolCallId: string;
  name: string;
  content: string;
}

export interface AgentSessionEventSnapshot {
  id: string;
  sequence?: number;
  type: AgentSessionEventType;
  createdAt: string;
  summary: string;
  data?: {
    turnId?: string;
    phase?: AgentRunPhase;
    status?: string;
    providerStreamBytes?: number;
    errorCode?: string;
    beforeTokens?: number;
    afterTokens?: number;
    reason?: string;
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
  schemaVersion?: typeof AGENT_RUN_SCHEMA_VERSION;
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
  phase?: AgentRunPhase;
  heartbeatAt?: string;
  diagnostics?: AgentRunDiagnosticsSnapshot;
  runtimeEnvironment?: AgentRuntimeEnvironmentSnapshot;
  turns?: AgentTurnSnapshot[];
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
    schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    id,
    ...(assistantMessageId ? { assistantMessageId } : {}),
    status: "running",
    input,
    startedAt,
    updatedAt: startedAt,
    executionBinding,
    executionOwner: "sidepanel",
    phase: "starting",
    heartbeatAt: startedAt,
    diagnostics: {
      phase: "starting",
      phaseStartedAt: startedAt,
      lastHeartbeatAt: startedAt,
      lastProgressAt: startedAt,
      modelRequestCount: 0,
      toolCallCount: 0,
      completedToolCallCount: 0,
    },
    turns: [],
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
  const sequence =
    event.sequence ?? Math.max(0, ...session.events.map((item) => item.sequence ?? 0)) + 1;
  const normalizedEvent = { ...event, sequence };
  const phase = resolveEventPhase(session, normalizedEvent);
  const diagnostics = updateDiagnosticsForEvent(session, normalizedEvent, phase);
  return {
    ...session,
    schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    phase,
    heartbeatAt: event.createdAt,
    diagnostics,
    turns: projectTurnsFromEvent(session.turns ?? [], normalizedEvent, phase),
    updatedAt: event.createdAt,
    events: [...session.events, normalizedEvent].slice(-80),
  };
}

export function updateAgentSessionRuntime(
  session: AgentSessionSnapshot,
  patch: {
    phase?: AgentRunPhase;
    status?: string;
    progress?: boolean;
    modelRequestDelta?: number;
    providerStreamBytes?: number;
    stalledSince?: string;
    errorCode?: string;
    errorSummary?: string;
  },
  updatedAt = new Date().toISOString(),
): AgentSessionSnapshot {
  const current = session.diagnostics ?? createDiagnostics(session, updatedAt);
  const phase = patch.phase ?? session.phase ?? current.phase;
  return {
    ...session,
    schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    phase,
    heartbeatAt: updatedAt,
    updatedAt,
    diagnostics: {
      ...current,
      phase,
      phaseStartedAt:
        phase === current.phase ? current.phaseStartedAt : updatedAt,
      lastHeartbeatAt: updatedAt,
      lastProgressAt: patch.progress ? updatedAt : current.lastProgressAt,
      lastStatus: patch.status ?? current.lastStatus,
      modelRequestCount:
        current.modelRequestCount + Math.max(0, patch.modelRequestDelta ?? 0),
      providerStreamBytes:
        patch.providerStreamBytes ?? current.providerStreamBytes,
      stalledSince: patch.stalledSince,
      lastErrorCode: patch.errorCode ?? current.lastErrorCode,
      lastErrorSummary: patch.errorSummary ?? current.lastErrorSummary,
    },
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
  const phase = status;
  const diagnostics = session.diagnostics ?? createDiagnostics(session, completedAt);
  return {
    ...session,
    schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    status,
    phase,
    heartbeatAt: completedAt,
    diagnostics: {
      ...diagnostics,
      phase,
      phaseStartedAt:
        diagnostics.phase === phase ? diagnostics.phaseStartedAt : completedAt,
      lastHeartbeatAt: completedAt,
      lastProgressAt: completedAt,
      stalledSince: undefined,
    },
    turns: (session.turns ?? []).map((turn) =>
      turn.status === "running"
        ? {
            ...turn,
            phase,
            status: status === "cancelled" ? "cancelled" : status === "failed" ? "failed" : "completed",
            updatedAt: completedAt,
            completedAt,
            toolCalls: turn.toolCalls.map((toolCall) =>
              toolCall.status === "requested" || toolCall.status === "running"
                ? {
                    ...toolCall,
                    status: status === "cancelled" ? "cancelled" : "failed",
                    updatedAt: completedAt,
                    completedAt,
                  }
                : toolCall,
            ),
          }
        : turn,
    ),
    finalContent,
    updatedAt: completedAt,
    completedAt,
  };
}

function createDiagnostics(
  session: AgentSessionSnapshot,
  now: string,
): AgentRunDiagnosticsSnapshot {
  const phase = session.phase ?? "starting";
  return {
    phase,
    phaseStartedAt: session.startedAt || now,
    lastHeartbeatAt: session.heartbeatAt ?? session.updatedAt ?? now,
    lastProgressAt: session.updatedAt ?? now,
    modelRequestCount: 0,
    toolCallCount: 0,
    completedToolCallCount: 0,
  };
}

function resolveEventPhase(
  session: AgentSessionSnapshot,
  event: AgentSessionEventSnapshot,
): AgentRunPhase {
  if (event.data?.phase) {
    return event.data.phase;
  }
  switch (event.type) {
    case "started":
      return "starting";
    case "tool_calls":
      return "tool_execution";
    case "tool_results":
      return "model_analysis";
    case "completed":
    case "blocked":
    case "failed":
    case "cancelled":
      return event.type;
    default:
      return session.phase ?? "model_planning";
  }
}

function updateDiagnosticsForEvent(
  session: AgentSessionSnapshot,
  event: AgentSessionEventSnapshot,
  phase: AgentRunPhase,
): AgentRunDiagnosticsSnapshot {
  const current = session.diagnostics ?? createDiagnostics(session, event.createdAt);
  const toolCalls = event.data?.toolCalls?.length ?? 0;
  const toolResults = event.data?.toolResults?.length ?? 0;
  return {
    ...current,
    phase,
    phaseStartedAt: phase === current.phase ? current.phaseStartedAt : event.createdAt,
    lastHeartbeatAt: event.createdAt,
    lastProgressAt: event.type === "heartbeat" ? current.lastProgressAt : event.createdAt,
    lastStatus: event.data?.status ?? current.lastStatus,
    toolCallCount: current.toolCallCount + toolCalls,
    completedToolCallCount: current.completedToolCallCount + toolResults,
    providerStreamBytes:
      event.data?.providerStreamBytes ?? current.providerStreamBytes,
    lastErrorCode: event.data?.errorCode ?? current.lastErrorCode,
    lastErrorSummary:
      event.type === "failed" || event.type === "blocked"
        ? current.lastErrorSummary ?? event.summary
        : current.lastErrorSummary,
    stalledSince: event.type === "heartbeat" ? current.stalledSince : undefined,
  };
}

function projectTurnsFromEvent(
  turns: AgentTurnSnapshot[],
  event: AgentSessionEventSnapshot,
  phase: AgentRunPhase,
): AgentTurnSnapshot[] {
  const next = turns.map((turn) => ({
    ...turn,
    toolCalls: turn.toolCalls.map((toolCall) => ({ ...toolCall })),
  }));
  if (event.type === "tool_calls") {
    const turnId = event.data?.turnId ?? `turn-${event.sequence ?? next.length + 1}`;
    next.push({
      id: turnId,
      index: next.length + 1,
      phase,
      status: "running",
      startedAt: event.createdAt,
      updatedAt: event.createdAt,
      toolCalls: (event.data?.toolCalls ?? []).map((toolCall) => ({
        ...toolCall,
        status: "requested",
        requestedAt: event.createdAt,
        updatedAt: event.createdAt,
      })),
    });
  } else if (event.type === "tool_results") {
    const resultByCallId = new Map(
      (event.data?.toolResults ?? []).map((result) => [result.toolCallId, result]),
    );
    const turn = [...next].reverse().find((candidate) =>
      candidate.toolCalls.some((toolCall) => resultByCallId.has(toolCall.id)),
    );
    if (turn) {
      turn.phase = phase;
      turn.status = "completed";
      turn.updatedAt = event.createdAt;
      turn.completedAt = event.createdAt;
      turn.toolCalls = turn.toolCalls.map((toolCall) => {
        const result = resultByCallId.get(toolCall.id);
        return result
          ? {
              ...toolCall,
              status: "returned",
              updatedAt: event.createdAt,
              completedAt: event.createdAt,
              resultCharCount: result.content.length,
            }
          : toolCall;
      });
    }
  } else if (["completed", "blocked", "failed", "cancelled"].includes(event.type)) {
    const turn = [...next].reverse().find((candidate) => candidate.status === "running");
    if (turn) {
      turn.phase = phase;
      turn.status = event.type === "cancelled" ? "cancelled" : event.type === "failed" ? "failed" : "completed";
      turn.updatedAt = event.createdAt;
      turn.completedAt = event.createdAt;
    }
  }
  return next.slice(-40);
}

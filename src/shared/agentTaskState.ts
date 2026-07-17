import { sanitizeText } from "./sanitize";

export const AGENT_TASK_STATE_VERSION = "agent-task-state-v1" as const;

export const AGENT_TASK_PHASES = [
  "observe",
  "plan",
  "execute",
  "verify",
  "completed",
  "blocked",
  "failed",
  "cancelled",
] as const;

export type AgentTaskPhase = (typeof AGENT_TASK_PHASES)[number];

export interface AgentTaskActionState {
  toolNames: string[];
  expectedOutcome: string;
}

export interface AgentTaskVerificationState {
  required: boolean;
  evidence: string[];
  summary?: string;
}

export interface AgentTaskState {
  version: typeof AGENT_TASK_STATE_VERSION;
  revision: number;
  objective: string;
  phase: AgentTaskPhase;
  successCriteria: string[];
  observations: string[];
  plannedActions: string[];
  activeAction?: AgentTaskActionState;
  verification: AgentTaskVerificationState;
  blockers: string[];
  updatedAt: string;
}

export type AgentTaskStatePatch = Partial<
  Pick<
    AgentTaskState,
    | "phase"
    | "successCriteria"
    | "observations"
    | "plannedActions"
    | "activeAction"
    | "verification"
    | "blockers"
  >
>;

const MAX_STATE_ENTRIES = 20;

export function createAgentTaskState(
  objective: string,
  now = new Date().toISOString(),
): AgentTaskState {
  return sanitizeAgentTaskState({
    version: AGENT_TASK_STATE_VERSION,
    revision: 1,
    objective,
    phase: "observe",
    successCriteria: [
      "满足用户明确目标，并以当前页面或工具结果作为证据。",
      "发生页面或浏览器修改后，用独立只读观察验证结果。",
    ],
    observations: [],
    plannedActions: ["读取完成当前目标所需的最小上下文。"],
    verification: { required: false, evidence: [] },
    blockers: [],
    updatedAt: now,
  });
}

export function transitionAgentTaskState(
  state: AgentTaskState,
  patch: AgentTaskStatePatch,
  now = new Date().toISOString(),
): AgentTaskState {
  const current = sanitizeAgentTaskState(state);
  return sanitizeAgentTaskState({
    ...current,
    ...patch,
    version: AGENT_TASK_STATE_VERSION,
    revision: current.revision + 1,
    updatedAt: now,
  });
}

export function sanitizeAgentTaskState(value: AgentTaskState): AgentTaskState {
  if (
    value.version !== AGENT_TASK_STATE_VERSION ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !AGENT_TASK_PHASES.includes(value.phase) ||
    !Number.isFinite(Date.parse(value.updatedAt))
  ) {
    throw new Error("Agent task state metadata is invalid.");
  }

  return {
    version: AGENT_TASK_STATE_VERSION,
    revision: value.revision,
    objective: requiredText(value.objective, 4000, "objective"),
    phase: value.phase,
    successCriteria: textList(value.successCriteria, 800),
    observations: textList(value.observations, 1200),
    plannedActions: textList(value.plannedActions, 800),
    activeAction: value.activeAction
      ? {
          toolNames: textList(value.activeAction.toolNames, 160),
          expectedOutcome: requiredText(
            value.activeAction.expectedOutcome,
            800,
            "expected outcome",
          ),
        }
      : undefined,
    verification: {
      required: value.verification.required,
      evidence: textList(value.verification.evidence, 800),
      summary: value.verification.summary
        ? sanitizeText(value.verification.summary, 1200)
        : undefined,
    },
    blockers: textList(value.blockers, 1200),
    updatedAt: value.updatedAt,
  };
}

function textList(values: string[], maxLength: number): string[] {
  if (!Array.isArray(values)) {
    throw new Error("Agent task state list is invalid.");
  }
  return values
    .slice(-MAX_STATE_ENTRIES)
    .map((value) => requiredText(value, maxLength, "list entry"));
}

function requiredText(value: string, maxLength: number, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Agent task state ${field} must be a string.`);
  }
  const sanitized = sanitizeText(value, maxLength);
  if (!sanitized) {
    throw new Error(`Agent task state ${field} cannot be empty.`);
  }
  return sanitized;
}

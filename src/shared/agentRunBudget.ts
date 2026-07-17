import { getToolPolicy } from "./toolPolicy";

const HOUR_MS = 60 * 60_000;

export const DEFAULT_AGENT_RUN_BUDGET_LIMITS = {
  maxModelRequests: 64,
  maxToolCalls: 128,
  maxEffectfulToolCalls: 50,
  maxSensitiveToolCalls: 32,
  maxDurationMs: 24 * HOUR_MS,
} as const satisfies AgentRunBudgetLimits;

export interface AgentRunBudgetLimits {
  maxModelRequests: number;
  maxToolCalls: number;
  maxEffectfulToolCalls: number;
  maxSensitiveToolCalls: number;
  maxDurationMs: number;
}

export interface AgentRunBudgetUsage {
  modelRequests: number;
  toolCalls: number;
  effectfulToolCalls: number;
  sensitiveToolCalls: number;
  elapsedMs: number;
}

export interface AgentRunBudgetSnapshot {
  limits: AgentRunBudgetLimits;
  usage: AgentRunBudgetUsage;
}

export interface AgentBudgetedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export type AgentRunBudgetKind =
  | "model_requests"
  | "tool_calls"
  | "effectful_tool_calls"
  | "sensitive_tool_calls"
  | "duration";

export type AgentRunBudgetExtensionDecision = "continue" | "summarize";

export interface AgentRunBudgetExtensionRequest {
  kind: AgentRunBudgetKind;
  label: string;
  used: number;
  requested: number;
  limit: number;
  increment: number;
  nextLimit: number;
  unit: "count" | "milliseconds";
}

export class AgentRunBudgetExceededError extends Error {
  readonly code = "AGENT_RUN_BUDGET_EXCEEDED";

  constructor(
    readonly kind: AgentRunBudgetKind,
    readonly limit: number,
    readonly used: number,
    readonly requested: number,
    readonly snapshot: AgentRunBudgetSnapshot,
  ) {
    super(
      `${kind} budget exceeded: used ${used}, requested ${requested}, limit ${limit}.`,
    );
    this.name = "AgentRunBudgetExceededError";
  }
}

export class AgentRunBudget {
  readonly limits: AgentRunBudgetLimits;
  private readonly startedAt: number;
  private modelRequests = 0;
  private toolCalls = 0;
  private effectfulToolCalls = 0;
  private sensitiveToolCalls = 0;

  constructor(
    limits: Partial<AgentRunBudgetLimits> = {},
    private readonly clock: () => number = Date.now,
  ) {
    this.limits = normalizeLimits(limits);
    this.startedAt = this.clock();
  }

  consumeModelRequest(): AgentRunBudgetSnapshot {
    this.assertDuration();
    if (this.modelRequests + 1 > this.limits.maxModelRequests) {
      throw this.exceeded(
        "model_requests",
        this.limits.maxModelRequests,
        this.modelRequests,
        1,
      );
    }
    this.modelRequests += 1;
    return this.snapshot();
  }

  consumeToolCalls(
    calls: readonly AgentBudgetedToolCall[],
  ): AgentRunBudgetSnapshot {
    this.assertDuration();
    const requestedToolCalls = calls.length;
    const requestedEffectfulToolCalls = calls.filter((call) => {
      const policy = getToolPolicy(call.name, call.arguments);
      return policy.mutatesBrowser || policy.openWorld;
    }).length;
    const requestedSensitiveToolCalls = calls.filter((call) =>
      getToolPolicy(call.name, call.arguments).sensitive,
    ).length;

    if (this.toolCalls + requestedToolCalls > this.limits.maxToolCalls) {
      throw this.exceeded(
        "tool_calls",
        this.limits.maxToolCalls,
        this.toolCalls,
        requestedToolCalls,
      );
    }
    if (
      this.effectfulToolCalls + requestedEffectfulToolCalls >
      this.limits.maxEffectfulToolCalls
    ) {
      throw this.exceeded(
        "effectful_tool_calls",
        this.limits.maxEffectfulToolCalls,
        this.effectfulToolCalls,
        requestedEffectfulToolCalls,
      );
    }
    if (
      this.sensitiveToolCalls + requestedSensitiveToolCalls >
      this.limits.maxSensitiveToolCalls
    ) {
      throw this.exceeded(
        "sensitive_tool_calls",
        this.limits.maxSensitiveToolCalls,
        this.sensitiveToolCalls,
        requestedSensitiveToolCalls,
      );
    }

    // Reserve the entire model-issued batch atomically. A batch that does not
    // fit is never partially executed, which prevents a mutation ordering
    // change at the budget boundary.
    this.toolCalls += requestedToolCalls;
    this.effectfulToolCalls += requestedEffectfulToolCalls;
    this.sensitiveToolCalls += requestedSensitiveToolCalls;
    return this.snapshot();
  }

  assertDuration(): AgentRunBudgetSnapshot {
    const elapsedMs = Math.max(0, this.clock() - this.startedAt);
    if (elapsedMs > this.limits.maxDurationMs) {
      throw this.exceeded(
        "duration",
        this.limits.maxDurationMs,
        elapsedMs,
        0,
      );
    }
    return this.snapshot();
  }

  snapshot(): AgentRunBudgetSnapshot {
    return {
      limits: { ...this.limits },
      usage: {
        modelRequests: this.modelRequests,
        toolCalls: this.toolCalls,
        effectfulToolCalls: this.effectfulToolCalls,
        sensitiveToolCalls: this.sensitiveToolCalls,
        elapsedMs: Math.max(0, this.clock() - this.startedAt),
      },
    };
  }

  extend(kind: AgentRunBudgetKind, increment: number): AgentRunBudgetSnapshot {
    if (!Number.isSafeInteger(increment) || increment <= 0) {
      throw new Error("Agent run budget extension must be a positive integer.");
    }

    const key = budgetLimitKey(kind);
    const nextLimit = this.limits[key] + increment;
    if (!Number.isSafeInteger(nextLimit)) {
      throw new Error("Agent run budget extension exceeds the safe integer range.");
    }
    this.limits[key] = nextLimit;
    return this.snapshot();
  }

  private exceeded(
    kind: AgentRunBudgetKind,
    limit: number,
    used: number,
    requested: number,
  ): AgentRunBudgetExceededError {
    return new AgentRunBudgetExceededError(
      kind,
      limit,
      used,
      requested,
      this.snapshot(),
    );
  }
}

export function createAgentRunBudgetExtensionRequest(
  error: AgentRunBudgetExceededError,
): AgentRunBudgetExtensionRequest {
  const increment = defaultBudgetExtensionIncrement(error.kind);
  return {
    kind: error.kind,
    label: agentRunBudgetLabel(error.kind),
    used: error.used,
    requested: error.requested,
    limit: error.limit,
    increment,
    nextLimit: error.limit + increment,
    unit: error.kind === "duration" ? "milliseconds" : "count",
  };
}

export function describeAgentRunBudgetExceeded(
  error: AgentRunBudgetExceededError,
): string {
  const limit =
    error.kind === "duration"
      ? formatDuration(error.limit)
      : `${error.limit} 次`;
  return `Agent 已达到本轮${agentRunBudgetLabel(error.kind)}安全预算（上限 ${limit}）。`;
}

export function formatAgentRunBudgetAmount(
  kind: AgentRunBudgetKind,
  amount: number,
): string {
  return kind === "duration" ? formatDuration(amount) : `${amount} 次`;
}

function agentRunBudgetLabel(kind: AgentRunBudgetKind): string {
  const labels: Record<AgentRunBudgetKind, string> = {
    model_requests: "模型请求",
    tool_calls: "工具调用",
    effectful_tool_calls: "修改/外部作用工具调用",
    sensitive_tool_calls: "敏感读取工具调用",
    duration: "运行时长",
  };
  return labels[kind];
}

function defaultBudgetExtensionIncrement(kind: AgentRunBudgetKind): number {
  const key = budgetLimitKey(kind);
  return DEFAULT_AGENT_RUN_BUDGET_LIMITS[key];
}

function budgetLimitKey(
  kind: AgentRunBudgetKind,
): keyof AgentRunBudgetLimits {
  const keys: Record<AgentRunBudgetKind, keyof AgentRunBudgetLimits> = {
    model_requests: "maxModelRequests",
    tool_calls: "maxToolCalls",
    effectful_tool_calls: "maxEffectfulToolCalls",
    sensitive_tool_calls: "maxSensitiveToolCalls",
    duration: "maxDurationMs",
  };
  return keys[kind];
}

function formatDuration(durationMs: number): string {
  if (durationMs % HOUR_MS === 0) {
    return `${durationMs / HOUR_MS} 小时`;
  }
  if (durationMs % 60_000 === 0) {
    return `${durationMs / 60_000} 分钟`;
  }
  if (durationMs % 1_000 === 0) {
    return `${durationMs / 1_000} 秒`;
  }
  return `${durationMs} 毫秒`;
}

function normalizeLimits(
  limits: Partial<AgentRunBudgetLimits>,
): AgentRunBudgetLimits {
  return {
    maxModelRequests: positiveInteger(
      limits.maxModelRequests,
      DEFAULT_AGENT_RUN_BUDGET_LIMITS.maxModelRequests,
    ),
    maxToolCalls: positiveInteger(
      limits.maxToolCalls,
      DEFAULT_AGENT_RUN_BUDGET_LIMITS.maxToolCalls,
    ),
    maxEffectfulToolCalls: positiveInteger(
      limits.maxEffectfulToolCalls,
      DEFAULT_AGENT_RUN_BUDGET_LIMITS.maxEffectfulToolCalls,
    ),
    maxSensitiveToolCalls: positiveInteger(
      limits.maxSensitiveToolCalls,
      DEFAULT_AGENT_RUN_BUDGET_LIMITS.maxSensitiveToolCalls,
    ),
    maxDurationMs: positiveInteger(
      limits.maxDurationMs,
      DEFAULT_AGENT_RUN_BUDGET_LIMITS.maxDurationMs,
    ),
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

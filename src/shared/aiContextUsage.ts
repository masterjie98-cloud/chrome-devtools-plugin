export const AI_CONTEXT_USAGE_CATEGORIES = [
  "system",
  "tool_definitions",
  "conversation",
  "conversation_memory",
  "page_context",
  "tool_results",
  "other",
] as const;

export type AiContextUsageCategory =
  (typeof AI_CONTEXT_USAGE_CATEGORIES)[number];

export type AiContextUsageBreakdown = Record<AiContextUsageCategory, number>;

export interface AiContextCompactionStep {
  kind: "omit_messages" | "truncate_message";
  reason: string;
  beforeTokens: number;
  afterTokens: number;
  affectedMessages: number;
}

export interface AiProviderTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens?: number;
}

export interface AiContextBudgetReport {
  contextWindowTokens: number;
  outputReserveTokens: number;
  safetyReserveTokens: number;
  inputBudgetTokens: number;
  estimatedInputTokens: number;
  omittedMessageCount: number;
  compactedMessageCount: number;
  compactionSteps: AiContextCompactionStep[];
  breakdown: AiContextUsageBreakdown;
  memorySummary?: {
    activeObjective?: string;
    activeStatus?: string;
    pendingDecisionCount: number;
    factCount: number;
  };
}

export interface AiContextUsageSnapshot extends AiContextBudgetReport {
  model: string;
  measuredAt: string;
  source: "estimated" | "provider";
  providerUsage?: AiProviderTokenUsage;
}

export function contextUsagePercent(
  report: Pick<AiContextBudgetReport, "estimatedInputTokens" | "contextWindowTokens">,
): number {
  if (report.contextWindowTokens <= 0) {
    return 0;
  }
  return Math.max(
    0,
    Math.min(100, Math.round((report.estimatedInputTokens / report.contextWindowTokens) * 100)),
  );
}

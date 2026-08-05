export const AI_CONTEXT_USAGE_CATEGORIES = [
  "system",
  "tool_definitions",
  "conversation",
  "page_context",
  "tool_results",
  "other",
] as const;

export type AiContextUsageCategory =
  (typeof AI_CONTEXT_USAGE_CATEGORIES)[number];

export type AiContextUsageBreakdown = Record<AiContextUsageCategory, number>;

export interface AiContextBudgetReport {
  contextWindowTokens: number;
  outputReserveTokens: number;
  safetyReserveTokens: number;
  inputBudgetTokens: number;
  estimatedInputTokens: number;
  omittedMessageCount: number;
  compactedMessageCount: number;
  breakdown: AiContextUsageBreakdown;
}

export interface AiContextUsageSnapshot extends AiContextBudgetReport {
  model: string;
  measuredAt: string;
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

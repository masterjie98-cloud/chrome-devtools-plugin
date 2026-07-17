import type { AiRequestedToolCall } from "./aiClient";
import { getToolPolicy } from "../../shared/toolPolicy";

export const MAX_AGENT_TOOL_BATCH_SIZE = 4;

export function buildAgentExecutionStrategyPrompt(): string {
  return [
    "Use a Goal-Evidence-Action-Barrier-Verify-Replan protocol for every task; forms are only one possible task shape.",
    "First infer the user's objective, observable success criteria, constraints, and unresolved facts. Keep hidden reasoning private; expose only concise progress, tool calls, blockers, and verified conclusions.",
    "Reuse fresh context and begin with the broadest bounded observation that materially reduces uncertainty. Do not read unchanged state one selector at a time.",
    "Build an internal action dependency graph. Emit multiple tool calls in one response only when their arguments are already known. Independent safe reads may be batched; effectful calls execute in request order.",
    `A single tool-call batch may contain at most ${MAX_AGENT_TOOL_BATCH_SIZE} calls. Prefer one higher-level bounded tool over many primitive calls when it preserves the same approval and verification boundaries.`,
    "When current page evidence already contains selectors and requested values, prefer one browser_execute_action_stage. It locally combines independent fill/select actions while preserving ordered clicks, waits, and explicit barriers. Use browser_fill_form directly only when the entire stage is one form batch.",
    "For selector-based actions, use native browser CSS only and reuse the exact selector from the freshest browser_snapshot executionMap or browser_query_dom result. Never invent Playwright/jQuery text selectors, locator chains, or XPath.",
    "Insert a decision barrier before navigation, document replacement, dynamic overlays, unknown selectors, conditional branches, or any step whose arguments depend on an earlier result. Observe again after the barrier before choosing later actions.",
    "If an ordered action fails, is denied, becomes stale, or produces an unexpected state, treat later actions in that batch as invalid. Preserve confirmed progress and re-plan from current evidence instead of repeating the same sequence.",
    "When a selector matches nothing or becomes stale, do not retry it unchanged. Take one fresh bounded page observation, choose an exact returned selector if the target still exists, and otherwise revise the plan.",
    "For tasks whose clicks, submissions, saves, uploads, navigation, or mocks are likely to trigger HTTP activity, start bounded Network recording before the first relevant action. After each meaningful action barrier, call browser_network_requests with digestOnly=true once and use activityDigest together with DOM, route, or visual evidence to verify the outcome; do not poll Network continuously.",
    "Treat repeated heartbeat-like GET or HEAD groups as background noise. Prefer non-GET requests, Document navigation, redirects, failures, and status changes; keep only the bounded grouped digest and never fetch request or response bodies unless the user explicitly needs them.",
    "After any mutation, verify the narrowest observable success criterion with a later independent read. Do not use an unrelated successful read or a repeated mutation as proof of completion.",
    "An empty optional field or unavailable optional choice is not a blocker unless the user objective, validation state, or page semantics prove it is required.",
  ].join("\n");
}

export function describeAgentToolBatchPlan(
  toolCalls: readonly AiRequestedToolCall[],
): string[] {
  const names = toolCalls.map((call) => call.name).join(", ");
  if (toolCalls.length === 0) {
    return ["没有可执行动作；根据现有证据重新规划。"];
  }

  const allReadOnly = toolCalls.every((call) => {
    const policy = getToolPolicy(call.name, call.arguments);
    return !policy.mutatesBrowser && !policy.openWorld;
  });
  if (allReadOnly) {
    return [
      `执行当前只读观察批次：${names}。`,
      "合并这些证据后再选择下一动作，避免对未变化状态逐项重复读取。",
    ];
  }

  return [
    `按请求顺序执行当前动作批次：${names}。`,
    "任一步失败、拒绝或失效后停止剩余动作，在当前状态上重新观察和规划。",
    "批次完成后用独立只读证据验证用户目标，而不是重复修改动作。",
  ];
}

export function initialAgentPlanningSteps(): string[] {
  return [
    "明确用户目标、可观察成功标准、约束和仍未知的事实。",
    "复用新鲜上下文并选择能最大幅度减少不确定性的最小观察。",
    "把动作按依赖关系分批，在导航、动态页面或条件分支前设置决策屏障。",
    "修改后使用与成功标准直接相关的独立只读证据完成验证。",
  ];
}

import type {
  DelegatedTaskPhase,
  DelegatedTaskSnapshot,
} from "../../shared/collaborationTasks";

export type DelegatedTaskPresentationTone =
  | DelegatedTaskPhase
  | "partial";

export interface DelegatedTaskPhasePresentation {
  label: string;
  tone: DelegatedTaskPresentationTone;
}

/**
 * Keep the durable protocol result honest while making the UI distinguish a
 * hard failure from an Agent that was blocked after producing a usable report.
 * The latter is partial progress, not a completed task and not an empty failure.
 */
export function getDelegatedTaskPhasePresentation(
  task: DelegatedTaskSnapshot,
  options: { active: boolean; queued: boolean },
): DelegatedTaskPhasePresentation {
  if (task.phase === "failed" && isBlockedReport(task)) {
    return { label: "部分完成", tone: "partial" };
  }

  const labels: Record<DelegatedTaskPhase, string> = {
    pending: "待确认",
    claimed: options.active
      ? "执行中"
      : options.queued
        ? "排队中"
        : "待恢复",
    completed: "已完成",
    failed: "失败",
    rejected: "已拒绝",
    cancelled: "已取消",
  };
  return { label: labels[task.phase], tone: task.phase };
}

function isBlockedReport(task: DelegatedTaskSnapshot): boolean {
  if (!task.result?.summary.trim()) {
    return false;
  }
  const output = task.result.output;
  return (
    typeof output === "object" &&
    output !== null &&
    !Array.isArray(output) &&
    output.agentStatus === "blocked"
  );
}

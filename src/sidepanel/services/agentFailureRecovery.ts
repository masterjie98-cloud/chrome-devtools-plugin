export type AgentFailureKind =
  | "stale_target"
  | "frame_unavailable"
  | "target_missing"
  | "target_not_visible"
  | "target_occluded"
  | "transport_closed"
  | "unknown_write_outcome"
  | "denied"
  | "cancelled"
  | "terminal";

export type AgentRecoveryAction =
  | "fresh_observe_and_relocate"
  | "wait_for_frame_then_observe"
  | "scroll_or_reveal_then_observe"
  | "dismiss_obstruction_then_observe"
  | "reconnect_and_retry_safe_read"
  | "reobserve_without_replay"
  | "none";

export interface AgentFailureRecoveryState {
  kind: AgentFailureKind;
  action: AgentRecoveryAction;
  retryAfterFreshEvidence: boolean;
  unknownWriteOutcome: boolean;
  message: string;
}

export function classifyAgentFailureRecovery(
  message: string,
  options: {
    mutatesBrowser?: boolean;
    dispatched?: boolean;
  } = {},
): AgentFailureRecoveryState {
  if (
    options.mutatesBrowser &&
    options.dispatched &&
    /(?:transport|connection closed|disconnected|deadline exceeded|REQUEST_DEADLINE_EXCEEDED)/i.test(
      message,
    )
  ) {
    return {
      kind: "unknown_write_outcome",
      action: "reobserve_without_replay",
      retryAfterFreshEvidence: false,
      unknownWriteOutcome: true,
      message:
        "写操作发出后连接中断，结果未知。先重新观察页面状态，不得自动重放该写操作。",
    };
  }
  if (/\b(?:STALE_CONTEXT|EXECUTION_GRANT_INVALID)\b/i.test(message)) {
    return {
      kind: "stale_target",
      action: "fresh_observe_and_relocate",
      retryAfterFreshEvidence: true,
      unknownWriteOutcome: false,
      message:
        "目标上下文已变化。读取一次最新页面，使用新 targetRef 精确定位后再继续。",
    };
  }
  if (/\bFRAME_UNAVAILABLE\b/i.test(message)) {
    return {
      kind: "frame_unavailable",
      action: "wait_for_frame_then_observe",
      retryAfterFreshEvidence: true,
      unknownWriteOutcome: false,
      message:
        "目标 frame 尚未注册。等待页面稳定后重新观察一次，再使用新 frameRef/documentId。",
    };
  }
  if (
    /\bTRUSTED_INPUT_TARGET_NOT_FOUND\b|target (?:was )?not found|matched no element|no element matches/i.test(
      message,
    )
  ) {
    return {
      kind: "target_missing",
      action: "fresh_observe_and_relocate",
      retryAfterFreshEvidence: true,
      unknownWriteOutcome: false,
      message:
        "目标不存在。重新观察一次并仅使用返回的原生 selector 或 targetRef。",
    };
  }
  if (/\bTRUSTED_INPUT_TARGET_NOT_VISIBLE\b/i.test(message)) {
    return {
      kind: "target_not_visible",
      action: "scroll_or_reveal_then_observe",
      retryAfterFreshEvidence: true,
      unknownWriteOutcome: false,
      message:
        "目标当前不可见。先滚动或展开使其可见，再重新观察并定位。",
    };
  }
  if (/\bTRUSTED_INPUT_TARGET_OCCLUDED\b/i.test(message)) {
    return {
      kind: "target_occluded",
      action: "dismiss_obstruction_then_observe",
      retryAfterFreshEvidence: true,
      unknownWriteOutcome: false,
      message:
        "目标被遮挡。先处理遮挡层，再重新观察并定位，不能重复原点击。",
    };
  }
  if (/APPROVAL_DENIED|\bdenied\b/i.test(message)) {
    return {
      kind: "denied",
      action: "none",
      retryAfterFreshEvidence: false,
      unknownWriteOutcome: false,
      message: "用户拒绝了操作，本分支停止。",
    };
  }
  if (/REQUEST_CANCELLED|\bcancelled\b|\baborted\b/i.test(message)) {
    return {
      kind: "cancelled",
      action: "none",
      retryAfterFreshEvidence: false,
      unknownWriteOutcome: false,
      message: "操作已取消，本分支停止。",
    };
  }
  if (
    /(?:transport|connection closed|disconnected|deadline exceeded|REQUEST_DEADLINE_EXCEEDED)/i.test(
      message,
    )
  ) {
    return {
      kind: "transport_closed",
      action: "reconnect_and_retry_safe_read",
      retryAfterFreshEvidence: true,
      unknownWriteOutcome: false,
      message: "连接已中断；仅无副作用的安全读取允许在重连后重试一次。",
    };
  }
  return {
    kind: "terminal",
    action: "none",
    retryAfterFreshEvidence: false,
    unknownWriteOutcome: false,
    message,
  };
}

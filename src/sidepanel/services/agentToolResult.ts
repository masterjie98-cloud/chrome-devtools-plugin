export function isSuccessfulAgentToolResultContent(content: string): boolean {
  const parsed = parseAgentToolResult(content);
  if (!parsed) {
    return content.trim().length > 0;
  }
  return !(
    parsed.ok === false ||
    parsed.success === false ||
    parsed.matched === false ||
    parsed.blocked === true ||
    parsed.denied === true ||
    parsed.cancelled === true ||
    parsed.skipped === true ||
    parsed.isError === true ||
    typeof parsed.error === "string" ||
    typeof parsed.errorCode === "string"
  );
}

export type AgentToolPreExecutionFailureKind =
  | "frame_unavailable"
  | "invalid_arguments"
  | "invalid_target"
  | "target_occluded"
  | "stale_context";

export interface AgentToolPreExecutionFailure {
  kind: AgentToolPreExecutionFailureKind;
  message: string;
  retryAfterProgress: boolean;
}

export function getAgentToolPreExecutionFailure(
  content: string,
): AgentToolPreExecutionFailure | null {
  const parsed = parseAgentToolResult(content);
  if (!parsed) {
    return null;
  }
  if (parsed.matched === false) {
    return {
      kind: "invalid_target",
      message: "The requested target did not match the current page.",
      retryAfterProgress: true,
    };
  }
  const error = typeof parsed.error === "string" ? parsed.error : "";
  if (!error) {
    return null;
  }
  if (
    /\barguments? invalid\b|selector or target is required|field (?:ref, )?selector, target, element, or name is required/i.test(
      error,
    )
  ) {
    return {
      kind: "invalid_arguments",
      message: error,
      retryAfterProgress: false,
    };
  }
  const recovery = classifyAgentFailureRecovery(error);
  if (recovery.kind === "frame_unavailable") {
    return {
      kind: "frame_unavailable",
      message: error,
      retryAfterProgress: true,
    };
  }
  if (recovery.kind === "stale_target") {
    return {
      kind: "stale_context",
      message: error,
      retryAfterProgress: true,
    };
  }
  if (
    /\b(?:INVALID_NATIVE_CSS_SELECTOR|TRUSTED_INPUT_TARGET_NOT_FOUND|TRUSTED_INPUT_TARGET_NOT_VISIBLE)\b/i.test(
      error,
    ) ||
    /is not a valid selector|target (?:was )?not found|no element matches|matched no element/i.test(
      error,
    )
  ) {
    return {
      kind: "invalid_target",
      message: error,
      retryAfterProgress: !/INVALID_NATIVE_CSS_SELECTOR|is not a valid selector/i.test(
        error,
      ),
    };
  }
  if (recovery.kind === "target_occluded") {
    return {
      kind: "target_occluded",
      message: error,
      retryAfterProgress: true,
    };
  }
  return null;
}

export function isAgentToolResultDefinitelyNotExecuted(
  content: string,
): boolean {
  const parsed = parseAgentToolResult(content);
  return Boolean(
    parsed &&
      (parsed.denied === true ||
        parsed.skipped === true ||
        parsed.blocked === true ||
        parsed.matched === false ||
        (typeof parsed.error === "string" &&
          /\bAPPROVAL_DENIED\b/i.test(parsed.error)) ||
        getAgentToolPreExecutionFailure(content)),
  );
}

export function isAgentToolApprovalDenied(content: string): boolean {
  const parsed = parseAgentToolResult(content);
  if (!parsed) {
    return false;
  }
  const error = typeof parsed.error === "string" ? parsed.error : "";
  const errorCode =
    typeof parsed.errorCode === "string" ? parsed.errorCode : "";
  return Boolean(
    parsed.denied === true ||
      /\bAPPROVAL_DENIED\b/i.test(errorCode) ||
      /\bAPPROVAL_DENIED\b|user denied tool approval/i.test(error),
  );
}

export function getAgentToolDataLossNotice(
  content: string,
): string | undefined {
  const parsed = parseAgentToolResult(content);
  if (!parsed) {
    return undefined;
  }

  const notices: string[] = [];
  const activity = isRecord(parsed.activity) ? parsed.activity : undefined;
  if (activity?.cursorStatus === "events_dropped") {
    const missedEvents =
      typeof activity.missedEvents === "number" &&
      Number.isSafeInteger(activity.missedEvents) &&
      activity.missedEvents > 0
        ? activity.missedEvents
        : undefined;
    notices.push(
      `监听窗口发生了数据淘汰${
        missedEvents ? `，有 ${missedEvents} 条事件未保留` : ""
      }。本次只能总结仍保留的事件，不能声称覆盖完整历史。`,
    );
  }
  const transportDroppedEvents = isRecord(activity?.transportDroppedEvents)
    ? Object.values(activity.transportDroppedEvents).reduce(
        (total: number, dropped) =>
          typeof dropped === "number" &&
          Number.isSafeInteger(dropped) &&
          dropped > 0
            ? total + dropped
            : total,
        0,
      )
    : Array.isArray(activity?.notableEvents)
      ? activity.notableEvents.reduce((total, event) => {
          if (!isRecord(event) || !isRecord(event.summary)) {
            return total;
          }
          const dropped = event.summary.transportDroppedEvents;
          return typeof dropped === "number" &&
            Number.isSafeInteger(dropped) &&
            dropped > 0
            ? total + dropped
            : total;
        }, 0)
      : 0;
  if (transportDroppedEvents > 0) {
    notices.push(
      `本地 daemon 连接中断期间，后台传输队列有 ${transportDroppedEvents} 条监听事件未能保留。本次结果包含断流标记，但不能声称覆盖完整历史。`,
    );
  }

  const droppedRequestCount =
    typeof parsed.droppedRequestCount === "number" &&
    Number.isSafeInteger(parsed.droppedRequestCount) &&
    parsed.droppedRequestCount > 0
      ? parsed.droppedRequestCount
      : undefined;
  if (droppedRequestCount) {
    notices.push(
      `Network 录制已达到容量，${droppedRequestCount} 条较低优先级请求已被淘汰。导航、失败、非 GET 和 XHR/Fetch 请求会被优先保留，但当前结果不是完整原始列表。`,
    );
  }

  return notices.length > 0 ? notices.join("\n") : undefined;
}

function parseAgentToolResult(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
import { classifyAgentFailureRecovery } from "./agentFailureRecovery";

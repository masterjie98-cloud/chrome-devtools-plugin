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
  argumentConstraint?: AgentToolArgumentConstraint;
}

export interface AgentToolArgumentConstraint {
  kind:
    | "max_string_length"
    | "min_string_length"
    | "max_array_length"
    | "min_array_length"
    | "max_number"
    | "min_number"
    | "enum_values"
    | "required_type"
    | "forbidden_keys";
  path: string;
  maximum?: number;
  minimum?: number;
  inclusive?: boolean;
  values?: Array<string | number | boolean>;
  expected?: string;
  keys?: string[];
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
    const argumentConstraint = readAgentToolArgumentConstraint(error);
    return {
      kind: "invalid_arguments",
      message: error,
      retryAfterProgress: false,
      ...(argumentConstraint ? { argumentConstraint } : {}),
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

export function doesAgentToolCallViolateArgumentConstraint(
  args: Record<string, unknown>,
  failure: AgentToolPreExecutionFailure,
): boolean {
  const constraint = failure.argumentConstraint;
  if (!constraint) {
    return false;
  }
  const value = readArgumentPath(args, constraint.path);
  switch (constraint.kind) {
    case "max_string_length":
      return (
        typeof value === "string" &&
        constraint.maximum !== undefined &&
        value.length > constraint.maximum
      );
    case "min_string_length":
      return (
        typeof value === "string" &&
        constraint.minimum !== undefined &&
        value.length < constraint.minimum
      );
    case "max_array_length":
      return (
        Array.isArray(value) &&
        constraint.maximum !== undefined &&
        value.length > constraint.maximum
      );
    case "min_array_length":
      return (
        Array.isArray(value) &&
        constraint.minimum !== undefined &&
        value.length < constraint.minimum
      );
    case "max_number":
      return violatesMaximum(value, constraint.maximum, constraint.inclusive);
    case "min_number":
      return violatesMinimum(value, constraint.minimum, constraint.inclusive);
    case "enum_values":
      return Boolean(
        constraint.values &&
          !constraint.values.some((candidate) => candidate === value),
      );
    case "required_type":
      return !matchesRequiredType(value, constraint.expected);
    case "forbidden_keys": {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
      }
      return Boolean(
        constraint.keys?.some((key) => key in (value as Record<string, unknown>)),
      );
    }
  }
}

function readAgentToolArgumentConstraint(
  error: string,
): AgentToolArgumentConstraint | undefined {
  const marker = "[argument_constraint=";
  const markerStart = error.lastIndexOf(marker);
  const markerEnd = error.lastIndexOf("]");
  const structured =
    markerStart >= 0 && markerEnd > markerStart
      ? error.slice(markerStart + marker.length, markerEnd)
      : undefined;
  if (structured) {
    try {
      const parsed = JSON.parse(structured) as unknown;
      if (isAgentToolArgumentConstraint(parsed)) {
        return parsed;
      }
    } catch {
      // Fall through to the legacy max-string parser.
    }
  }
  const match = error.match(
    /(?:arguments invalid:\s*|;\s*)([A-Za-z_$][\w$]*(?:(?:\[\d+\])|(?:\.[A-Za-z_$][\w$]*))*): string length \d+ exceeds maximum (\d+) characters/i,
  );
  if (!match) {
    return undefined;
  }
  const path = match[1];
  if (!path) {
    return undefined;
  }
  const maximum = Number(match[2]);
  return Number.isSafeInteger(maximum) && maximum >= 0
      ? {
        kind: "max_string_length",
        path,
        maximum,
      }
    : undefined;
}

function isAgentToolArgumentConstraint(
  value: unknown,
): value is AgentToolArgumentConstraint {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<AgentToolArgumentConstraint>;
  return (
    typeof candidate.path === "string" &&
    candidate.path.length > 0 &&
    [
      "max_string_length",
      "min_string_length",
      "max_array_length",
      "min_array_length",
      "max_number",
      "min_number",
      "enum_values",
      "required_type",
      "forbidden_keys",
    ].includes(String(candidate.kind))
  );
}

function violatesMaximum(
  value: unknown,
  maximum: number | undefined,
  inclusive = true,
): boolean {
  return (
    typeof value === "number" &&
    maximum !== undefined &&
    (inclusive ? value > maximum : value >= maximum)
  );
}

function violatesMinimum(
  value: unknown,
  minimum: number | undefined,
  inclusive = true,
): boolean {
  return (
    typeof value === "number" &&
    minimum !== undefined &&
    (inclusive ? value < minimum : value <= minimum)
  );
}

function matchesRequiredType(value: unknown, expected: string | undefined): boolean {
  if (!expected) {
    return true;
  }
  if (expected === "array") {
    return Array.isArray(value);
  }
  if (expected === "object") {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }
  if (expected === "integer") {
    return Number.isInteger(value);
  }
  return typeof value === expected;
}

function readArgumentPath(
  args: Record<string, unknown>,
  path: string,
): unknown {
  if (path === "arguments") {
    return args;
  }
  const segments = Array.from(
    path.matchAll(/([^[.\]]+)|\[(\d+)\]/g),
    (match) => match[1] ?? Number(match[2]),
  );
  return segments.reduce<unknown>((value, segment) => {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    return (value as Record<string | number, unknown>)[segment];
  }, args);
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

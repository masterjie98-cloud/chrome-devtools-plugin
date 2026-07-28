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

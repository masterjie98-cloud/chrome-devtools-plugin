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
        isKnownPreExecutionFailure(parsed.error)),
  );
}

function isKnownPreExecutionFailure(error: unknown): boolean {
  if (typeof error !== "string") {
    return false;
  }
  return (
    /\b(?:STALE_CONTEXT|EXECUTION_GRANT_INVALID|APPROVAL_DENIED|INVALID_NATIVE_CSS_SELECTOR|TRUSTED_INPUT_TARGET_NOT_FOUND|TRUSTED_INPUT_TARGET_NOT_VISIBLE)\b/.test(
      error,
    ) ||
    /is not a valid selector|target (?:was )?not found|no element matches|matched no element/i.test(
      error,
    )
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

import { isMcpToolTransportError } from "./mcpTransport";

const RECOVERABLE_TARGET_ERRORS = [
  /\bSTALE_CONTEXT\b/i,
  /\bEXECUTION_GRANT_INVALID\b/i,
] as const;

export async function executeWithTargetRecovery<T>(
  execute: (attempt: 0 | 1) => Promise<T>,
  onRetry?: (error: Error) => void,
): Promise<T> {
  try {
    return await execute(0);
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (!isRecoverableTargetError(normalized)) {
      throw normalized;
    }
    onRetry?.(normalized);
    return execute(1);
  }
}

export function isRecoverableTargetError(error: Error): boolean {
  return RECOVERABLE_TARGET_ERRORS.some((pattern) => pattern.test(error.message));
}

export async function executeWithMcpTransportRecovery<T>(
  execute: (attempt: 0 | 1) => Promise<T>,
  options: {
    retrySafe: boolean;
    onRetry?: (error: Error) => void;
  },
): Promise<T> {
  try {
    return await execute(0);
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (!options.retrySafe || !isMcpToolTransportError(normalized)) {
      throw normalized;
    }
    options.onRetry?.(normalized);
    return execute(1);
  }
}

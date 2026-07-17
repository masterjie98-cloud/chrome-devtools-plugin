export interface ReconnectBackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  random?: () => number;
}

export function getReconnectDelayMs(
  attempt: number,
  options: ReconnectBackoffOptions = {},
): number {
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 15_000;
  const jitterRatio = options.jitterRatio ?? 0.2;
  const random = options.random ?? Math.random;
  const normalizedAttempt = Math.max(0, Math.floor(attempt));
  const exponentialDelay = Math.min(
    maxDelayMs,
    baseDelayMs * 2 ** normalizedAttempt,
  );
  const boundedRandom = Math.min(1, Math.max(0, random()));
  const jitter = exponentialDelay * jitterRatio * (boundedRandom * 2 - 1);
  return Math.max(0, Math.round(exponentialDelay + jitter));
}

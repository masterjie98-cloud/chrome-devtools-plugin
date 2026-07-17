export function toAbortError(
  signal: AbortSignal | undefined,
  fallbackMessage: string,
): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason;
  }

  const error = new Error(fallbackMessage);
  error.name = "AbortError";
  return error;
}

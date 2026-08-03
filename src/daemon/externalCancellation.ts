export interface ExternalCancellationOptions<T> {
  signal: AbortSignal;
  start: () => Promise<T>;
  cancel: () => void;
  createPreCancelledError: () => Error;
}

/**
 * Bridges an owner AbortSignal into an execution system with its own cancel
 * primitive. `start` is invoked synchronously while the abort listener is
 * installed, then cancellation is checked again after registration.
 */
export async function executeWithExternalCancellation<T>(
  options: ExternalCancellationOptions<T>,
): Promise<T> {
  if (options.signal.aborted) {
    throw options.createPreCancelledError();
  }
  const cancel = () => options.cancel();
  options.signal.addEventListener("abort", cancel);
  try {
    const execution = options.start();
    if (options.signal.aborted) {
      options.cancel();
    }
    return await execution;
  } finally {
    options.signal.removeEventListener("abort", cancel);
  }
}

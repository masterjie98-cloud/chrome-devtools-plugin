import { createHash } from "node:crypto";
import type { ProtocolErrorCode } from "../shared/wsProtocol";

const DEFAULT_DEADLINE_MS = 120_000;
const MAX_DEADLINE_MS = 120_000;
const IDEMPOTENCY_TTL_MS = 5 * 60_000;
const MAX_IDEMPOTENCY_ENTRIES = 500;
const MAX_ACTIVE_PER_CONNECTION = 16;
const MAX_ACTIVE_TOTAL = 128;
const MAX_INPUT_WAITING_PER_CONNECTION = 8;
const MAX_INPUT_WAITING_TOTAL = 64;

export interface ExecutionRequest<T> {
  connectionId: string;
  requestId: string;
  sessionId: string;
  targetKey: string;
  toolName: string;
  args: Record<string, unknown>;
  deadlineAt?: string;
  idempotencyKey?: string;
  mutates: boolean;
  onStarted?: (queueWaitMs: number) => void;
  run: (signal: AbortSignal) => Promise<T>;
}

export interface InputWaitRequest<T> {
  connectionId: string;
  requestId: string;
  run: (signal: AbortSignal) => Promise<T>;
}

interface ActiveExecution {
  connectionId: string;
  controller: AbortController;
}

interface IdempotencyEntry<T = unknown> {
  fingerprint: string;
  expiresAt: number;
  promise: Promise<T>;
}

export class ExecutionBrokerError extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "ExecutionBrokerError";
  }
}

export class ExecutionBroker {
  private readonly active = new Map<string, ActiveExecution>();
  private readonly inputWaiting = new Map<string, ActiveExecution>();
  private readonly idempotency = new Map<string, IdempotencyEntry>();
  private readonly mutationTails = new Map<string, Promise<void>>();

  async execute<T>(request: ExecutionRequest<T>): Promise<T> {
    this.cleanupIdempotency();
    const activeKey = executionKey(request.connectionId, request.requestId);
    if (this.active.has(activeKey) || this.inputWaiting.has(activeKey)) {
      throw new ExecutionBrokerError(
        "IDEMPOTENCY_CONFLICT",
        `requestId is already active: ${request.requestId}`,
      );
    }

    const deadlineMs = resolveDeadlineMs(request.deadlineAt);
    const fingerprint = fingerprintRequest(request.toolName, request.args);
    const idempotencyCacheKey = request.idempotencyKey
      ? `${request.sessionId}:${request.idempotencyKey}`
      : undefined;
    if (idempotencyCacheKey) {
      const existing = this.idempotency.get(idempotencyCacheKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new ExecutionBrokerError(
            "IDEMPOTENCY_CONFLICT",
            "idempotencyKey was already used with different tool arguments.",
          );
        }
        return existing.promise as Promise<T>;
      }
    }

    this.assertCapacity(request.connectionId);

    const controller = new AbortController();
    this.active.set(activeKey, {
      connectionId: request.connectionId,
      controller,
    });
    const deadlineTimer = setTimeout(() => {
      controller.abort(
        new ExecutionBrokerError(
          "REQUEST_DEADLINE_EXCEEDED",
          `deadline exceeded for ${request.toolName}.`,
        ),
      );
    }, deadlineMs);

    const execute = async (): Promise<T> => {
      throwIfAborted(controller.signal);
      request.onStarted?.(Math.max(0, Date.now() - enqueuedAt));
      return request.run(controller.signal);
    };
    const enqueuedAt = Date.now();
    const promise = (request.mutates
      ? this.runMutationSerially(request.targetKey, controller.signal, execute)
      : execute()
    ).finally(() => {
      clearTimeout(deadlineTimer);
      this.active.delete(activeKey);
    });

    if (idempotencyCacheKey) {
      this.idempotency.set(idempotencyCacheKey, {
        fingerprint,
        expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
        promise,
      });
      void promise.catch((error) => {
        if (isRetryableTerminalError(error)) {
          this.idempotency.delete(idempotencyCacheKey);
        }
      });
      this.trimIdempotency();
    }

    return promise;
  }

  async waitForInput<T>(request: InputWaitRequest<T>): Promise<T> {
    const key = executionKey(request.connectionId, request.requestId);
    if (this.active.has(key) || this.inputWaiting.has(key)) {
      throw new ExecutionBrokerError(
        "IDEMPOTENCY_CONFLICT",
        `requestId is already active: ${request.requestId}`,
      );
    }
    this.assertInputWaitCapacity(request.connectionId);
    const controller = new AbortController();
    this.inputWaiting.set(key, {
      connectionId: request.connectionId,
      controller,
    });
    try {
      throwIfAborted(controller.signal);
      return await request.run(controller.signal);
    } finally {
      this.inputWaiting.delete(key);
    }
  }

  cancel(connectionId: string, requestId: string, reason?: string): boolean {
    const key = executionKey(connectionId, requestId);
    const execution = this.active.get(key) ?? this.inputWaiting.get(key);
    if (!execution) {
      return false;
    }
    execution.controller.abort(
      new ExecutionBrokerError(
        "REQUEST_CANCELLED",
        reason?.trim() || "request cancelled by the caller.",
      ),
    );
    return true;
  }

  cancelConnection(connectionId: string, reason: string): void {
    for (const execution of [
      ...this.active.values(),
      ...this.inputWaiting.values(),
    ]) {
      if (execution.connectionId === connectionId) {
        execution.controller.abort(
          new ExecutionBrokerError("REQUEST_CANCELLED", reason),
        );
      }
    }
  }

  activeCount(): number {
    return this.active.size;
  }

  inputWaitingCount(): number {
    return this.inputWaiting.size;
  }

  private async runMutationSerially<T>(
    targetKey: string,
    signal: AbortSignal,
    run: () => Promise<T>,
  ): Promise<T> {
    const previous = this.mutationTails.get(targetKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    this.mutationTails.set(targetKey, tail);

    try {
      await previous.catch(() => undefined);
      throwIfAborted(signal);
      return await run();
    } finally {
      release();
      if (this.mutationTails.get(targetKey) === tail) {
        this.mutationTails.delete(targetKey);
      }
    }
  }

  private assertCapacity(connectionId: string): void {
    if (this.active.size >= MAX_ACTIVE_TOTAL) {
      throw new ExecutionBrokerError(
        "RATE_LIMITED",
        `daemon has ${MAX_ACTIVE_TOTAL} active requests; retry later.`,
      );
    }
    let connectionActive = 0;
    for (const execution of this.active.values()) {
      if (execution.connectionId === connectionId) {
        connectionActive += 1;
      }
    }
    if (connectionActive >= MAX_ACTIVE_PER_CONNECTION) {
      throw new ExecutionBrokerError(
        "RATE_LIMITED",
        `connection has ${MAX_ACTIVE_PER_CONNECTION} active requests; retry later.`,
      );
    }
  }

  private assertInputWaitCapacity(connectionId: string): void {
    if (this.inputWaiting.size >= MAX_INPUT_WAITING_TOTAL) {
      throw new ExecutionBrokerError(
        "RATE_LIMITED",
        `daemon has ${MAX_INPUT_WAITING_TOTAL} pending input waits; retry after another waiter completes.`,
      );
    }
    let connectionWaiting = 0;
    for (const execution of this.inputWaiting.values()) {
      if (execution.connectionId === connectionId) {
        connectionWaiting += 1;
      }
    }
    if (connectionWaiting >= MAX_INPUT_WAITING_PER_CONNECTION) {
      throw new ExecutionBrokerError(
        "RATE_LIMITED",
        `connection has ${MAX_INPUT_WAITING_PER_CONNECTION} pending input waits; cancel or reuse an existing waiter.`,
      );
    }
  }

  private cleanupIdempotency(now = Date.now()): void {
    for (const [key, entry] of this.idempotency) {
      if (entry.expiresAt <= now) {
        this.idempotency.delete(key);
      }
    }
  }

  private trimIdempotency(): void {
    while (this.idempotency.size > MAX_IDEMPOTENCY_ENTRIES) {
      const oldestKey = this.idempotency.keys().next().value as string | undefined;
      if (!oldestKey) {
        return;
      }
      this.idempotency.delete(oldestKey);
    }
  }
}

export function protocolErrorCode(error: unknown): ProtocolErrorCode {
  return error instanceof ExecutionBrokerError ? error.code : "TOOL_FAILED";
}

function resolveDeadlineMs(deadlineAt: string | undefined): number {
  if (!deadlineAt) {
    return DEFAULT_DEADLINE_MS;
  }
  const deadline = Date.parse(deadlineAt);
  if (!Number.isFinite(deadline)) {
    throw new ExecutionBrokerError(
      "REQUEST_DEADLINE_EXCEEDED",
      "deadlineAt is not a valid ISO timestamp.",
    );
  }
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new ExecutionBrokerError(
      "REQUEST_DEADLINE_EXCEEDED",
      "request deadline has already passed.",
    );
  }
  return Math.min(remaining, MAX_DEADLINE_MS);
}

function executionKey(connectionId: string, requestId: string): string {
  return `${connectionId}:${requestId}`;
}

function fingerprintRequest(
  toolName: string,
  args: Record<string, unknown>,
): string {
  return createHash("sha256")
    .update(toolName)
    .update("\0")
    .update(stableStringify(args))
    .digest("base64url");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new ExecutionBrokerError("REQUEST_CANCELLED", "request cancelled.");
}

function isRetryableTerminalError(error: unknown): boolean {
  return (
    error instanceof ExecutionBrokerError &&
    (error.code === "REQUEST_CANCELLED" ||
      error.code === "REQUEST_DEADLINE_EXCEEDED")
  );
}

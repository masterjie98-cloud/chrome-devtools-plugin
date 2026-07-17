import assert from "node:assert/strict";
import test from "node:test";
import {
  ExecutionBroker,
  ExecutionBrokerError,
} from "../src/daemon/executionBroker";

test("ExecutionBroker cancellation reaches the active operation", async () => {
  const broker = new ExecutionBroker();
  const started = deferred<void>();
  const request = broker.execute({
    ...baseRequest("cancel-1"),
    run: async (signal) => {
      started.resolve();
      await waitForAbort(signal);
      return "unreachable";
    },
  });

  await started.promise;
  assert.equal(broker.cancel("connection-1", "cancel-1", "test stop"), true);
  await assert.rejects(request, (error: unknown) =>
    error instanceof ExecutionBrokerError &&
    error.code === "REQUEST_CANCELLED",
  );
  assert.equal(broker.activeCount(), 0);
});

test("input-required waits are cancellable without occupying execution capacity", async () => {
  const broker = new ExecutionBroker();
  const started = deferred<void>();
  const waiting = broker.waitForInput({
    connectionId: "connection-1",
    requestId: "approval-wait-1",
    run: async (signal) => {
      started.resolve();
      await waitForAbort(signal);
      return "unreachable";
    },
  });

  await started.promise;
  assert.equal(broker.activeCount(), 0);
  assert.equal(broker.inputWaitingCount(), 1);
  assert.equal(
    broker.cancel("connection-1", "approval-wait-1", "user stopped"),
    true,
  );
  await assert.rejects(waiting, (error: unknown) =>
    error instanceof ExecutionBrokerError &&
    error.code === "REQUEST_CANCELLED",
  );
  assert.equal(broker.inputWaitingCount(), 0);
});

test("ExecutionBroker bounds indefinite input waits per requester connection", async () => {
  const broker = new ExecutionBroker();
  const waits = Array.from({ length: 8 }, (_, index) =>
    broker.waitForInput({
      connectionId: "connection-waits",
      requestId: `wait-${index}`,
      run: waitForAbort,
    }),
  );

  await assert.rejects(
    broker.waitForInput({
      connectionId: "connection-waits",
      requestId: "wait-overflow",
      run: waitForAbort,
    }),
    (error: unknown) =>
      error instanceof ExecutionBrokerError && error.code === "RATE_LIMITED",
  );
  broker.cancelConnection("connection-waits", "capacity cleanup");
  await Promise.allSettled(waits);
  assert.equal(broker.inputWaitingCount(), 0);
});

test("ExecutionBroker enforces request deadlines", async () => {
  const broker = new ExecutionBroker();
  const request = broker.execute({
    ...baseRequest("deadline-1"),
    deadlineAt: new Date(Date.now() + 20).toISOString(),
    run: async (signal) => {
      await waitForAbort(signal);
      return "unreachable";
    },
  });

  await assert.rejects(request, (error: unknown) =>
    error instanceof ExecutionBrokerError &&
    error.code === "REQUEST_DEADLINE_EXCEEDED",
  );
});

test("ExecutionBroker reuses matching idempotent results and rejects conflicts", async () => {
  const broker = new ExecutionBroker();
  let executions = 0;
  const first = broker.execute({
    ...baseRequest("idempotent-1"),
    idempotencyKey: "same-key",
    run: async () => {
      executions += 1;
      return { executions };
    },
  });
  const retry = broker.execute({
    ...baseRequest("idempotent-2"),
    idempotencyKey: "same-key",
    run: async () => {
      executions += 1;
      return { executions };
    },
  });

  assert.deepEqual(await first, { executions: 1 });
  assert.deepEqual(await retry, { executions: 1 });
  assert.equal(executions, 1);

  await assert.rejects(
    broker.execute({
      ...baseRequest("idempotent-3"),
      args: { selector: "#different" },
      idempotencyKey: "same-key",
      run: async () => ({ executions: 2 }),
    }),
    (error: unknown) =>
      error instanceof ExecutionBrokerError &&
      error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("ExecutionBroker serializes mutations for the same target", async () => {
  const broker = new ExecutionBroker();
  const firstStarted = deferred<void>();
  const releaseFirst = deferred<void>();
  const order: string[] = [];

  const first = broker.execute({
    ...baseRequest("mutation-1"),
    mutates: true,
    run: async () => {
      order.push("first-start");
      firstStarted.resolve();
      await releaseFirst.promise;
      order.push("first-end");
      return 1;
    },
  });
  await firstStarted.promise;
  const second = broker.execute({
    ...baseRequest("mutation-2"),
    mutates: true,
    run: async () => {
      order.push("second-start");
      return 2;
    },
  });

  await Promise.resolve();
  assert.deepEqual(order, ["first-start"]);
  releaseFirst.resolve();
  assert.equal(await first, 1);
  assert.equal(await second, 2);
  assert.deepEqual(order, ["first-start", "first-end", "second-start"]);
});

test("ExecutionBroker reports time spent waiting for a mutation target", async () => {
  const broker = new ExecutionBroker();
  const firstStarted = deferred<void>();
  const releaseFirst = deferred<void>();
  let secondQueueWaitMs = -1;

  const first = broker.execute({
    ...baseRequest("timing-1"),
    mutates: true,
    run: async () => {
      firstStarted.resolve();
      await releaseFirst.promise;
      return 1;
    },
  });
  await firstStarted.promise;

  const second = broker.execute({
    ...baseRequest("timing-2"),
    mutates: true,
    onStarted: (queueWaitMs) => {
      secondQueueWaitMs = queueWaitMs;
    },
    run: async () => 2,
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  releaseFirst.resolve();
  await first;
  await second;
  assert.ok(secondQueueWaitMs >= 1);
});

test("ExecutionBroker caps active requests per requester connection", async () => {
  const broker = new ExecutionBroker();
  const requests = Array.from({ length: 16 }, (_, index) =>
    broker.execute({
      ...baseRequest(`capacity-${index}`),
      run: waitForAbort,
    }),
  );

  await assert.rejects(
    broker.execute({
      ...baseRequest("capacity-overflow"),
      run: async () => "unreachable",
    }),
    (error: unknown) =>
      error instanceof ExecutionBrokerError && error.code === "RATE_LIMITED",
  );

  broker.cancelConnection("connection-1", "capacity test cleanup");
  const settled = await Promise.allSettled(requests);
  assert.equal(
    settled.every(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof ExecutionBrokerError &&
        result.reason.code === "REQUEST_CANCELLED",
    ),
    true,
  );
});

function baseRequest(requestId: string) {
  return {
    connectionId: "connection-1",
    requestId,
    sessionId: "session-1",
    targetKey: "session-1:target-1",
    toolName: "browser_click",
    args: { selector: "#target" },
    mutates: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

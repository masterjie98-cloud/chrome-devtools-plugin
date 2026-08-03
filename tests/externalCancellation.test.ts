import assert from "node:assert/strict";
import test from "node:test";
import { executeWithExternalCancellation } from "../src/daemon/externalCancellation";

test("external cancellation reaches an already registered broker request", async () => {
  const controller = new AbortController();
  let rejectExecution: (error: Error) => void = () => undefined;
  let cancelCalls = 0;
  const running = executeWithExternalCancellation({
    signal: controller.signal,
    createPreCancelledError: () => new Error("pre-cancelled"),
    start: () =>
      new Promise<never>((_resolve, reject) => {
        rejectExecution = reject;
      }),
    cancel: () => {
      cancelCalls += 1;
      rejectExecution(new Error("broker-cancelled"));
    },
  });

  controller.abort(new DOMException("stop", "AbortError"));
  await assert.rejects(running, /broker-cancelled/);
  assert.equal(cancelCalls, 1);
});

test("pre-cancelled work never enters the broker", async () => {
  const controller = new AbortController();
  controller.abort();
  let started = false;
  await assert.rejects(
    executeWithExternalCancellation({
      signal: controller.signal,
      createPreCancelledError: () => new Error("pre-cancelled"),
      start: async () => {
        started = true;
      },
      cancel: () => undefined,
    }),
    /pre-cancelled/,
  );
  assert.equal(started, false);
});

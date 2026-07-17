import assert from "node:assert/strict";
import test from "node:test";
import { toAbortError } from "../src/sidepanel/services/abortError";

test("toAbortError preserves the platform AbortSignal reason", () => {
  const controller = new AbortController();
  controller.abort();

  const error = toAbortError(controller.signal, "fallback");

  assert.equal(error, controller.signal.reason);
  assert.equal(error.name, "AbortError");
});

test("toAbortError creates an AbortError when the signal has no Error reason", () => {
  const error = toAbortError(undefined, "request cancelled");

  assert.equal(error.name, "AbortError");
  assert.equal(error.message, "request cancelled");
});

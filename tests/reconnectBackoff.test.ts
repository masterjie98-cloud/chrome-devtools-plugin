import assert from "node:assert/strict";
import test from "node:test";
import { getReconnectDelayMs } from "../src/shared/reconnectBackoff";

test("reconnect delay grows exponentially and caps at the configured maximum", () => {
  const options = { jitterRatio: 0, baseDelayMs: 500, maxDelayMs: 4_000 };
  assert.deepEqual(
    [0, 1, 2, 3, 4, 20].map((attempt) =>
      getReconnectDelayMs(attempt, options),
    ),
    [500, 1_000, 2_000, 4_000, 4_000, 4_000],
  );
});

test("reconnect jitter is bounded and deterministic with an injected random source", () => {
  const minimum = getReconnectDelayMs(2, { random: () => 0 });
  const midpoint = getReconnectDelayMs(2, { random: () => 0.5 });
  const maximum = getReconnectDelayMs(2, { random: () => 1 });
  assert.deepEqual([minimum, midpoint, maximum], [1_600, 2_000, 2_400]);
});

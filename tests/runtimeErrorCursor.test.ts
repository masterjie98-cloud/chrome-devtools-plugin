import assert from "node:assert/strict";
import test from "node:test";
import { selectRuntimeErrorWindow } from "../src/shared/runtimeErrorCursor";

const retained = [
  { sequence: 101, level: "error" as const },
  { sequence: 102, level: "warning" as const },
  { sequence: 103, level: "error" as const, revoked: true },
  { sequence: 104, level: "error" as const },
];

test("runtime-error cursors report evicted events without replaying the full stream", () => {
  const result = selectRuntimeErrorWindow(retained, "stream-a", 104, {
    afterStreamId: "stream-a",
    afterSequence: 95,
    limit: 1,
  });

  assert.equal(result.cursorStatus, "events_dropped");
  assert.equal(result.missedEvents, 5);
  assert.deepEqual(
    result.selected.map((entry) => entry.sequence),
    [101],
  );
  assert.equal(result.nextSequence, 101);
});

test("runtime-error cursors filter warnings and revoked exceptions while advancing safely", () => {
  const result = selectRuntimeErrorWindow(retained, "stream-a", 104, {
    afterStreamId: "stream-a",
    afterSequence: 100,
  });

  assert.equal(result.cursorStatus, "ok");
  assert.deepEqual(
    result.candidates.map((entry) => entry.sequence),
    [101, 104],
  );
  assert.equal(result.nextSequence, 104);
});

test("runtime-error cursors distinguish stream restart and cursor-ahead states", () => {
  const restarted = selectRuntimeErrorWindow(retained, "stream-b", 104, {
    afterStreamId: "stream-a",
    afterSequence: 500,
    includeWarnings: true,
    includeRevoked: true,
  });
  assert.equal(restarted.cursorStatus, "stream_restarted");
  assert.deepEqual(
    restarted.selected.map((entry) => entry.sequence),
    [101, 102, 103, 104],
  );

  const ahead = selectRuntimeErrorWindow(retained, "stream-a", 104, {
    afterStreamId: "stream-a",
    afterSequence: 105,
  });
  assert.equal(ahead.cursorStatus, "cursor_ahead");
  assert.equal(ahead.selected.length, 0);
  assert.equal(ahead.nextSequence, 104);
});

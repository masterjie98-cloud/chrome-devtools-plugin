import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAgentPointerInput } from "../src/content/agentPointer";

test("Agent pointer clamps visible feedback to the selected viewport", () => {
  assert.deepEqual(
    normalizeAgentPointerInput(
      { action: "click", x: -20, y: 900 },
      { width: 800, height: 600 },
    ),
    {
      action: "click",
      point: { x: 0, y: 599 },
    },
  );
});

test("Agent pointer preserves both bounded drag endpoints", () => {
  assert.deepEqual(
    normalizeAgentPointerInput(
      { action: "drag", x: 12.5, y: 24.5, endX: 900, endY: -1 },
      { width: 640, height: 480 },
    ),
    {
      action: "drag",
      point: { x: 12.5, y: 24.5 },
      endPoint: { x: 639, y: 0 },
    },
  );
});

test("Agent pointer clear needs no page coordinates", () => {
  assert.deepEqual(
    normalizeAgentPointerInput({ action: "clear" }, { width: 0, height: 0 }),
    { action: "clear" },
  );
});

test("Agent pointer rejects malformed non-finite coordinates", () => {
  assert.throws(
    () =>
      normalizeAgentPointerInput(
        { action: "move", x: Number.NaN, y: 20 },
        { width: 800, height: 600 },
      ),
    /AGENT_POINTER_COORDINATES_INVALID/,
  );
});

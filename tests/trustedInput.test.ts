import assert from "node:assert/strict";
import test from "node:test";
import {
  requireTrustedElementFocus,
  requireTrustedElementPoint,
  requireTrustedTextTarget,
  trustedMouseClickEvents,
  trustedMouseDragEvents,
  trustedMouseWheelEvent,
} from "../src/background/trustedInput";

test("trusted selector point requires a visible unobscured center", () => {
  assert.deepEqual(
    requireTrustedElementPoint({
      selector: "#submit",
      matched: true,
      centerX: 120,
      centerY: 80,
      inViewport: true,
      hitTestPassed: true,
    }),
    { x: 120, y: 80 },
  );
  assert.throws(
    () =>
      requireTrustedElementPoint({
        selector: "#missing",
        matched: false,
      }),
    /TRUSTED_INPUT_TARGET_NOT_FOUND:.*Do not retry the unchanged selector/,
  );
  assert.throws(
    () =>
      requireTrustedElementPoint({
        selector: "#offscreen",
        matched: true,
        centerX: -20,
        centerY: 10,
        inViewport: false,
        hitTestPassed: false,
      }),
    /TRUSTED_INPUT_TARGET_NOT_VISIBLE/,
  );
  assert.throws(
    () =>
      requireTrustedElementPoint({
        selector: "#covered",
        matched: true,
        centerX: 20,
        centerY: 10,
        inViewport: true,
        hitTestPassed: false,
      }),
    /TRUSTED_INPUT_TARGET_OCCLUDED/,
  );
});

test("trusted keyboard targeting requires confirmed focus", () => {
  assert.doesNotThrow(() =>
    requireTrustedElementFocus({
      selector: "#editor",
      matched: true,
      focused: true,
    }),
  );
  assert.throws(
    () =>
      requireTrustedElementFocus({
        selector: "#button",
        matched: true,
        focused: false,
      }),
    /TRUSTED_INPUT_FOCUS_FAILED/,
  );
});

test("trusted typing requires a writable text target", () => {
  assert.doesNotThrow(() =>
    requireTrustedTextTarget({
      selector: "#input",
      matched: true,
      editable: true,
    }),
  );
  assert.throws(
    () =>
      requireTrustedTextTarget({
        selector: "#button",
        matched: true,
        editable: false,
      }),
    /TRUSTED_INPUT_NOT_EDITABLE/,
  );
});

test("trusted double-click emits ordered CDP press/release click counts", () => {
  const events = trustedMouseClickEvents({
    x: 40,
    y: 50,
    button: "right",
    doubleClick: true,
  });

  assert.deepEqual(
    events.map((event) => event.type),
    [
      "mouseMoved",
      "mousePressed",
      "mouseReleased",
      "mousePressed",
      "mouseReleased",
    ],
  );
  assert.deepEqual(
    events.slice(1).map((event) => event.clickCount),
    [1, 1, 2, 2],
  );
  assert.equal(events[1]?.buttons, 2);
  assert.equal(events.at(-1)?.buttons, 0);
});

test("trusted drag clamps step count and preserves button state", () => {
  const events = trustedMouseDragEvents({
    startX: 0,
    startY: 10,
    endX: 100,
    endY: 60,
    steps: 100,
  });

  assert.equal(events.length, 52);
  assert.equal(events[0]?.type, "mousePressed");
  assert.equal(events[1]?.type, "mouseMoved");
  assert.equal(events[1]?.buttons, 1);
  assert.equal(events.at(-1)?.type, "mouseReleased");
  assert.equal(events.at(-1)?.x, 100);
  assert.equal(events.at(-1)?.y, 60);
});

test("trusted wheel keeps explicit coordinates and deltas", () => {
  assert.deepEqual(
    trustedMouseWheelEvent(
      { x: 12, y: 24, deltaX: 3, deltaY: 80 },
      { x: 12, y: 24 },
    ),
    {
      type: "mouseWheel",
      x: 12,
      y: 24,
      deltaX: 3,
      deltaY: 80,
    },
  );
});

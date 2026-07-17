import assert from "node:assert/strict";
import test from "node:test";
import { viewportProbePoints } from "../src/shared/viewportGeometry";

test("visible probe points use the viewport intersection for partially visible elements", () => {
  const points = viewportProbePoints(
    { left: 20, top: 90, right: 220, bottom: 150 },
    { width: 120, height: 100 },
  );

  assert.deepEqual(points[0], { x: 70, y: 95 });
  assert.equal(
    points.every(
      (point) =>
        point.x >= 20 && point.x < 120 && point.y >= 90 && point.y < 100,
    ),
    true,
  );
});

test("visible probe points support elements larger than the viewport", () => {
  const points = viewportProbePoints(
    { left: -400, top: -300, right: 900, bottom: 700 },
    { width: 320, height: 240 },
  );

  assert.deepEqual(points[0], { x: 160, y: 120 });
  assert.equal(points.length > 1, true);
});

test("visible probe points reject zero-area and offscreen intersections", () => {
  assert.deepEqual(
    viewportProbePoints(
      { left: 30, top: 30, right: 30, bottom: 80 },
      { width: 320, height: 240 },
    ),
    [],
  );
  assert.deepEqual(
    viewportProbePoints(
      { left: 400, top: 30, right: 500, bottom: 80 },
      { width: 320, height: 240 },
    ),
    [],
  );
});

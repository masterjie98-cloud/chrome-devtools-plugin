import assert from "node:assert/strict";
import test from "node:test";
import { ElementPickerUiTracker } from "../src/sidepanel/services/elementPickerUi";

test("element picker UI stays active when start finishes on the owner Tab", () => {
  const tracker = new ElementPickerUiTracker();
  tracker.begin(42);

  assert.equal(tracker.finishStart(true, 42), true);
  assert.equal(tracker.currentOwnerTabId(), 42);
});

test("element picker UI resets when foreground changes after start", () => {
  const tracker = new ElementPickerUiTracker();
  tracker.begin(42);

  assert.equal(tracker.finishStart(true, 42), true);
  assert.equal(tracker.handleForegroundChanged(43), true);
  assert.equal(tracker.currentOwnerTabId(), undefined);
});

test("element picker UI cannot reactivate when Tab changed during start", () => {
  const tracker = new ElementPickerUiTracker();
  tracker.begin(42);

  assert.equal(tracker.handleForegroundChanged(43), true);
  assert.equal(tracker.finishStart(true, 43), false);
  assert.equal(tracker.currentOwnerTabId(), undefined);
});

test("failed or cancelled picker start never leaves the UI active", () => {
  const tracker = new ElementPickerUiTracker();
  tracker.begin(42);

  assert.equal(tracker.finishStart(false, 42), false);
  assert.equal(tracker.currentOwnerTabId(), undefined);
});

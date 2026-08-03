import assert from "node:assert/strict";
import test from "node:test";
import { ElementPickerBindingTracker } from "../src/background/elementPickerLifecycle";

const fixtureBinding = {
  tabId: 42,
  frameId: 0,
  documentId: "fixture-document",
};

test("element picker stays bound while the same foreground Tab remains active", () => {
  const tracker = new ElementPickerBindingTracker();
  tracker.remember(fixtureBinding);

  assert.equal(tracker.takeWhenForegroundChanges(42), undefined);
  assert.deepEqual(tracker.current(), fixtureBinding);
});

test("element picker binding is consumed when foreground Tab changes", () => {
  const tracker = new ElementPickerBindingTracker();
  tracker.remember(fixtureBinding);

  assert.deepEqual(tracker.takeWhenForegroundChanges(43), fixtureBinding);
  assert.equal(tracker.current(), undefined);
});

test("navigation and Tab close invalidate only the picker owning that Tab", () => {
  const tracker = new ElementPickerBindingTracker();
  tracker.remember(fixtureBinding);

  assert.equal(tracker.takeWhenDocumentInvalidates(43), undefined);
  assert.deepEqual(tracker.current(), fixtureBinding);
  assert.deepEqual(
    tracker.takeWhenDocumentInvalidates(42),
    fixtureBinding,
  );
  assert.equal(tracker.current(), undefined);
});

test("content completion cannot clear a different Tab, frame, or document", () => {
  const tracker = new ElementPickerBindingTracker();
  tracker.remember(fixtureBinding);

  assert.equal(tracker.completeFromContent(43, 0, "fixture-document"), false);
  assert.equal(tracker.completeFromContent(42, 1, "fixture-document"), false);
  assert.equal(tracker.completeFromContent(42, 0, "other-document"), false);
  assert.deepEqual(tracker.current(), fixtureBinding);

  assert.equal(
    tracker.completeFromContent(42, 0, "fixture-document"),
    true,
  );
  assert.equal(tracker.current(), undefined);
});

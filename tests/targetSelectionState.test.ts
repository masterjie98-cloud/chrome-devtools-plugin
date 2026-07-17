import assert from "node:assert/strict";
import test from "node:test";
import { transitionTargetSelection } from "../src/background/targetSelectionState";

test("stale automatic target resolution cannot overwrite a newer manual selection", () => {
  const initial = { tabId: 11, selection: "auto" as const, generation: 3 };
  const manual = transitionTargetSelection(initial, {
    tabId: 22,
    selection: "manual",
  });
  assert.equal(manual.committed, true);
  assert.equal(manual.state.generation, 4);

  const staleAuto = transitionTargetSelection(
    manual.state,
    { tabId: 11, selection: "auto" },
    initial.generation,
  );
  assert.equal(staleAuto.committed, false);
  assert.equal(staleAuto.changed, false);
  assert.deepEqual(staleAuto.state, manual.state);
});

test("idempotent target commits preserve the generation", () => {
  const current = { tabId: 22, selection: "manual" as const, generation: 4 };
  const repeated = transitionTargetSelection(current, {
    tabId: 22,
    selection: "manual",
  });
  assert.equal(repeated.committed, true);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.state.generation, 4);
});

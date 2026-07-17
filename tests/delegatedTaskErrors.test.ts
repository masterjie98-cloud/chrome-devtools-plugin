import assert from "node:assert/strict";
import test from "node:test";
import {
  isStaleDelegatedTaskTargetError,
  STALE_DELEGATED_TASK_SUMMARY,
} from "../src/sidepanel/services/delegatedTaskErrors";

test("delegated target errors are recognized without swallowing unrelated stale contexts", () => {
  assert.equal(
    isStaleDelegatedTaskTargetError(
      new Error(
        "STALE_CONTEXT: The delegated task target changed before acceptance (fields=targetId,navigationId).",
      ),
    ),
    true,
  );
  assert.equal(
    isStaleDelegatedTaskTargetError(
      new Error("STALE_CONTEXT: browser revision changed while approval was pending."),
    ),
    false,
  );
  assert.match(STALE_DELEGATED_TASK_SUMMARY, /没有执行任何操作/);
});

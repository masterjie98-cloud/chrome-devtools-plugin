import assert from "node:assert/strict";
import test from "node:test";
import { isPageActivityHookKindEnabled } from "../src/content/pageActivityMonitor";

test("MAIN-world page activity hooks honor each event kind independently", () => {
  const styleOnly = { enabled: true, includeStyle: true };
  assert.equal(isPageActivityHookKindEnabled(styleOnly, "style"), true);
  assert.equal(isPageActivityHookKindEnabled(styleOnly, "visual"), false);
  assert.equal(isPageActivityHookKindEnabled(styleOnly, "storage"), false);

  const visualOnly = { enabled: true, includeVisual: true };
  assert.equal(isPageActivityHookKindEnabled(visualOnly, "visual"), true);
  assert.equal(isPageActivityHookKindEnabled(visualOnly, "style"), false);

  const storageOnly = { enabled: true, includeStorage: true };
  assert.equal(isPageActivityHookKindEnabled(storageOnly, "storage"), true);
  assert.equal(
    isPageActivityHookKindEnabled({ ...storageOnly, enabled: false }, "storage"),
    false,
  );
});

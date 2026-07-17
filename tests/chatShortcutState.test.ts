import assert from "node:assert/strict";
import test from "node:test";
import { TOOL_NAMES } from "../src/shared/tools";
import { getChatShortcutState } from "../src/sidepanel/chatShortcutState";

test("Agent activity disables shortcuts without marking them all as loading", () => {
  const state = getChatShortcutState(true, undefined);

  assert.equal(state.disabled, true);
  assert.equal(state.readPageLoading, false);
  assert.equal(state.elementPickerLoading, false);
  assert.equal(state.screenshotLoading, false);
});

test("only the shortcut matching the active page tool shows loading", () => {
  const readState = getChatShortcutState(
    false,
    TOOL_NAMES.DOM_GET_PAGE_INFO,
  );
  const pickerState = getChatShortcutState(
    false,
    TOOL_NAMES.DOM_START_ELEMENT_PICK,
  );
  const screenshotState = getChatShortcutState(
    false,
    TOOL_NAMES.BROWSER_TAKE_SCREENSHOT,
  );

  assert.deepEqual(
    [
      readState.readPageLoading,
      readState.elementPickerLoading,
      readState.screenshotLoading,
    ],
    [true, false, false],
  );
  assert.deepEqual(
    [
      pickerState.readPageLoading,
      pickerState.elementPickerLoading,
      pickerState.screenshotLoading,
    ],
    [false, true, false],
  );
  assert.deepEqual(
    [
      screenshotState.readPageLoading,
      screenshotState.elementPickerLoading,
      screenshotState.screenshotLoading,
    ],
    [false, false, true],
  );
});

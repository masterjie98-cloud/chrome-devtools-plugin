import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertFormControlInspectInput,
  assertSelectOptionApplyInput,
  equalOptionSelection,
  resolveRequestedOptionIndices,
  selectedOptionIndices,
  type SelectOptionCandidate,
} from "../src/shared/formControls";
import { TOOL_NAMES, validateToolCall } from "../src/shared/tools";

function options(
  overrides: Partial<SelectOptionCandidate>[] = [],
): SelectOptionCandidate[] {
  return ["alpha", "beta", "gamma"].map((value, index) => ({
    index,
    value,
    label: value.toUpperCase(),
    text: value.toUpperCase(),
    disabled: false,
    selected: index === 0,
    ...overrides[index],
  }));
}

test("select option resolution prefers exact values and supports unique labels", () => {
  const candidates = options([{ label: "beta", text: "beta" }]);
  assert.deepEqual(
    resolveRequestedOptionIndices(candidates, ["beta"], false),
    [1],
  );
  assert.deepEqual(
    resolveRequestedOptionIndices(candidates, ["GAMMA", "alpha"], true),
    [0, 2],
  );
});

test("select option resolution fails before mutation on unsafe requests", () => {
  const secretLikeOption = "private-option-value";
  assert.throws(() => {
    try {
      resolveRequestedOptionIndices(options(), [secretLikeOption], false);
    } catch (error) {
      assert.doesNotMatch(String(error), new RegExp(secretLikeOption));
      throw error;
    }
  }, /SELECT_OPTION_NOT_FOUND/);
  assert.throws(
    () =>
      resolveRequestedOptionIndices(
        options([{ label: "same" }, { label: "same" }]),
        ["same"],
        false,
      ),
    /SELECT_OPTION_AMBIGUOUS/,
  );
  assert.throws(
    () =>
      resolveRequestedOptionIndices(
        options([{}, { disabled: true }]),
        ["beta"],
        false,
      ),
    /SELECT_OPTION_DISABLED/,
  );
  assert.throws(
    () => resolveRequestedOptionIndices(options(), ["alpha", "beta"], false),
    /SELECT_OPTION_COUNT_INVALID/,
  );
  assert.throws(
    () => resolveRequestedOptionIndices(options(), ["alpha", "alpha"], true),
    /SELECT_OPTION_DUPLICATE_VALUE/,
  );
});

test("internal tool validation enforces bounded strict form contracts", () => {
  const validFill = {
    toolName: TOOL_NAMES.BROWSER_FILL_FORM,
    args: {
      fields: [
        { selector: "#name", type: "text", value: "Ada" },
        { selector: "#agree", type: "checkbox", value: true },
      ],
    },
  };
  assert.equal(validateToolCall(validFill), null);
  assert.match(
    validateToolCall({
      ...validFill,
      args: {
        fields: [{ selector: "#agree", type: "checkbox", value: "yes" }],
      },
    }) ?? "",
    /boolean value/,
  );
  assert.match(
    validateToolCall({
      ...validFill,
      args: {
        fields: Array.from({ length: 51 }, (_, index) => ({
          selector: `#field-${index}`,
          value: "value",
        })),
      },
    }) ?? "",
    /limited to 50/,
  );
  assert.match(
    validateToolCall({
      toolName: TOOL_NAMES.BROWSER_SELECT_OPTION,
      args: { selector: "#country", values: ["cn"], unexpected: true },
    }) ?? "",
    /unsupported keys/,
  );
  assert.match(
    validateToolCall({
      toolName: TOOL_NAMES.BROWSER_SELECT_OPTION,
      args: { selector: "x".repeat(2001), values: ["cn"] },
    }) ?? "",
    /bounded string/,
  );
  assert.match(
    validateToolCall({
      toolName: TOOL_NAMES.BROWSER_CLICK,
      args: { selector: 'button:has-text("Save")' },
    }) ?? "",
    /native browser CSS only/,
  );
  assert.equal(
    validateToolCall({
      toolName: TOOL_NAMES.BROWSER_CLICK,
      args: { selector: 'button[data-action="save"]' },
    }),
    null,
  );
});

test("select selection comparison is order-stable", () => {
  const candidates = options([
    { selected: true },
    { selected: false },
    { selected: true },
  ]);
  assert.deepEqual(selectedOptionIndices(candidates), [0, 2]);
  assert.equal(equalOptionSelection([0, 2], [0, 2]), true);
  assert.equal(equalOptionSelection([0, 2], [2, 0]), false);
});

test("form-control content protocol validates bounded exact payloads", () => {
  assert.doesNotThrow(() =>
    assertFormControlInspectInput({
      selector: "#country",
      values: ["cn"],
      scrollIntoView: true,
      requireHitTest: true,
    }),
  );
  assert.throws(
    () =>
      assertFormControlInspectInput({
        selector: "#country",
        values: ["cn", "cn"],
      }),
    /SELECT_OPTION_INPUT_INVALID/,
  );
  assert.throws(
    () =>
      assertFormControlInspectInput({
        selector: "#country",
        values: ["cn"],
        unexpected: true,
      }),
    /FORM_CONTROL_INPUT_INVALID/,
  );
  assert.doesNotThrow(() =>
    assertSelectOptionApplyInput({
      selector: "#country",
      values: ["cn"],
      expectedElementToken: "token-1",
      expectedControlKind: "select-one",
    }),
  );
  assert.throws(
    () =>
      assertSelectOptionApplyInput({
        selector: "#country",
        values: ["cn"],
        expectedElementToken: "",
        expectedControlKind: "select-one",
      }),
    /SELECT_OPTION_INPUT_INVALID/,
  );
  assert.throws(
    () =>
      assertSelectOptionApplyInput({
        selector: "#country",
        values: ["cn"],
        expectedElementToken: "token-1",
        expectedControlKind: "text" as "select-one",
      }),
    /SELECT_OPTION_INPUT_INVALID/,
  );
});

test("batch form content protocol no longer exposes direct value mutation", async () => {
  const [automation, messages] = await Promise.all([
    readFile(new URL("../src/content/browserAutomation.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/messages.ts", import.meta.url), "utf8"),
  ]);

  assert.equal(messages.includes("CONTENT_FILL_FORM"), false);
  assert.equal(automation.includes("export function fillForm"), false);
  assert.equal(automation.includes("writeEditableValue"), false);
  assert.equal(automation.includes("dispatchInputEvents"), false);
  assert.equal(automation.includes("expectedElementToken"), true);
  assert.equal(automation.includes('inputMode: "dom"'), true);
});

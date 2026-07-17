import type {
  BrowserFormControlInspectInput,
  BrowserSelectOptionApplyInput,
} from "./dom";

export interface SelectOptionCandidate {
  index: number;
  value: string;
  label: string;
  text: string;
  disabled: boolean;
  selected: boolean;
}

const MAX_SELECT_OPTIONS = 5_000;
const MAX_FORM_VALUE_CHARS = 4_000;
const MAX_FORM_VALUES = 50;

export function assertFormControlInspectInput(
  value: unknown,
): asserts value is BrowserFormControlInspectInput {
  assertPlainObject(value, "FORM_CONTROL_INPUT_INVALID");
  const allowed = new Set([
    "selector",
    "target",
    "element",
    "name",
    "values",
    "scrollIntoView",
    "requireHitTest",
    "focusElement",
  ]);
  assertAllowedKeys(value, allowed, "FORM_CONTROL_INPUT_INVALID");
  assertElementTarget(value, true);
  assertOptionalBoolean(value, "scrollIntoView");
  assertOptionalBoolean(value, "requireHitTest");
  assertOptionalBoolean(value, "focusElement");
  if (value.values !== undefined) {
    assertOptionValues(value.values);
  }
}

export function assertSelectOptionApplyInput(
  value: unknown,
): asserts value is BrowserSelectOptionApplyInput {
  assertPlainObject(value, "SELECT_OPTION_INPUT_INVALID");
  const allowed = new Set([
    "selector",
    "target",
    "element",
    "values",
    "expectedElementToken",
    "expectedControlKind",
  ]);
  assertAllowedKeys(value, allowed, "SELECT_OPTION_INPUT_INVALID");
  assertElementTarget(value, false);
  assertOptionValues(value.values);
  if (
    typeof value.expectedElementToken !== "string" ||
    value.expectedElementToken.length < 1 ||
    value.expectedElementToken.length > 200
  ) {
    throw new Error(
      "SELECT_OPTION_INPUT_INVALID: expectedElementToken must be a non-empty bounded string.",
    );
  }
  if (
    value.expectedControlKind !== "select-one" &&
    value.expectedControlKind !== "select-multiple"
  ) {
    throw new Error(
      "SELECT_OPTION_INPUT_INVALID: expectedControlKind must be select-one or select-multiple.",
    );
  }
}

export function resolveRequestedOptionIndices(
  options: readonly SelectOptionCandidate[],
  requestedValues: readonly string[],
  multiple: boolean,
): number[] {
  if (options.length > MAX_SELECT_OPTIONS) {
    throw new Error(
      `SELECT_OPTION_LIMIT_EXCEEDED: select has ${options.length} options; the safe limit is ${MAX_SELECT_OPTIONS}.`,
    );
  }
  if (requestedValues.length === 0) {
    throw new Error("SELECT_OPTION_VALUE_REQUIRED: at least one option value is required.");
  }
  if (!multiple && requestedValues.length !== 1) {
    throw new Error(
      "SELECT_OPTION_COUNT_INVALID: a single-select control accepts exactly one requested value.",
    );
  }
  if (new Set(requestedValues).size !== requestedValues.length) {
    throw new Error(
      "SELECT_OPTION_DUPLICATE_VALUE: requested option values must be unique.",
    );
  }

  const indices = requestedValues.map((requestedValue, requestedIndex) => {
    const valueMatches = options.filter(
      (option) => option.value === requestedValue,
    );
    const labelMatches = options.filter(
      (option) =>
        option.label.trim() === requestedValue ||
        option.text.trim() === requestedValue,
    );
    const matches = valueMatches.length > 0 ? valueMatches : labelMatches;
    if (matches.length === 0) {
      throw new Error(
        `SELECT_OPTION_NOT_FOUND: requested option at index ${requestedIndex} has no exact value, label, or visible-text match.`,
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `SELECT_OPTION_AMBIGUOUS: requested option at index ${requestedIndex} matches ${matches.length} options; use a unique option value.`,
      );
    }
    const match = matches[0];
    if (!match || match.disabled) {
      throw new Error(
        `SELECT_OPTION_DISABLED: requested option at index ${requestedIndex} resolves to a disabled option.`,
      );
    }
    return match.index;
  });

  return indices.sort((left, right) => left - right);
}

export function selectedOptionIndices(
  options: readonly SelectOptionCandidate[],
): number[] {
  return options
    .filter((option) => option.selected)
    .map((option) => option.index)
    .sort((left, right) => left - right);
}

export function equalOptionSelection(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function assertElementTarget(
  value: Record<string, unknown>,
  allowName: boolean,
): void {
  const keys = allowName
    ? ["selector", "target", "element", "name"]
    : ["selector", "target", "element"];
  for (const key of keys) {
    const candidate = value[key];
    if (
      candidate !== undefined &&
      (typeof candidate !== "string" ||
        candidate.trim().length === 0 ||
        candidate.length > 2_000)
    ) {
      throw new Error(
        `FORM_CONTROL_INPUT_INVALID: ${key} must be a non-empty bounded string.`,
      );
    }
  }
  if (!keys.some((key) => typeof value[key] === "string")) {
    throw new Error(
      "FORM_CONTROL_INPUT_INVALID: selector, target, element, or name is required.",
    );
  }
}

function assertOptionValues(value: unknown): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_FORM_VALUES ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        item.length < 1 ||
        item.length > MAX_FORM_VALUE_CHARS,
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(
      "SELECT_OPTION_INPUT_INVALID: values must contain 1-50 unique non-empty strings of at most 4000 characters.",
    );
  }
}

function assertOptionalBoolean(
  value: Record<string, unknown>,
  key: string,
): void {
  if (value[key] !== undefined && typeof value[key] !== "boolean") {
    throw new Error(`FORM_CONTROL_INPUT_INVALID: ${key} must be a boolean.`);
  }
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  code: string,
): void {
  const unsupported = Object.keys(value).filter((key) => !allowed.has(key));
  if (unsupported.length > 0) {
    throw new Error(`${code}: unsupported field ${unsupported[0]}.`);
  }
}

function assertPlainObject(
  value: unknown,
  code: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${code}: expected an object payload.`);
  }
}

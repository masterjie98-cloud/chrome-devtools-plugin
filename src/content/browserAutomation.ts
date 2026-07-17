import type {
  BrowserClickInput,
  BrowserCoordinateClickInput,
  BrowserCoordinateDragInput,
  BrowserCoordinateInput,
  BrowserDebuggerFrameCleanupInput,
  BrowserDebuggerFrameCleanupResult,
  BrowserElementActionResult,
  BrowserElementRectInput,
  BrowserElementRectResult,
  BrowserDragInput,
  BrowserDragResult,
  BrowserEvaluateInput,
  BrowserEvaluateResult,
  BrowserFormControlInspectInput,
  BrowserFormControlInspectResult,
  BrowserFormControlKind,
  BrowserHoverInput,
  BrowserMouseResult,
  BrowserMouseWheelInput,
  BrowserSelectOptionApplyInput,
  BrowserStorageStateInput,
  BrowserStorageStateResult,
  BrowserWaitForInput,
  BrowserWaitForResult,
  DomRectSnapshot,
} from "../shared/dom";
import { classifyActionTarget } from "../shared/actionRisk";
import {
  assertFormControlInspectInput,
  assertSelectOptionApplyInput,
  equalOptionSelection,
  resolveRequestedOptionIndices,
  selectedOptionIndices,
  type SelectOptionCandidate,
} from "../shared/formControls";
import { sanitizeText } from "../shared/sanitize";
import { viewportProbePoints } from "../shared/viewportGeometry";
import { getCssSelector } from "./domInspector";

const DEFAULT_WAIT_TIMEOUT_MS = 5000;
const MAX_WAIT_TIMEOUT_MS = 60000;
const MAX_EVALUATE_RESULT_CHARS = 20_000;
const TEXT_INPUT_TYPES = new Set([
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);
const formControlTokens = new WeakMap<Element, string>();
const formControlTokenPrefix =
  globalThis.crypto?.randomUUID?.() ?? `fc-${Date.now().toString(36)}`;
let formControlTokenSequence = 0;

export function getElementRect(
  input: BrowserElementRectInput,
): BrowserElementRectResult {
  const target = resolveTarget(input);
  const element = target ? queryTarget(target) : null;
  if (!element) {
    return {
      selector: target,
      matched: false,
    };
  }

  if (input.scrollIntoView) {
    scrollIntoView(element);
  }
  if (input.focusElement) {
    focusElement(element);
  }

  return elementRectResult(element, target, input.requireHitTest === true);
}

export function inspectFormControl(
  input: BrowserFormControlInspectInput,
): BrowserFormControlInspectResult {
  assertFormControlInspectInput(input);
  const selector = resolveFormControlSelector(input);
  const element = selector ? queryTarget(selector) : null;
  if (!element) {
    return { selector, matched: false };
  }

  if (input.scrollIntoView) {
    scrollIntoView(element);
  }
  if (input.focusElement) {
    focusElement(element);
  }

  const controlKind = formControlKind(element);
  const result: BrowserFormControlInspectResult = {
    ...elementRectResult(element, selector, input.requireHitTest === true),
    elementToken: formControlToken(element),
    controlKind,
    disabled: isFormControlDisabled(element),
    readOnly: isFormControlReadOnly(element),
  };

  if (
    element instanceof HTMLInputElement &&
    (controlKind === "checkbox" || controlKind === "radio")
  ) {
    result.checked = element.checked;
  }

  if (element instanceof HTMLSelectElement) {
    const options = selectOptionCandidates(element);
    result.selectedOptionIndices = selectedOptionIndices(options);
    if (input.values) {
      result.desiredOptionIndices = resolveRequestedOptionIndices(
        options,
        input.values,
        element.multiple,
      );
    }
  } else if (input.values) {
    throw new Error(
      "SELECT_TARGET_REQUIRED: option values can only be resolved for a <select> control.",
    );
  }

  return result;
}

export function clickElement(
  input: BrowserClickInput,
): BrowserElementActionResult {
  const { element, selector } = requireElement(input);
  scrollIntoView(element);
  const button = mouseButton(input.button);

  dispatchMouseEvent(element, "mouseover", button);
  dispatchMouseEvent(element, "mousemove", button);
  dispatchMouseEvent(element, "mousedown", button);
  dispatchMouseEvent(element, "mouseup", button);

  if (input.button === "right") {
    dispatchMouseEvent(element, "contextmenu", button);
  } else if (element instanceof HTMLElement) {
    element.click();
  } else {
    dispatchMouseEvent(element, "click", button);
  }

  if (input.doubleClick) {
    dispatchMouseEvent(element, "mousedown", button, 2);
    dispatchMouseEvent(element, "mouseup", button, 2);
    dispatchMouseEvent(element, "click", button, 2);
    dispatchMouseEvent(element, "dblclick", button, 2);
  }

  return actionResult(element, selector, "click");
}

export function hoverElement(
  input: BrowserHoverInput,
): BrowserElementActionResult {
  const { element, selector } = requireElement(input);
  scrollIntoView(element);
  dispatchMouseEvent(element, "mouseover");
  dispatchMouseEvent(element, "mouseenter");
  dispatchMouseEvent(element, "mousemove");
  return actionResult(element, selector, "hover");
}

export function dragElement(input: BrowserDragInput): BrowserDragResult {
  const sourceSelector = (input.source || input.sourceSelector || "").trim();
  const targetSelector = (input.target || input.targetSelector || "").trim();
  if (!sourceSelector || !targetSelector) {
    throw new Error("source and target selectors are required.");
  }

  const sourceElement = queryTarget(sourceSelector);
  const targetElement = queryTarget(targetSelector);
  if (!sourceElement) {
    throw new Error(`Source element not found: ${sourceSelector}`);
  }
  if (!targetElement) {
    throw new Error(`Target element not found: ${targetSelector}`);
  }

  scrollIntoView(sourceElement);
  scrollIntoView(targetElement);

  const dataTransfer =
    typeof DataTransfer === "function" ? new DataTransfer() : undefined;
  dispatchDragEvent(sourceElement, "dragstart", dataTransfer);
  dispatchMouseEvent(sourceElement, "mousedown");
  dispatchMouseEvent(targetElement, "mousemove");
  dispatchDragEvent(targetElement, "dragenter", dataTransfer);
  dispatchDragEvent(targetElement, "dragover", dataTransfer);
  dispatchMouseEvent(targetElement, "mouseup");
  dispatchDragEvent(targetElement, "drop", dataTransfer);
  dispatchDragEvent(sourceElement, "dragend", dataTransfer);

  return {
    dragged: true,
    source: actionResult(sourceElement, sourceSelector, "dragSource"),
    target: actionResult(targetElement, targetSelector, "dragTarget"),
  };
}

export function moveMouse(input: BrowserCoordinateInput): BrowserMouseResult {
  dispatchMouseAtPoint(input.x, input.y, "mousemove");
  return { action: "move", x: input.x, y: input.y };
}

export function clickMouse(input: BrowserCoordinateClickInput): BrowserMouseResult {
  const button = mouseButton(input.button);
  dispatchMouseAtPoint(input.x, input.y, "mouseover", button);
  dispatchMouseAtPoint(input.x, input.y, "mousemove", button);
  dispatchMouseAtPoint(input.x, input.y, "mousedown", button);
  dispatchMouseAtPoint(input.x, input.y, "mouseup", button);
  dispatchMouseAtPoint(input.x, input.y, "click", button);
  if (input.doubleClick) {
    dispatchMouseAtPoint(input.x, input.y, "mousedown", button, 2);
    dispatchMouseAtPoint(input.x, input.y, "mouseup", button, 2);
    dispatchMouseAtPoint(input.x, input.y, "click", button, 2);
    dispatchMouseAtPoint(input.x, input.y, "dblclick", button, 2);
  }
  return { action: "click", x: input.x, y: input.y, button: input.button ?? "left" };
}

export function mouseDown(input: BrowserCoordinateClickInput): BrowserMouseResult {
  dispatchMouseAtPoint(input.x, input.y, "mousedown", mouseButton(input.button));
  return { action: "down", x: input.x, y: input.y, button: input.button ?? "left" };
}

export function mouseUp(input: BrowserCoordinateClickInput): BrowserMouseResult {
  dispatchMouseAtPoint(input.x, input.y, "mouseup", mouseButton(input.button));
  return { action: "up", x: input.x, y: input.y, button: input.button ?? "left" };
}

export async function dragMouse(
  input: BrowserCoordinateDragInput,
): Promise<BrowserMouseResult> {
  const steps = Math.max(1, Math.min(50, Math.round(input.steps ?? 12)));
  dispatchMouseAtPoint(input.startX, input.startY, "mousedown");
  for (let index = 1; index <= steps; index += 1) {
    const ratio = index / steps;
    const x = input.startX + (input.endX - input.startX) * ratio;
    const y = input.startY + (input.endY - input.startY) * ratio;
    dispatchMouseAtPoint(x, y, "mousemove");
    await delay(16);
  }
  dispatchMouseAtPoint(input.endX, input.endY, "mouseup");
  return { action: "drag", x: input.endX, y: input.endY };
}

export function wheelMouse(input: BrowserMouseWheelInput): BrowserMouseResult {
  const x = input.x ?? Math.round(window.innerWidth / 2);
  const y = input.y ?? Math.round(window.innerHeight / 2);
  const target = elementFromPoint(x, y);
  target.dispatchEvent(
    new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      deltaX: input.deltaX ?? 0,
      deltaY: input.deltaY ?? 0,
    }),
  );
  if (input.deltaY) {
    window.scrollBy(input.deltaX ?? 0, input.deltaY);
  }
  return { action: "wheel", x, y };
}

export function applySelectOption(
  input: BrowserSelectOptionApplyInput,
): BrowserElementActionResult {
  assertSelectOptionApplyInput(input);
  const { element, selector } = requireElement(input);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error("SELECT_TARGET_REQUIRED: target element is not a <select>.");
  }
  if (formControlToken(element) !== input.expectedElementToken) {
    throw new Error(
      "STALE_FORM_CONTROL: the select element changed after it was inspected; retry the operation.",
    );
  }
  if (formControlKind(element) !== input.expectedControlKind) {
    throw new Error(
      "STALE_FORM_CONTROL: the select control type changed after it was inspected; retry the operation.",
    );
  }
  if (isFormControlDisabled(element)) {
    throw new Error("FORM_CONTROL_DISABLED: the select control is disabled.");
  }

  const options = selectOptionCandidates(element);
  const desiredIndices = resolveRequestedOptionIndices(
    options,
    input.values,
    element.multiple,
  );
  const changed = !equalOptionSelection(
    selectedOptionIndices(options),
    desiredIndices,
  );
  if (changed) {
    const desired = new Set(desiredIndices);
    for (const [index, option] of Array.from(element.options).entries()) {
      option.selected = desired.has(index);
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    const currentElement = queryTarget(selector);
    if (
      currentElement !== element ||
      formControlToken(element) !== input.expectedElementToken
    ) {
      throw new Error(
        "STALE_FORM_CONTROL: the select element was replaced while its events were handled; re-read the form before retrying.",
      );
    }
    const finalSelection = selectedOptionIndices(selectOptionCandidates(element));
    if (!equalOptionSelection(finalSelection, desiredIndices)) {
      throw new Error(
        "SELECT_OPTION_STATE_MISMATCH: page handlers changed the selection during the operation.",
      );
    }
  }

  return {
    ...actionResult(element, selector, "selectOption"),
    inputMode: "dom",
    changed,
  };
}

export function evaluateExpression(
  input: BrowserEvaluateInput,
): BrowserEvaluateResult {
  try {
    const target = input.selector ? queryTarget(input.selector) : undefined;
    const fn = new Function(
      "element",
      `"use strict"; return (${input.expression});`,
    );
    const result = fn(target);
    const serialized = serializeEvaluationResult(result);
    return {
      evaluated: true,
      result: parseSerializedEvaluationResult(serialized.value),
      resultType: typeof result,
      serialized: serialized.value,
      truncated: serialized.truncated,
    };
  } catch (error) {
    return {
      evaluated: false,
      error: error instanceof Error ? error.message : "Evaluation failed.",
    };
  }
}

export function getStorageState(
  input: BrowserStorageStateInput,
): BrowserStorageStateResult {
  const includeLocalStorage = input.includeLocalStorage ?? true;
  const includeSessionStorage = input.includeSessionStorage ?? true;
  const includeValues = input.includeValues ?? false;
  return {
    url: window.location.href,
    origin: window.location.origin,
    ...(includeLocalStorage
      ? { localStorage: storageToRecordSnapshot(window.localStorage, includeValues) }
      : {}),
    ...(includeSessionStorage
      ? { sessionStorage: storageToRecordSnapshot(window.sessionStorage, includeValues) }
      : {}),
    valuesIncluded: includeValues,
  };
}

export function cleanDebuggerBlockingFrames(
  input: BrowserDebuggerFrameCleanupInput = {},
): BrowserDebuggerFrameCleanupResult {
  // Kept temporarily for V1 protocol compatibility. Read/debugger operations
  // must never remove another extension's frame from the inspected page.
  const remove = false;
  const includeBlobAndFilesystem = input.includeBlobAndFilesystem ?? false;
  const ownExtensionRoot = chrome.runtime.getURL("");
  const roots: ParentNode[] = [document];
  const visitedRoots = new Set<ParentNode>();
  const incompatibleFrames: BrowserDebuggerFrameCleanupResult["incompatibleFrames"] = [];
  let scannedFrames = 0;

  for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    const root = roots[rootIndex];
    if (!root || visitedRoots.has(root)) {
      continue;
    }
    visitedRoots.add(root);

    const frames = Array.from(root.querySelectorAll("iframe"));
    scannedFrames += frames.length;
    for (const frame of frames) {
      const src = frame.getAttribute("src") ?? frame.src ?? "";
      const reason = debuggerBlockingFrameReason(
        src,
        ownExtensionRoot,
        includeBlobAndFilesystem,
      );
      if (!reason) {
        continue;
      }
      if (remove) {
        frame.remove();
      }
      incompatibleFrames.push({
        src: src || "[empty src]",
        removed: remove,
        reason,
      });
    }

    for (const element of Array.from(root.querySelectorAll("*"))) {
      const shadowRoot = getAnyShadowRoot(element);
      if (shadowRoot && !visitedRoots.has(shadowRoot)) {
        roots.push(shadowRoot);
      }
    }
  }

  return {
    scannedRoots: visitedRoots.size,
    scannedFrames,
    incompatibleFrames,
    removedCount: incompatibleFrames.filter((frame) => frame.removed).length,
  };
}

export async function waitFor(
  input: BrowserWaitForInput,
): Promise<BrowserWaitForResult> {
  const startedAt = Date.now();
  if (typeof input.time === "number" && input.time > 0) {
    await delay(Math.min(input.time * 1000, MAX_WAIT_TIMEOUT_MS));
    return {
      waited: true,
      reason: "time",
      elapsedMs: Date.now() - startedAt,
    };
  }

  const timeoutMs = Math.min(
    Math.max(input.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS, 100),
    MAX_WAIT_TIMEOUT_MS,
  );

  while (Date.now() - startedAt <= timeoutMs) {
    if (input.selector && safeQuerySelector(input.selector)) {
      return {
        waited: true,
        reason: "selector",
        elapsedMs: Date.now() - startedAt,
        selector: input.selector,
      };
    }

    const bodyText = document.body?.innerText ?? "";
    if (input.text && bodyText.includes(input.text)) {
      return {
        waited: true,
        reason: "text",
        elapsedMs: Date.now() - startedAt,
        text: input.text,
      };
    }

    if (input.textGone && !bodyText.includes(input.textGone)) {
      return {
        waited: true,
        reason: "textGone",
        elapsedMs: Date.now() - startedAt,
        text: input.textGone,
      };
    }

    await delay(100);
  }

  return {
    waited: false,
    reason: "timeout",
    elapsedMs: Date.now() - startedAt,
    text: input.text ?? input.textGone,
    selector: input.selector,
  };
}

function requireElement(input: BrowserElementRectInput): {
  element: Element;
  selector: string;
} {
  const selector = resolveTarget(input);
  if (!selector) {
    throw new Error("selector or target is required.");
  }

  const element = queryTarget(selector);
  if (!element) {
    throw new Error(`Element not found: ${selector}`);
  }

  return { element, selector };
}

function resolveFormControlSelector(
  input: BrowserFormControlInspectInput,
): string {
  const direct = resolveTarget(input);
  if (direct) {
    return direct;
  }
  if (!input.name?.trim()) {
    return "";
  }
  return `[name="${cssEscape(input.name.trim())}"]`;
}

function resolveTarget(input: BrowserElementRectInput): string {
  return (input.target || input.selector || input.element || "").trim();
}

function queryTarget(target: string): Element | null {
  try {
    const candidates = Array.from(document.querySelectorAll(target));
    return (
      candidates.find((candidate) => elementHasVisibleIntersection(candidate)) ??
      candidates.find((candidate) => elementHasLayoutBox(candidate)) ??
      candidates[0] ??
      null
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid selector";
    throw new Error(
      `INVALID_NATIVE_CSS_SELECTOR: The target must be a native browser CSS selector. Playwright/jQuery text selectors and XPath are not supported. Reuse the exact selector from a fresh browser_snapshot or browser_query_dom result. Browser detail: ${detail}`,
    );
  }
}

function safeQuerySelector(selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function elementRectResult(
  element: Element,
  selector: string,
  requireHitTest = false,
): BrowserElementRectResult {
  const rect = element.getBoundingClientRect();
  const width = Math.max(0, rect.width);
  const height = Math.max(0, rect.height);
  const probePoints = viewportProbePoints(rect, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const visibleCenter = probePoints[0];
  const trustedPoint = requireHitTest
    ? probePoints.find((point) => {
        const hit = document.elementFromPoint(point.x, point.y);
        return Boolean(hit && (hit === element || element.contains(hit)));
      })
    : visibleCenter;
  const point = trustedPoint ?? visibleCenter;
  const inViewport = Boolean(visibleCenter);
  const hitTestPassed = !requireHitTest || Boolean(trustedPoint);
  const activeElement = document.activeElement;
  const focused =
    activeElement === element ||
    Boolean(activeElement && element.contains(activeElement));
  const semanticTarget = closestActionTarget(element);
  const accessibleName = actionAccessibleName(semanticTarget);
  const inputType =
    semanticTarget instanceof HTMLInputElement ||
    semanticTarget instanceof HTMLButtonElement
      ? semanticTarget.type.toLowerCase()
      : undefined;
  const autocomplete =
    semanticTarget instanceof HTMLInputElement ||
    semanticTarget instanceof HTMLTextAreaElement ||
    semanticTarget instanceof HTMLSelectElement
      ? semanticTarget.autocomplete
      : semanticTarget.getAttribute("autocomplete") ?? undefined;
  const risk = classifyActionTarget({
    tagName: semanticTarget.tagName.toLowerCase(),
    role: semanticTarget.getAttribute("role") ?? undefined,
    inputType,
    accessibleName,
    text: sanitizeText(semanticTarget.textContent ?? "", 300),
    id: semanticTarget.id || undefined,
    name:
      "name" in semanticTarget &&
      typeof (semanticTarget as { name?: unknown }).name === "string"
        ? (semanticTarget as { name: string }).name || undefined
        : semanticTarget.getAttribute("name") ?? undefined,
    autocomplete,
    placeholder: semanticTarget.getAttribute("placeholder") ?? undefined,
    testId: semanticTarget.getAttribute("data-testid") ?? undefined,
    formAssociated: Boolean(semanticTarget.closest("form")),
  });

  return {
    selector,
    matched: true,
    rect: toRectSnapshot(rect),
    pageX: round(rect.left + window.scrollX),
    pageY: round(rect.top + window.scrollY),
    width: round(width),
    height: round(height),
    devicePixelRatio: window.devicePixelRatio || 1,
    tagName: element.tagName.toLowerCase(),
    text: sanitizeText(element.textContent ?? "", 300),
    centerX: point ? round(point.x) : undefined,
    centerY: point ? round(point.y) : undefined,
    inViewport,
    hitTestPassed,
    focused,
    editable: isTextEditable(element),
    ...(accessibleName ? { accessibleName } : {}),
    ...(inputType ? { inputType } : {}),
    ...(autocomplete ? { autocomplete } : {}),
    ...risk,
  };
}

function closestActionTarget(element: Element): Element {
  return (
    element.closest(
      "button,input,textarea,select,a[href],[role='button'],[role='menuitem'],[role='link']",
    ) ?? element
  );
}

function actionAccessibleName(element: Element): string {
  const ariaLabel = element.getAttribute("aria-label")?.trim();
  if (ariaLabel) return sanitizeText(ariaLabel, 300);

  const labelledBy = element.getAttribute("aria-labelledby")?.trim();
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text) return sanitizeText(text, 300);
  }

  if (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const label = Array.from(element.labels ?? [])
      .map((entry) => entry.textContent ?? "")
      .join(" ")
      .trim();
    if (label) return sanitizeText(label, 300);
  }

  if (
    element instanceof HTMLInputElement &&
    ["button", "reset", "submit"].includes(element.type) &&
    element.value.trim()
  ) {
    return sanitizeText(element.value, 300);
  }

  const fallback =
    element.getAttribute("title") ||
    element.getAttribute("placeholder") ||
    element.textContent ||
    "";
  return sanitizeText(fallback, 300);
}

function elementHasVisibleIntersection(element: Element): boolean {
  return (
    viewportProbePoints(element.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    }).length > 0
  );
}

function elementHasLayoutBox(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return (
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function isTextEditable(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly;
  }
  if (element instanceof HTMLInputElement) {
    return (
      !element.disabled &&
      !element.readOnly &&
      TEXT_INPUT_TYPES.has(element.type.toLowerCase())
    );
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

function actionResult(
  element: Element,
  selector: string,
  action: string,
): BrowserElementActionResult {
  const rect = element.getBoundingClientRect();
  return {
    selector,
    matched: true,
    tagName: element.tagName.toLowerCase(),
    text: sanitizeText(element.textContent ?? "", 300),
    rect: toRectSnapshot(rect),
    action,
  };
}

function scrollIntoView(element: Element): void {
  element.scrollIntoView({
    block: "center",
    inline: "center",
    behavior: "auto",
  });
}

function focusElement(element: Element): void {
  if (element instanceof HTMLElement || element instanceof SVGElement) {
    element.focus?.();
  }
}

function dispatchMouseEvent(
  element: Element,
  type: string,
  button = 0,
  detail = 1,
): void {
  const rect = element.getBoundingClientRect();
  element.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      button,
      detail,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }),
  );
}

function dispatchMouseAtPoint(
  x: number,
  y: number,
  type: string,
  button = 0,
  detail = 1,
): void {
  const target = elementFromPoint(x, y);
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      button,
      detail,
      clientX: x,
      clientY: y,
    }),
  );
}

function dispatchDragEvent(
  element: Element,
  type: string,
  dataTransfer?: DataTransfer,
): void {
  const rect = element.getBoundingClientRect();
  element.dispatchEvent(
    new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }),
  );
}

function elementFromPoint(x: number, y: number): Element {
  return document.elementFromPoint(x, y) ?? document.body;
}

function mouseButton(button: BrowserClickInput["button"]): number {
  switch (button) {
    case "middle":
      return 1;
    case "right":
      return 2;
    case "left":
    default:
      return 0;
  }
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape
    ? CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

function formControlKind(element: Element): BrowserFormControlKind {
  if (element instanceof HTMLSelectElement) {
    return element.multiple ? "select-multiple" : "select-one";
  }
  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox") return "checkbox";
    if (element.type === "radio") return "radio";
    return TEXT_INPUT_TYPES.has(element.type.toLowerCase())
      ? "text"
      : "unsupported";
  }
  if (
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  ) {
    return "text";
  }
  return "unsupported";
}

function isFormControlDisabled(element: Element): boolean {
  return (
    ("disabled" in element &&
      Boolean((element as { disabled?: boolean }).disabled)) ||
    element.getAttribute("aria-disabled") === "true"
  );
}

function isFormControlReadOnly(element: Element): boolean {
  return (
    ("readOnly" in element &&
      Boolean((element as { readOnly?: boolean }).readOnly)) ||
    element.getAttribute("aria-readonly") === "true"
  );
}

function formControlToken(element: Element): string {
  const existing = formControlTokens.get(element);
  if (existing) return existing;
  formControlTokenSequence += 1;
  const token = `${formControlTokenPrefix}:${formControlTokenSequence}`;
  formControlTokens.set(element, token);
  return token;
}

function selectOptionCandidates(
  element: HTMLSelectElement,
): SelectOptionCandidate[] {
  return Array.from(element.options, (option, index) => ({
    index,
    value: option.value,
    label: option.label,
    text: option.text,
    disabled: option.disabled || Boolean(option.parentElement?.closest("optgroup")?.disabled),
    selected: option.selected,
  }));
}

function serializeEvaluationResult(value: unknown): {
  value: string;
  truncated: boolean;
} {
  let serialized: string;
  try {
    serialized = JSON.stringify(value, jsonSafeReplacer, 2);
  } catch {
    serialized = String(value);
  }
  const truncated = serialized.length > MAX_EVALUATE_RESULT_CHARS;
  return {
    value: truncated
      ? serialized.slice(0, MAX_EVALUATE_RESULT_CHARS)
      : serialized,
    truncated,
  };
}

function parseSerializedEvaluationResult(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function jsonSafeReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Element) {
    return {
      tagName: value.tagName.toLowerCase(),
      selector: getCssSelector(value),
      text: sanitizeText(value.textContent ?? "", 300),
    };
  }
  if (typeof value === "function") {
    return "[function]";
  }
  return value;
}

export function storageToRecordSnapshot(
  storage: Storage,
  includeValues: boolean,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null) {
      result[key] = includeValues ? storage.getItem(key) ?? "" : "[value omitted]";
    }
  }
  return result;
}

function debuggerBlockingFrameReason(
  src: string,
  ownExtensionRoot: string,
  includeBlobAndFilesystem: boolean,
): string | null {
  const value = src.trim();
  if (value.startsWith("chrome-extension://") && !value.startsWith(ownExtensionRoot)) {
    return "different-extension-frame";
  }
  if (
    includeBlobAndFilesystem &&
    (value.startsWith("blob:") || value.startsWith("filesystem:"))
  ) {
    return "opaque-frame-url";
  }
  return null;
}

function getAnyShadowRoot(element: Element): ShadowRoot | null {
  if (element.shadowRoot) {
    return element.shadowRoot;
  }
  try {
    return chrome.dom?.openOrClosedShadowRoot?.(element as HTMLElement) ?? null;
  } catch {
    return null;
  }
}

function toRectSnapshot(rect: DOMRect): DomRectSnapshot {
  return {
    x: round(rect.x),
    y: round(rect.y),
    top: round(rect.top),
    right: round(rect.right),
    bottom: round(rect.bottom),
    left: round(rect.left),
    width: round(rect.width),
    height: round(rect.height),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

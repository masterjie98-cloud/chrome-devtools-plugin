import type {
  BrowserCoordinateClickInput,
  BrowserCoordinateDragInput,
  BrowserCoordinateInput,
  BrowserMouseWheelInput,
  BrowserElementRectResult,
} from "../shared/dom";

export interface TrustedMouseEventParams {
  type: "mouseMoved" | "mousePressed" | "mouseReleased" | "mouseWheel";
  x: number;
  y: number;
  button?: "none" | "left" | "right" | "middle";
  buttons?: number;
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
}

export function requireTrustedElementPoint(
  result: BrowserElementRectResult,
  label = "element",
): { x: number; y: number } {
  if (!result.matched) {
    throw new Error(
      `TRUSTED_INPUT_TARGET_NOT_FOUND: ${label} matched no element in the current document. Do not retry the unchanged selector. Read one fresh browser_snapshot or browser_query_dom result, reuse its exact native CSS selector, and then retry only if the target still exists.`,
    );
  }
  if (
    result.centerX === undefined ||
    result.centerY === undefined ||
    !Number.isFinite(result.centerX) ||
    !Number.isFinite(result.centerY) ||
    result.inViewport !== true
  ) {
    throw new Error(
      `TRUSTED_INPUT_TARGET_NOT_VISIBLE: ${label} has no usable point in the selected viewport. Re-read the current DOM before retrying.`,
    );
  }
  if (result.hitTestPassed !== true) {
    throw new Error(
      `TRUSTED_INPUT_TARGET_OCCLUDED: ${label} is covered or does not receive pointer events in its visible area.`,
    );
  }
  return { x: result.centerX, y: result.centerY };
}

export function requireTrustedElementFocus(
  result: BrowserElementRectResult,
  label = "element",
): void {
  if (result.focused !== true) {
    throw new Error(
      `TRUSTED_INPUT_FOCUS_FAILED: ${label} did not become the active element. Use a focusable input, textarea, contenteditable element, or omit the selector to target the current focus.`,
    );
  }
}

export function requireTrustedTextTarget(
  result: BrowserElementRectResult,
  label = "element",
): void {
  if (result.editable !== true) {
    throw new Error(
      `TRUSTED_INPUT_NOT_EDITABLE: ${label} must resolve to an enabled, writable text input, textarea, or contenteditable element.`,
    );
  }
}

export function trustedMouseMoveEvent(
  input: BrowserCoordinateInput,
): TrustedMouseEventParams {
  return {
    type: "mouseMoved",
    x: input.x,
    y: input.y,
    button: "none",
  };
}

export function trustedMouseClickEvents(
  input: BrowserCoordinateClickInput,
): TrustedMouseEventParams[] {
  const button = input.button ?? "left";
  const events: TrustedMouseEventParams[] = [trustedMouseMoveEvent(input)];
  const clicks = input.doubleClick ? 2 : 1;
  for (let clickCount = 1; clickCount <= clicks; clickCount += 1) {
    events.push(
      {
        type: "mousePressed",
        x: input.x,
        y: input.y,
        button,
        buttons: mouseButtonMask(button),
        clickCount,
      },
      {
        type: "mouseReleased",
        x: input.x,
        y: input.y,
        button,
        buttons: 0,
        clickCount,
      },
    );
  }
  return events;
}

export function trustedMouseDownEvent(
  input: BrowserCoordinateClickInput,
): TrustedMouseEventParams {
  const button = input.button ?? "left";
  return {
    type: "mousePressed",
    x: input.x,
    y: input.y,
    button,
    buttons: mouseButtonMask(button),
    clickCount: 1,
  };
}

export function trustedMouseUpEvent(
  input: BrowserCoordinateClickInput,
): TrustedMouseEventParams {
  return {
    type: "mouseReleased",
    x: input.x,
    y: input.y,
    button: input.button ?? "left",
    buttons: 0,
    clickCount: 1,
  };
}

export function trustedMouseDragEvents(
  input: BrowserCoordinateDragInput,
): TrustedMouseEventParams[] {
  const steps = Math.max(1, Math.min(50, Math.round(input.steps ?? 12)));
  const events: TrustedMouseEventParams[] = [
    {
      type: "mousePressed",
      x: input.startX,
      y: input.startY,
      button: "left",
      buttons: 1,
      clickCount: 1,
    },
  ];
  for (let index = 1; index <= steps; index += 1) {
    const ratio = index / steps;
    events.push({
      type: "mouseMoved",
      x: input.startX + (input.endX - input.startX) * ratio,
      y: input.startY + (input.endY - input.startY) * ratio,
      button: "left",
      buttons: 1,
    });
  }
  events.push({
    type: "mouseReleased",
    x: input.endX,
    y: input.endY,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  return events;
}

export function trustedMouseWheelEvent(
  input: BrowserMouseWheelInput,
  point: { x: number; y: number },
): TrustedMouseEventParams {
  return {
    type: "mouseWheel",
    x: point.x,
    y: point.y,
    deltaX: input.deltaX ?? 0,
    deltaY: input.deltaY ?? 0,
  };
}

function mouseButtonMask(button: "left" | "right" | "middle"): number {
  if (button === "right") {
    return 2;
  }
  if (button === "middle") {
    return 4;
  }
  return 1;
}

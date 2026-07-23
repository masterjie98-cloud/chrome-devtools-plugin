import {
  captureVisibleTab,
  closeActiveTab,
  deleteCookie,
  downloadDataUrl,
  goBackActiveTab,
  goForwardActiveTab,
  getSelectedContentFrame,
  getSelectedContentFrameSnapshot,
  getContentFrameSnapshot,
  injectContentScript,
  isTabUrlScriptable,
  listTargetTabs,
  listTargetFrames,
  listRegisteredContentFrames,
  listCookies,
  navigateActiveTab,
  queryActiveTab,
  reloadActiveTab,
  resizeActiveWindow,
  sendTabRequest,
  selectTargetTab,
  selectTargetFrame,
  setCookie,
} from "./chromeApi";
import { getTargetNavigationState } from "./targetNavigation";
import {
  listDynamicRuleSummaries,
  removeRule,
  upsertGetMockRule,
  upsertHeaderRule,
} from "./dnrRules";
import {
  clearNetworkDebugger,
  clearProxyRules,
  captureDebuggerScreenshot,
  detachDebugger,
  disableProxyDebugger,
  dispatchTrustedMouseClick,
  dispatchTrustedMouseDown,
  dispatchTrustedMouseDrag,
  dispatchTrustedMouseMove,
  dispatchTrustedMouseUp,
  dispatchTrustedMouseWheel,
  dispatchTrustedKeyPress,
  dispatchTrustedTextInput,
  enableProxyDebugger,
  getNetworkRequest,
  getNetworkResponseBody,
  handleCurrentJavaScriptDialog,
  listConsoleMessages,
  listProxyHits,
  listProxyRules,
  listNetworkRequests,
  prepareFetchDebugger,
  removeProxyRule,
  startNetworkDebugger,
  stopNetworkDebugger,
  upsertProxyRule,
  type TrustedInputTargetAddress,
} from "./debuggerAdapter";
import {
  requireTrustedElementFocus,
  requireTrustedElementPoint,
  requireTrustedTextTarget,
} from "./trustedInput";
import {
  MESSAGE_TYPES,
  type ExtensionRequest,
  type RequestOf,
  type ResponsePayloadMap,
} from "../shared/messages";
import { createMessageId } from "../shared/messaging";
import { attachPageSnapshotProvenance } from "../shared/pageSnapshotProvenance";
import {
  TOOL_NAMES,
  normalizeToolCall,
  validateToolCall,
  type AnyToolCall,
  type ToolExecutionResult,
} from "../shared/tools";
import type {
  BrowserClickInput,
  AgentPointerInput,
  BrowserCoordinateClickInput,
  BrowserCoordinateDragInput,
  BrowserCoordinateInput,
  BrowserDragInput,
  BrowserDragResult,
  BrowserElementActionResult,
  BrowserElementRectResult,
  BrowserFillFormFieldResult,
  BrowserFillFormInput,
  BrowserFillFormResult,
  BrowserFormControlInspectInput,
  BrowserFormControlInspectResult,
  BrowserFormControlKind,
  BrowserHoverInput,
  BrowserMouseWheelInput,
  BrowserPressKeyInput,
  BrowserSelectOptionInput,
  BrowserTypeInput,
  BrowserTargetFrame,
  FramePageSnapshot,
  MultiFramePageSnapshot,
  PageSnapshotInput,
  PageSnapshotTarget,
  ScreenshotCaptureInput,
} from "../shared/dom";

type ContentRequestType =
  | typeof MESSAGE_TYPES.CONTENT_GET_PAGE_INFO
  | typeof MESSAGE_TYPES.CONTENT_QUERY_DOM
  | typeof MESSAGE_TYPES.CONTENT_START_ELEMENT_PICK
  | typeof MESSAGE_TYPES.CONTENT_CANCEL_ELEMENT_PICK
  | typeof MESSAGE_TYPES.CONTENT_HIGHLIGHT_ELEMENT
  | typeof MESSAGE_TYPES.CONTENT_CLEAR_HIGHLIGHTS
  | typeof MESSAGE_TYPES.CONTENT_SET_DOM_VALUE
  | typeof MESSAGE_TYPES.CONTENT_GET_ELEMENT_RECT
  | typeof MESSAGE_TYPES.CONTENT_CLICK_ELEMENT
  | typeof MESSAGE_TYPES.CONTENT_HOVER_ELEMENT
  | typeof MESSAGE_TYPES.CONTENT_DRAG_ELEMENT
  | typeof MESSAGE_TYPES.CONTENT_INSPECT_FORM_CONTROL
  | typeof MESSAGE_TYPES.CONTENT_SELECT_OPTION
  | typeof MESSAGE_TYPES.CONTENT_MOUSE_MOVE
  | typeof MESSAGE_TYPES.CONTENT_MOUSE_CLICK
  | typeof MESSAGE_TYPES.CONTENT_MOUSE_DOWN
  | typeof MESSAGE_TYPES.CONTENT_MOUSE_UP
  | typeof MESSAGE_TYPES.CONTENT_MOUSE_DRAG
  | typeof MESSAGE_TYPES.CONTENT_MOUSE_WHEEL
  | typeof MESSAGE_TYPES.CONTENT_AGENT_POINTER
  | typeof MESSAGE_TYPES.CONTENT_WAIT_FOR
  | typeof MESSAGE_TYPES.CONTENT_EVALUATE
  | typeof MESSAGE_TYPES.CONTENT_GET_STORAGE_STATE
  | typeof MESSAGE_TYPES.CONTENT_APPLY_CSS_PATCH
  | typeof MESSAGE_TYPES.CONTENT_REMOVE_CSS_PATCH;

const AGENT_POINTER_PRESENTATION_TIMEOUT_MS = 650;

export interface ToolExecutionAuthorization {
  approvalRequired: boolean;
}

export async function executeToolCall(
  call: AnyToolCall,
  authorization?: ToolExecutionAuthorization,
): Promise<ToolExecutionResult> {
  const normalizedCall = normalizeToolCall(call) ?? call;
  const validationError = validateToolCall(normalizedCall);
  if (validationError) {
    throw new Error(validationError);
  }

  switch (normalizedCall.toolName) {
    case TOOL_NAMES.DOM_GET_PAGE_INFO: {
      if (
        normalizedCall.args.frameScope === "auto" ||
        normalizedCall.args.frameScope === "all-accessible"
      ) {
        return {
          toolName: normalizedCall.toolName,
          data: await readMultiFramePageSnapshot(normalizedCall.args),
        };
      }
      const pageRead = await forwardContentRequestWithTarget(
        MESSAGE_TYPES.CONTENT_GET_PAGE_INFO,
        normalizedCall.args,
      );
      return {
        toolName: normalizedCall.toolName,
        data: attachPageSnapshotProvenance(pageRead.payload, pageRead.target),
      };
    }
    case TOOL_NAMES.DOM_QUERY:
      return {
        toolName: normalizedCall.toolName,
        data: await forwardContentRequest(
          MESSAGE_TYPES.CONTENT_QUERY_DOM,
          normalizedCall.args,
        ),
      };
    case TOOL_NAMES.DOM_START_ELEMENT_PICK:
      return {
        toolName: normalizedCall.toolName,
        data: await forwardContentRequest(
          MESSAGE_TYPES.CONTENT_START_ELEMENT_PICK,
          {},
        ),
      };
    case TOOL_NAMES.DOM_CANCEL_ELEMENT_PICK:
      return {
        toolName: normalizedCall.toolName,
        data: await forwardContentRequest(
          MESSAGE_TYPES.CONTENT_CANCEL_ELEMENT_PICK,
          {},
        ),
      };
    case TOOL_NAMES.DOM_HIGHLIGHT_ELEMENT:
      return {
        toolName: normalizedCall.toolName,
        data: await forwardContentRequest(
          MESSAGE_TYPES.CONTENT_HIGHLIGHT_ELEMENT,
          normalizedCall.args,
        ),
      };
    case TOOL_NAMES.DOM_CLEAR_HIGHLIGHTS:
      return {
        toolName: normalizedCall.toolName,
        data: await forwardContentRequest(
          MESSAGE_TYPES.CONTENT_CLEAR_HIGHLIGHTS,
          {},
        ),
      };
    case TOOL_NAMES.DOM_SET_VALUE:
      return {
        toolName: normalizedCall.toolName,
        data: await forwardContentRequest(
          MESSAGE_TYPES.CONTENT_SET_DOM_VALUE,
          normalizedCall.args,
        ),
      };
    case TOOL_NAMES.CSS_APPLY_PATCH:
      return {
        toolName: normalizedCall.toolName,
        data: await forwardContentRequest(
          MESSAGE_TYPES.CONTENT_APPLY_CSS_PATCH,
          normalizedCall.args,
        ),
      };
    case TOOL_NAMES.CSS_REMOVE_PATCH:
      return {
        toolName: normalizedCall.toolName,
        data: await forwardContentRequest(
          MESSAGE_TYPES.CONTENT_REMOVE_CSS_PATCH,
          normalizedCall.args,
        ),
      };
    case TOOL_NAMES.BROWSER_TAKE_SCREENSHOT:
      return {
        toolName: normalizedCall.toolName,
        data: await takeScreenshot(normalizedCall.args),
      };
    case TOOL_NAMES.BROWSER_LIST_TABS:
      return {
        toolName: normalizedCall.toolName,
        data: await listTargetTabs(),
      };
    case TOOL_NAMES.BROWSER_SET_TARGET_TAB:
      return {
        toolName: normalizedCall.toolName,
        data: await selectTargetTab(normalizedCall.args),
      };
    case TOOL_NAMES.BROWSER_LIST_FRAMES:
      return {
        toolName: normalizedCall.toolName,
        data: await listTargetFrames(),
      };
    case TOOL_NAMES.BROWSER_SET_TARGET_FRAME:
      return {
        toolName: normalizedCall.toolName,
        data: await selectTargetFrame(normalizedCall.args),
      };
    case TOOL_NAMES.BROWSER_NAVIGATE:
      return {
        toolName: normalizedCall.toolName,
        data: await navigateActiveTab(normalizedCall.args),
      };
    case TOOL_NAMES.BROWSER_NAVIGATE_BACK:
      return {
        toolName: normalizedCall.toolName,
        data: await goBackActiveTab(),
      };
    case TOOL_NAMES.BROWSER_NAVIGATE_FORWARD:
      return {
        toolName: normalizedCall.toolName,
        data: await goForwardActiveTab(),
      };
    case TOOL_NAMES.BROWSER_RELOAD:
      return {
        toolName: normalizedCall.toolName,
        data: await reloadActiveTab(),
      };
    case TOOL_NAMES.BROWSER_CLOSE:
      return {
        toolName: normalizedCall.toolName,
        data: await closeActiveTab(),
      };
    case TOOL_NAMES.BROWSER_RESIZE:
      return {
        toolName: normalizedCall.toolName,
        data: await resizeActiveWindow(normalizedCall.args),
      };
    case TOOL_NAMES.BROWSER_CLICK:
      return {
        toolName: normalizedCall.toolName,
        data: await clickElementWithTrustedInput(
          normalizedCall.args,
          authorization,
        ),
      };
    case TOOL_NAMES.BROWSER_HOVER:
      return {
        toolName: normalizedCall.toolName,
        data: await hoverElementWithTrustedInput(normalizedCall.args),
      };
    case TOOL_NAMES.BROWSER_DRAG:
      return {
        toolName: normalizedCall.toolName,
        data: await dragElementWithTrustedInput(normalizedCall.args),
      };
    case TOOL_NAMES.BROWSER_FILL_FORM:
      return {
        toolName: normalizedCall.toolName,
        data: await fillFormWithTrustedInput(
          normalizedCall.args,
          authorization,
        ),
      };
    case TOOL_NAMES.BROWSER_TYPE:
      return {
        toolName: normalizedCall.toolName,
        data: await typeElementWithTrustedInput(
          normalizedCall.args,
          authorization,
        ),
      };
    case TOOL_NAMES.BROWSER_PRESS_KEY:
      return {
        toolName: normalizedCall.toolName,
        data: await pressKeyWithTrustedInput(
          normalizedCall.args,
          authorization,
        ),
      };
    case TOOL_NAMES.BROWSER_SELECT_OPTION:
      return {
        toolName: normalizedCall.toolName,
        data: await selectOptionWithScopedDom(normalizedCall.args),
      };
    case TOOL_NAMES.BROWSER_MOUSE_MOVE: {
      const target = await requireTrustedInputTarget();
      await presentAgentPointerBestEffort(
        { action: "move", ...normalizedCall.args },
        target,
      );
      return {
        toolName: normalizedCall.toolName,
        data: await dispatchTrustedMouseMove(normalizedCall.args, target),
      };
    }
    case TOOL_NAMES.BROWSER_MOUSE_CLICK: {
      const target = await requireTrustedInputTarget();
      await presentAgentPointerBestEffort(
        {
          action: normalizedCall.args.doubleClick ? "doubleClick" : "click",
          x: normalizedCall.args.x,
          y: normalizedCall.args.y,
        },
        target,
      );
      return {
        toolName: normalizedCall.toolName,
        data: await dispatchTrustedMouseClick(normalizedCall.args, target),
      };
    }
    case TOOL_NAMES.BROWSER_MOUSE_DOWN: {
      const target = await requireTrustedInputTarget();
      await presentAgentPointerBestEffort(
        { action: "down", x: normalizedCall.args.x, y: normalizedCall.args.y },
        target,
      );
      return {
        toolName: normalizedCall.toolName,
        data: await dispatchTrustedMouseDown(normalizedCall.args, target),
      };
    }
    case TOOL_NAMES.BROWSER_MOUSE_UP: {
      const target = await requireTrustedInputTarget();
      await presentAgentPointerBestEffort(
        { action: "up", x: normalizedCall.args.x, y: normalizedCall.args.y },
        target,
      );
      return {
        toolName: normalizedCall.toolName,
        data: await dispatchTrustedMouseUp(normalizedCall.args, target),
      };
    }
    case TOOL_NAMES.BROWSER_MOUSE_DRAG: {
      const target = await requireTrustedInputTarget();
      await presentAgentPointerBestEffort(
        {
          action: "drag",
          x: normalizedCall.args.startX,
          y: normalizedCall.args.startY,
          endX: normalizedCall.args.endX,
          endY: normalizedCall.args.endY,
        },
        target,
      );
      return {
        toolName: normalizedCall.toolName,
        data: await dispatchTrustedMouseDrag(normalizedCall.args, target),
      };
    }
    case TOOL_NAMES.BROWSER_MOUSE_WHEEL: {
      const target = await requireTrustedInputTarget();
      if (
        normalizedCall.args.x !== undefined &&
        normalizedCall.args.y !== undefined
      ) {
        await presentAgentPointerBestEffort(
          {
            action: "wheel",
            x: normalizedCall.args.x,
            y: normalizedCall.args.y,
          },
          target,
        );
      }
      const data = await dispatchTrustedMouseWheel(normalizedCall.args, target);
      if (
        (normalizedCall.args.x === undefined ||
          normalizedCall.args.y === undefined) &&
        data.x !== undefined &&
        data.y !== undefined
      ) {
        await presentAgentPointerBestEffort(
          { action: "wheel", x: data.x, y: data.y },
          target,
        );
      }
      return {
        toolName: normalizedCall.toolName,
        data,
      };
    }
    case TOOL_NAMES.BROWSER_WAIT_FOR:
      return {
        toolName: normalizedCall.toolName,
        data: await forwardContentRequest(
          MESSAGE_TYPES.CONTENT_WAIT_FOR,
          normalizedCall.args,
        ),
      };
    case TOOL_NAMES.BROWSER_EVALUATE:
      throw new Error(
        "browser.evaluate is disabled until constrained execution has a scoped, cancellable design.",
      );
    case TOOL_NAMES.BROWSER_HANDLE_DIALOG: {
      const tab = await queryActiveTab();
      if (!tab?.id) {
        throw new Error("No active tab is available.");
      }
      return {
        toolName: normalizedCall.toolName,
        data: await handleCurrentJavaScriptDialog(normalizedCall.args, tab.id),
      };
    }
    case TOOL_NAMES.BROWSER_STORAGE_STATE: {
      const storageState = await forwardContentRequest(
        MESSAGE_TYPES.CONTENT_GET_STORAGE_STATE,
        normalizedCall.args,
      );
      if (normalizedCall.args.includeCookies === false) {
        return {
          toolName: normalizedCall.toolName,
          data: storageState,
        };
      }
      return {
        toolName: normalizedCall.toolName,
        data: {
          ...storageState,
          cookies: (
            await listCookies({
              url: storageState.url,
              includeValues: normalizedCall.args.includeValues === true,
            })
          ).cookies,
        },
      };
    }
    case TOOL_NAMES.BROWSER_COOKIE_LIST:
      return {
        toolName: normalizedCall.toolName,
        data: await listCookies(normalizedCall.args),
      };
    case TOOL_NAMES.BROWSER_COOKIE_SET:
      return {
        toolName: normalizedCall.toolName,
        data: await setCookie(normalizedCall.args),
      };
    case TOOL_NAMES.BROWSER_COOKIE_DELETE:
      return {
        toolName: normalizedCall.toolName,
        data: await deleteCookie(normalizedCall.args),
      };
    case TOOL_NAMES.BROWSER_CONSOLE_MESSAGES:
      return {
        toolName: normalizedCall.toolName,
        data: await listConsoleMessages(normalizedCall.args),
      };
    case TOOL_NAMES.DNR_LIST_RULES:
      return {
        toolName: normalizedCall.toolName,
        data: await listDynamicRuleSummaries(),
      };
    case TOOL_NAMES.DNR_UPSERT_HEADER_RULE:
      return {
        toolName: normalizedCall.toolName,
        data: await upsertHeaderRule(normalizedCall.args),
      };
    case TOOL_NAMES.DNR_REMOVE_RULE:
      return {
        toolName: normalizedCall.toolName,
        data: await removeRule(normalizedCall.args),
      };
    case TOOL_NAMES.MOCK_UPSERT_GET:
      return {
        toolName: normalizedCall.toolName,
        data: await upsertGetMockRule(normalizedCall.args),
      };
    case TOOL_NAMES.MOCK_REMOVE:
      return {
        toolName: normalizedCall.toolName,
        data: await removeRule(normalizedCall.args),
      };
    case TOOL_NAMES.DEBUGGER_FETCH_PREPARE:
      return {
        toolName: normalizedCall.toolName,
        data: await prepareFetchDebugger(normalizedCall.args),
      };
    case TOOL_NAMES.DEBUGGER_PROXY_ENABLE:
      return {
        toolName: normalizedCall.toolName,
        data: await enableProxyDebugger(),
      };
    case TOOL_NAMES.DEBUGGER_PROXY_DISABLE:
      return {
        toolName: normalizedCall.toolName,
        data: await disableProxyDebugger(),
      };
    case TOOL_NAMES.DEBUGGER_PROXY_LIST_RULES:
      return {
        toolName: normalizedCall.toolName,
        data: await listProxyRules(),
      };
    case TOOL_NAMES.DEBUGGER_PROXY_UPSERT_RULE:
      return {
        toolName: normalizedCall.toolName,
        data: await upsertProxyRule(normalizedCall.args),
      };
    case TOOL_NAMES.DEBUGGER_PROXY_REMOVE_RULE:
      return {
        toolName: normalizedCall.toolName,
        data: await removeProxyRule(normalizedCall.args),
      };
    case TOOL_NAMES.DEBUGGER_PROXY_CLEAR_RULES:
      return {
        toolName: normalizedCall.toolName,
        data: await clearProxyRules(),
      };
    case TOOL_NAMES.DEBUGGER_PROXY_LIST_HITS:
      return {
        toolName: normalizedCall.toolName,
        data: listProxyHits(normalizedCall.args),
      };
    case TOOL_NAMES.DEBUGGER_NETWORK_START:
      return {
        toolName: normalizedCall.toolName,
        data: await startNetworkDebugger(normalizedCall.args),
      };
    case TOOL_NAMES.DEBUGGER_NETWORK_STOP:
      return {
        toolName: normalizedCall.toolName,
        data: await stopNetworkDebugger(),
      };
    case TOOL_NAMES.DEBUGGER_NETWORK_CLEAR:
      return {
        toolName: normalizedCall.toolName,
        data: clearNetworkDebugger(),
      };
    case TOOL_NAMES.DEBUGGER_NETWORK_LIST:
      return {
        toolName: normalizedCall.toolName,
        data: listNetworkRequests(normalizedCall.args),
      };
    case TOOL_NAMES.DEBUGGER_NETWORK_GET:
      return {
        toolName: normalizedCall.toolName,
        data: await getNetworkRequest(normalizedCall.args),
      };
    case TOOL_NAMES.DEBUGGER_NETWORK_GET_BODY:
      return {
        toolName: normalizedCall.toolName,
        data: await getNetworkResponseBody(normalizedCall.args),
      };
    case TOOL_NAMES.DEBUGGER_DETACH:
      return {
        toolName: normalizedCall.toolName,
        data: await detachDebugger(normalizedCall.args),
      };
    default:
      throw new Error("Tool is not supported.");
  }
}

async function readMultiFramePageSnapshot(
  input: PageSnapshotInput,
): Promise<MultiFramePageSnapshot> {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    throw new Error("No active tab is available.");
  }
  if (!isTabUrlScriptable(tab.url)) {
    throw new Error("The active tab does not allow extension content scripts.");
  }
  const targetTab = { ...tab, id: tab.id };

  const frameScope =
    input.frameScope === "all-accessible" ? "all-accessible" : "auto";
  const registeredFrames = listRegisteredContentFrames(tab.id);
  if (registeredFrames.length === 0) {
    throw new Error(
      "FRAME_UNAVAILABLE: no accessible content frame has registered for the selected tab.",
    );
  }

  const requestedLimit = input.limit ?? 50;
  const requestedSourceLimit = input.sourceLimit ?? 2_000;
  const defaultMaxFrames = frameScope === "auto" ? 4 : 8;
  const frameCount = Math.min(
    registeredFrames.length,
    input.maxFrames ?? defaultMaxFrames,
    requestedLimit,
    Math.max(1, Math.floor(requestedSourceLimit / 100)),
  );
  const frames = registeredFrames.slice(0, frameCount);
  const outputLimits = allocateFrameBudget(requestedLimit, frames.length, 1);
  const sourceLimits = allocateFrameBudget(
    requestedSourceLimit,
    frames.length,
    100,
  );
  const selectedFrameId = getSelectedContentFrame(tab.id).frameId;

  const settled = await Promise.allSettled(
    frames.map((frame, index) =>
      readPageSnapshotForFrame(targetTab, frame, {
        ...input,
        cursor: undefined,
        frameScope: "selected",
        maxFrames: undefined,
        limit: outputLimits[index],
        sourceLimit: sourceLimits[index],
        sinceRevision:
          frame.frameId === selectedFrameId ? input.sinceRevision : undefined,
      }),
    ),
  );

  const available: FramePageSnapshot[] = [];
  const unavailable: MultiFramePageSnapshot["unavailableFrames"] = [];
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index]!;
    const frame = frames[index]!;
    if (result.status === "fulfilled") {
      available.push(result.value);
      continue;
    }
    const message =
      result.reason instanceof Error
        ? result.reason.message
        : "Frame snapshot failed.";
    unavailable.push({
      frame,
      errorCode: message.startsWith("STALE_FRAME:")
        ? "STALE_FRAME"
        : "FRAME_UNAVAILABLE",
      error: message,
    });
  }

  const omittedFrameCount = registeredFrames.length - frames.length;
  return {
    version: "multi-frame-page-snapshot-v1",
    tabId: tab.id,
    selectedFrameId,
    frameScope,
    capturedAt: new Date().toISOString(),
    complete: unavailable.length === 0 && omittedFrameCount === 0,
    omittedFrameCount,
    frames: available,
    unavailableFrames: unavailable,
  };
}

async function readPageSnapshotForFrame(
  tab: chrome.tabs.Tab & { id: number },
  frame: BrowserTargetFrame,
  input: PageSnapshotInput,
): Promise<FramePageSnapshot> {
  const navigationBefore = getTargetNavigationState(tab.id, false);
  const request = {
    id: createMessageId(),
    source: "background",
    type: MESSAGE_TYPES.CONTENT_GET_PAGE_INFO,
    payload: input,
  } as RequestOf<typeof MESSAGE_TYPES.CONTENT_GET_PAGE_INFO>;
  const address = { frameId: frame.frameId, documentId: frame.documentId };
  let response = await sendTabRequest(tab.id, request, address);
  if (!response.ok && response.error.code === "TAB_MESSAGE_ERROR") {
    await injectContentScript(tab.id, address);
    response = await sendTabRequest(tab.id, request, address);
  }
  if (!response.ok) {
    throw new Error(`FRAME_UNAVAILABLE: ${response.error.message}`);
  }

  const currentFrame = getContentFrameSnapshot(tab.id, address);
  const navigationAfter = getTargetNavigationState(tab.id, false);
  if (
    !currentFrame ||
    currentFrame.documentId !== frame.documentId ||
    navigationAfter.navigationId !== navigationBefore.navigationId ||
    navigationAfter.revision !== navigationBefore.revision
  ) {
    throw new Error(
      "STALE_FRAME: the frame document or top-level navigation changed during capture.",
    );
  }

  const target: PageSnapshotTarget = {
    url: currentFrame.url,
    title: currentFrame.title,
    targetId: String(tab.id),
    tabId: tab.id,
    windowId: tab.windowId,
    frameId: currentFrame.frameId,
    documentId: currentFrame.documentId,
    navigationId: navigationAfter.navigationId,
    revision: navigationAfter.revision,
  };
  return {
    frame: currentFrame,
    pageSnapshot: attachPageSnapshotProvenance(response.payload, target),
  };
}

function allocateFrameBudget(
  total: number,
  count: number,
  minimum: number,
): number[] {
  if (count <= 0) return [];
  const normalizedTotal = Math.max(total, count * minimum);
  const base = Math.floor(normalizedTotal / count);
  let remainder = normalizedTotal - base * count;
  return Array.from({ length: count }, () => {
    const value = base + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    return Math.max(minimum, value);
  });
}

async function clickElementWithTrustedInput(
  input: BrowserClickInput,
  authorization?: ToolExecutionAuthorization,
): Promise<BrowserElementActionResult> {
  const resolved = await resolveTrustedElement(input, "click target", true);
  requireResolvedTargetDecisionBarrier(
    resolved.rect,
    authorization,
    "click target",
  );
  const clickInput: BrowserCoordinateClickInput = {
    ...resolved.point,
    ...(input.button ? { button: input.button } : {}),
    ...(input.doubleClick !== undefined
      ? { doubleClick: input.doubleClick }
      : {}),
  };
  await presentAgentPointerBestEffort(
    {
      action: input.doubleClick ? "doubleClick" : "click",
      x: resolved.point.x,
      y: resolved.point.y,
    },
    resolved.target,
  );
  await dispatchTrustedMouseClick(clickInput, resolved.target);
  return trustedElementActionResult(resolved.rect, "click", resolved.point);
}

async function hoverElementWithTrustedInput(
  input: BrowserHoverInput,
): Promise<BrowserElementActionResult> {
  const resolved = await resolveTrustedElement(input, "hover target", true);
  await presentAgentPointerBestEffort(
    { action: "move", x: resolved.point.x, y: resolved.point.y },
    resolved.target,
  );
  await dispatchTrustedMouseMove(resolved.point, resolved.target);
  return trustedElementActionResult(resolved.rect, "hover", resolved.point);
}

async function typeElementWithTrustedInput(
  input: BrowserTypeInput,
  authorization?: ToolExecutionAuthorization,
): Promise<BrowserElementActionResult> {
  const resolved = await focusTrustedElement(input, "type target");
  requireTrustedTextTarget(resolved.rect, "type target");
  requireResolvedTargetDecisionBarrier(
    resolved.rect,
    authorization,
    "type target",
    input.submit === true,
  );
  await presentAgentPointerBestEffort(
    { action: "type", x: resolved.point.x, y: resolved.point.y },
    resolved.target,
  );
  await dispatchTrustedTextInput(input, resolved.target);
  return trustedElementActionResult(resolved.rect, "type", resolved.point);
}

interface ResolvedTrustedFormControl {
  inspection: BrowserFormControlInspectResult;
  point?: BrowserCoordinateInput;
  target: PageSnapshotTarget & { tabId: number };
}

interface FormFieldPlan {
  field: BrowserFillFormInput["fields"][number];
  resolved: ResolvedTrustedFormControl;
}

async function fillFormWithTrustedInput(
  input: BrowserFillFormInput,
  authorization?: ToolExecutionAuthorization,
): Promise<BrowserFillFormResult> {
  const plans: FormFieldPlan[] = [];
  for (const field of input.fields) {
    plans.push({ field, resolved: await preflightFormField(field) });
  }
  for (const plan of plans) {
    requireResolvedTargetDecisionBarrier(
      plan.resolved.inspection,
      authorization,
      formFieldLabel(plan.field),
      false,
      true,
    );
  }

  const fields: BrowserFillFormFieldResult[] = [];
  for (const plan of plans) {
    try {
      fields.push(await executeFormFieldPlan(plan));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (fields.length > 0) {
        throw new Error(
          `FORM_FILL_PARTIAL_FAILURE: ${fields.length} of ${plans.length} fields completed before execution stopped. Re-read the form before retrying. Cause: ${message}`,
        );
      }
      throw error;
    }
  }

  return { filled: true, fields };
}

async function preflightFormField(
  field: BrowserFillFormInput["fields"][number],
): Promise<ResolvedTrustedFormControl> {
  const label = formFieldLabel(field);
  const structural = await resolveTrustedFormControl(
    formControlInspectInput(field),
    label,
    false,
    false,
    false,
  );
  validateFormField(field, structural.inspection, label);

  if (!isSelectControl(structural.inspection.controlKind)) {
    return structural;
  }
  const resolved = await resolveTrustedFormControl(
    formControlInspectInput(field, selectValues(field.value, label)),
    label,
    false,
    false,
    false,
  );
  assertSameFormControl(structural, resolved, label);
  validateFormField(field, resolved.inspection, label);
  return resolved;
}

async function executeFormFieldPlan(
  plan: FormFieldPlan,
): Promise<BrowserFillFormFieldResult> {
  const { field } = plan;
  const label = formFieldLabel(field);
  const kind = plan.resolved.inspection.controlKind;
  const values = isSelectControl(kind)
    ? selectValues(field.value, label)
    : undefined;
  const current = await resolveTrustedFormControl(
    formControlInspectInput(field, values),
    label,
    true,
    kind === "text",
    true,
  );
  assertSameFormControl(plan.resolved, current, label);
  validateFormField(field, current.inspection, label);

  if (kind === "text") {
    requireTrustedElementFocus(current.inspection, label);
    requireTrustedTextTarget(current.inspection, label);
    if (current.point) {
      await presentAgentPointerBestEffort(
        { action: "type", x: current.point.x, y: current.point.y },
        current.target,
      );
    }
    await dispatchTrustedTextInput(
      { text: field.value as string, replace: true },
      current.target,
    );
    return formFieldResult(field, current, true);
  }

  if (kind === "checkbox" || kind === "radio") {
    const desired = field.value as boolean;
    const changed = current.inspection.checked !== desired;
    if (changed) {
      if (!current.point) {
        throw new Error(`TRUSTED_INPUT_TARGET_NOT_VISIBLE: ${label} has no point.`);
      }
      await presentAgentPointerBestEffort(
        { action: "click", x: current.point.x, y: current.point.y },
        current.target,
      );
      await dispatchTrustedMouseClick(current.point, current.target);
      const verified = await resolveTrustedFormControl(
        formControlInspectInput(field),
        label,
        false,
        false,
        false,
      );
      assertSameFormControl(current, verified, label);
      if (verified.inspection.checked !== desired) {
        throw new Error(
          `FORM_CONTROL_STATE_MISMATCH: ${label} did not reach the requested checked state.`,
        );
      }
    }
    return formFieldResult(field, current, changed);
  }

  if (isSelectControl(kind) && values) {
    const selected = await applyScopedSelect(current, values);
    return {
      ...selected,
      action: "fillForm",
      name: field.name,
      controlKind: kind,
    };
  }

  throw new Error(`FORM_CONTROL_UNSUPPORTED: ${label} cannot be filled safely.`);
}

async function selectOptionWithScopedDom(
  input: BrowserSelectOptionInput,
): Promise<BrowserElementActionResult> {
  const label = "select target";
  const resolved = await resolveTrustedFormControl(
    { ...input, scrollIntoView: true, requireHitTest: true },
    label,
    true,
    false,
    true,
  );
  validateSelectControl(resolved.inspection, label);
  return applyScopedSelect(resolved, input.values);
}

async function applyScopedSelect(
  resolved: ResolvedTrustedFormControl,
  values: string[],
): Promise<BrowserElementActionResult> {
  const token = resolved.inspection.elementToken;
  const controlKind = resolved.inspection.controlKind;
  if (!token || !resolved.point || !isSelectControl(controlKind)) {
    throw new Error(
      "STALE_FORM_CONTROL: select inspection did not include a stable element token, type, and point.",
    );
  }
  await presentAgentPointerBestEffort(
    { action: "select", x: resolved.point.x, y: resolved.point.y },
    resolved.target,
  );
  const response = await forwardContentRequestWithTarget(
    MESSAGE_TYPES.CONTENT_SELECT_OPTION,
    {
      selector: resolved.inspection.selector,
      values,
      expectedElementToken: token,
      expectedControlKind: controlKind,
    },
  );
  const target = await assertTrustedContentTarget(response.target);
  assertSameTrustedTarget(resolved.target, target);
  return {
    ...response.payload,
    x: resolved.point.x,
    y: resolved.point.y,
  };
}

async function resolveTrustedFormControl(
  input: BrowserFormControlInspectInput,
  label: string,
  scrollIntoView: boolean,
  focusElement: boolean,
  requirePoint: boolean,
): Promise<ResolvedTrustedFormControl> {
  const response = await forwardContentRequestWithTarget(
    MESSAGE_TYPES.CONTENT_INSPECT_FORM_CONTROL,
    {
      ...input,
      scrollIntoView,
      focusElement,
      requireHitTest: requirePoint,
    },
  );
  const target = await assertTrustedContentTarget(response.target);
  if (!response.payload.matched) {
    throw new Error(
      `TRUSTED_INPUT_TARGET_NOT_FOUND: ${label} matched no element in the current document. Do not retry the unchanged selector. Read one fresh browser_snapshot or browser_query_dom result, reuse its exact native CSS selector, and then retry only if the target still exists.`,
    );
  }
  return {
    inspection: response.payload,
    ...(requirePoint
      ? { point: requireTrustedElementPoint(response.payload, label) }
      : {}),
    target,
  };
}

function validateFormField(
  field: BrowserFillFormInput["fields"][number],
  inspection: BrowserFormControlInspectResult,
  label: string,
): void {
  const kind = inspection.controlKind;
  if (!kind || kind === "unsupported") {
    throw new Error(
      `FORM_CONTROL_UNSUPPORTED: ${label} is not a supported text, checkbox, radio, or select control.`,
    );
  }
  if (inspection.disabled) {
    throw new Error(`FORM_CONTROL_DISABLED: ${label} is disabled.`);
  }
  if (!fieldTypeMatches(field.type, kind)) {
    throw new Error(
      `FORM_CONTROL_TYPE_MISMATCH: ${label} resolved to ${kind}, not ${field.type}.`,
    );
  }

  if (kind === "text") {
    if (typeof field.value !== "string") {
      throw new Error(`FORM_CONTROL_VALUE_INVALID: ${label} requires a string value.`);
    }
    if (inspection.readOnly || inspection.editable !== true) {
      throw new Error(`TRUSTED_INPUT_NOT_EDITABLE: ${label} is not writable.`);
    }
    return;
  }
  if (kind === "checkbox" || kind === "radio") {
    if (typeof field.value !== "boolean") {
      throw new Error(`FORM_CONTROL_VALUE_INVALID: ${label} requires a boolean value.`);
    }
    if (kind === "radio" && inspection.checked && field.value === false) {
      throw new Error(
        `TRUSTED_RADIO_UNCHECK_UNSUPPORTED: ${label} cannot be unchecked with a native click; select another radio in the group instead.`,
      );
    }
    return;
  }
  selectValues(field.value, label);
  if (inspection.desiredOptionIndices) {
    validateSelectControl(inspection, label);
  }
}

function validateSelectControl(
  inspection: BrowserFormControlInspectResult,
  label: string,
): void {
  if (!isSelectControl(inspection.controlKind)) {
    throw new Error(`SELECT_TARGET_REQUIRED: ${label} is not a <select> control.`);
  }
  if (inspection.disabled) {
    throw new Error(`FORM_CONTROL_DISABLED: ${label} is disabled.`);
  }
  if (!inspection.elementToken || !inspection.desiredOptionIndices) {
    throw new Error(
      `SELECT_OPTION_PLAN_MISSING: ${label} has no validated option-selection plan.`,
    );
  }
}

function formControlInspectInput(
  field: BrowserFillFormInput["fields"][number],
  values?: string[],
): BrowserFormControlInspectInput {
  return {
    ...(field.selector ? { selector: field.selector } : {}),
    ...(field.target ? { target: field.target } : {}),
    ...(field.element ? { element: field.element } : {}),
    ...(field.name ? { name: field.name } : {}),
    ...(values ? { values } : {}),
  };
}

function selectValues(
  value: string | boolean | string[],
  label: string,
): string[] {
  if (typeof value === "boolean") {
    throw new Error(
      `FORM_CONTROL_VALUE_INVALID: ${label} requires a string or string-array option value.`,
    );
  }
  return Array.isArray(value) ? value : [value];
}

function fieldTypeMatches(
  requested: BrowserFillFormInput["fields"][number]["type"],
  actual: BrowserFormControlKind,
): boolean {
  if (!requested) return true;
  if (requested === "select") return isSelectControl(actual);
  return requested === actual;
}

function isSelectControl(
  kind: BrowserFormControlKind | undefined,
): kind is "select-one" | "select-multiple" {
  return kind === "select-one" || kind === "select-multiple";
}

function assertSameFormControl(
  left: ResolvedTrustedFormControl,
  right: ResolvedTrustedFormControl,
  label: string,
): void {
  assertSameTrustedTarget(left.target, right.target);
  if (
    !left.inspection.elementToken ||
    left.inspection.elementToken !== right.inspection.elementToken ||
    left.inspection.controlKind !== right.inspection.controlKind
  ) {
    throw new Error(
      `STALE_FORM_CONTROL: ${label} changed after preflight; no further form fields were modified.`,
    );
  }
}

function formFieldResult(
  field: BrowserFillFormInput["fields"][number],
  resolved: ResolvedTrustedFormControl,
  changed: boolean,
): BrowserFillFormFieldResult {
  if (!resolved.point || !resolved.inspection.controlKind) {
    throw new Error("FORM_CONTROL_RESULT_INVALID: form field geometry is missing.");
  }
  return {
    ...trustedElementActionResult(
      resolved.inspection,
      "fillForm",
      resolved.point,
    ),
    name: field.name,
    controlKind: resolved.inspection.controlKind,
    changed,
  };
}

function formFieldLabel(
  field: BrowserFillFormInput["fields"][number],
): string {
  return `form field ${JSON.stringify(
    field.selector || field.target || field.element || field.name || "<unknown>",
  )}`;
}

async function pressKeyWithTrustedInput(
  input: BrowserPressKeyInput,
  authorization?: ToolExecutionAuthorization,
): Promise<BrowserElementActionResult> {
  const selector = (input.target || input.selector || "").trim();
  requireKeyDecisionBarrier(input.key, authorization);
  if (selector) {
    const resolved = await focusTrustedElement(
      { selector },
      "key target",
    );
    await presentAgentPointerBestEffort(
      { action: "key", x: resolved.point.x, y: resolved.point.y },
      resolved.target,
    );
    await dispatchTrustedKeyPress(input, resolved.target);
    return trustedElementActionResult(
      resolved.rect,
      "pressKey",
      resolved.point,
    );
  }

  const target = await requireTrustedInputTarget();
  await dispatchTrustedKeyPress(input, target);
  return {
    selector: "<active-element>",
    matched: true,
    action: "pressKey",
    inputMode: "cdp",
  };
}

function requireResolvedTargetDecisionBarrier(
  target: BrowserElementRectResult,
  authorization: ToolExecutionAuthorization | undefined,
  label: string,
  forced = false,
  sensitivityOnly = false,
): void {
  if (!authorization || authorization.approvalRequired) {
    return;
  }
  const sensitive = target.dataSensitivity === "sensitive";
  const actionRisk =
    !sensitivityOnly && target.actionRisk === "decision_barrier";
  if (!forced && !sensitive && !actionRisk) {
    return;
  }
  const reason =
    target.dataSensitivityReason ||
    target.actionRiskReason ||
    (forced ? "the requested action can commit the current form" : undefined) ||
    "the resolved target requires an explicit decision barrier";
  throw new Error(
    `DECISION_BARRIER_REQUIRED: ${label} was resolved before execution and ${reason}. No page mutation was performed. Retry the original MCP tool with decisionBarrier=true so the user receives a separate approval card.`,
  );
}

function requireKeyDecisionBarrier(
  key: string,
  authorization?: ToolExecutionAuthorization,
): void {
  if (
    authorization &&
    !authorization.approvalRequired &&
    key.trim().toLowerCase() === "enter"
  ) {
    throw new Error(
      "DECISION_BARRIER_REQUIRED: Enter can submit or commit the focused control. No key was dispatched. Retry the original MCP tool with decisionBarrier=true so the user receives a separate approval card.",
    );
  }
}

async function focusTrustedElement(
  input: { selector?: string; target?: string; element?: string },
  label: string,
): Promise<ResolvedTrustedElement> {
  const resolved = await resolveTrustedElement(input, label, true, true);
  requireTrustedElementFocus(resolved.rect, label);
  return resolved;
}

async function dragElementWithTrustedInput(
  input: BrowserDragInput,
): Promise<BrowserDragResult> {
  const sourceSelector = (input.source || input.sourceSelector || "").trim();
  const targetSelector = (input.target || input.targetSelector || "").trim();
  if (!sourceSelector || !targetSelector) {
    throw new Error("source and target selectors are required.");
  }

  const sourceInitial = await resolveTrustedElement(
    { selector: sourceSelector },
    "drag source",
    true,
  );
  const target = await resolveTrustedElement(
    { selector: targetSelector },
    "drag target",
    false,
  );
  const source = await resolveTrustedElement(
    { selector: sourceSelector },
    "drag source",
    false,
  );
  assertSameTrustedTarget(sourceInitial.target, target.target);
  assertSameTrustedTarget(source.target, target.target);

  const dragInput: BrowserCoordinateDragInput = {
    startX: source.point.x,
    startY: source.point.y,
    endX: target.point.x,
    endY: target.point.y,
  };
  await presentAgentPointerBestEffort(
    {
      action: "drag",
      x: source.point.x,
      y: source.point.y,
      endX: target.point.x,
      endY: target.point.y,
    },
    source.target,
  );
  await dispatchTrustedMouseDrag(dragInput, source.target);
  return {
    dragged: true,
    source: trustedElementActionResult(
      source.rect,
      "dragSource",
      source.point,
    ),
    target: trustedElementActionResult(
      target.rect,
      "dragTarget",
      target.point,
    ),
  };
}

interface ResolvedTrustedElement {
  rect: BrowserElementRectResult;
  point: BrowserCoordinateInput;
  target: PageSnapshotTarget & { tabId: number };
}

async function resolveTrustedElement(
  input: { selector?: string; target?: string; element?: string },
  label: string,
  scrollIntoView: boolean,
  focusElement = false,
): Promise<ResolvedTrustedElement> {
  const response = await forwardContentRequestWithTarget(
    MESSAGE_TYPES.CONTENT_GET_ELEMENT_RECT,
    {
      ...input,
      scrollIntoView,
      requireHitTest: true,
      focusElement,
    },
  );
  const target = await assertTrustedContentTarget(response.target);
  return {
    rect: response.payload,
    point: requireTrustedElementPoint(response.payload, label),
    target,
  };
}

async function assertTrustedContentTarget(
  target: PageSnapshotTarget,
): Promise<PageSnapshotTarget & { tabId: number }> {
  if (target.tabId === undefined) {
    throw new Error("STALE_CONTEXT: trusted input target has no tab identity.");
  }
  const tab = await queryActiveTab();
  const selectedFrame = getSelectedContentFrame(target.tabId);
  const navigation = getTargetNavigationState(target.tabId, false);
  if (
    tab?.id !== target.tabId ||
    selectedFrame.frameId !== target.frameId ||
    (selectedFrame.documentId !== undefined &&
      selectedFrame.documentId !== target.documentId) ||
    navigation.navigationId !== target.navigationId ||
    navigation.revision !== target.revision
  ) {
    throw new Error(
      "STALE_CONTEXT: the selected tab, frame, or document changed while trusted input coordinates were resolved; retry the action.",
    );
  }
  return { ...target, tabId: target.tabId };
}

function assertSameTrustedTarget(
  left: PageSnapshotTarget,
  right: PageSnapshotTarget,
): void {
  if (
    left.tabId !== right.tabId ||
    left.frameId !== right.frameId ||
    left.documentId !== right.documentId ||
    left.navigationId !== right.navigationId ||
    left.revision !== right.revision
  ) {
    throw new Error(
      "STALE_CONTEXT: the trusted input target changed while resolving drag endpoints; retry the action.",
    );
  }
}

async function requireTrustedInputTarget(): Promise<TrustedInputTargetAddress> {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    throw new Error("No active tab is available.");
  }
  const selected = getSelectedContentFrame(tab.id);
  const snapshot = getSelectedContentFrameSnapshot(tab.id);
  if (selected.documentId && !snapshot) {
    throw new Error(
      "STALE_CONTEXT: the selected frame document changed; list and select the frame again before trusted input.",
    );
  }
  if (selected.frameId !== 0 && !selected.documentId) {
    throw new Error(
      "STALE_CONTEXT: the selected child frame has no document identity; list and select the frame again before trusted input.",
    );
  }
  return {
    tabId: tab.id,
    frameId: selected.frameId,
    documentId: selected.documentId,
  };
}

async function presentAgentPointerBestEffort(
  payload: AgentPointerInput,
  target: TrustedInputTargetAddress,
): Promise<void> {
  const request = {
    id: createMessageId(),
    source: "background",
    type: MESSAGE_TYPES.CONTENT_AGENT_POINTER,
    payload,
  } as RequestOf<typeof MESSAGE_TYPES.CONTENT_AGENT_POINTER>;

  try {
    await Promise.race([
      sendTabRequest(target.tabId, request, {
        frameId: target.frameId,
        documentId: target.documentId,
      }).then(() => undefined),
      new Promise<void>((resolve) =>
        setTimeout(resolve, AGENT_POINTER_PRESENTATION_TIMEOUT_MS),
      ),
    ]);
  } catch {
    // Visual feedback must never change whether the trusted CDP action runs.
  }
}

export async function clearAgentPointerForCurrentTargetBestEffort(): Promise<void> {
  try {
    const target = await requireTrustedInputTarget();
    await presentAgentPointerBestEffort({ action: "clear" }, target);
  } catch {
    // Screenshots remain available when no content-script pointer exists.
  }
}

function trustedElementActionResult(
  rect: BrowserElementRectResult,
  action: string,
  point: BrowserCoordinateInput,
): BrowserElementActionResult {
  return {
    selector: rect.selector,
    matched: true,
    tagName: rect.tagName,
    text: rect.text,
    rect: rect.rect,
    action,
    inputMode: "cdp",
    x: point.x,
    y: point.y,
  };
}

async function takeScreenshot(
  input: ScreenshotCaptureInput,
): Promise<Awaited<ReturnType<typeof captureDebuggerScreenshot>>> {
  await clearAgentPointerForCurrentTargetBestEffort();
  const target = (input.target || input.selector || input.element || "").trim();
  let screenshot: Awaited<ReturnType<typeof captureDebuggerScreenshot>>;
  if (target) {
    const rect = await forwardContentRequest(
      MESSAGE_TYPES.CONTENT_GET_ELEMENT_RECT,
      { selector: target },
    );
    if (!rect.matched || rect.pageX === undefined || rect.pageY === undefined) {
      throw new Error(`Element not found for screenshot: ${target}`);
    }
    screenshot = await captureDebuggerScreenshot({
      ...input,
      selector: target,
      target,
      fullPage: false,
      clip: {
        x: rect.pageX,
        y: rect.pageY,
        width: rect.width ?? rect.rect?.width ?? 1,
        height: rect.height ?? rect.rect?.height ?? 1,
      },
    });
    return saveScreenshotIfRequested(screenshot, input);
  }

  try {
    screenshot = await captureDebuggerScreenshot(input);
  } catch (error) {
    if (input.fullPage) {
      throw error;
    }
    screenshot = await captureVisibleTab();
  }
  return saveScreenshotIfRequested(screenshot, input);
}

async function saveScreenshotIfRequested(
  screenshot: Awaited<ReturnType<typeof captureDebuggerScreenshot>>,
  input: ScreenshotCaptureInput,
): Promise<Awaited<ReturnType<typeof captureDebuggerScreenshot>>> {
  const filename = sanitizeDownloadFilename(
    input.filename || defaultScreenshotFilename(input.type),
  );
  const next = {
    ...screenshot,
    filename,
  };

  if (!shouldSaveScreenshotToDownloads(input)) {
    return next;
  }

  return {
    ...next,
    savedAs: await downloadDataUrl(screenshot.dataUrl, filename),
  };
}

export function shouldSaveScreenshotToDownloads(
  input: ScreenshotCaptureInput,
): boolean {
  return input.saveToDownloads === true;
}

function defaultScreenshotFilename(type: ScreenshotCaptureInput["type"]): string {
  const extension = type === "jpeg" ? "jpg" : "png";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `ai-devtools/screenshot-${timestamp}.${extension}`;
}

function sanitizeDownloadFilename(filename: string): string {
  const trimmed = filename.trim() || defaultScreenshotFilename("png");
  const normalized = trimmed.replace(/^\/+/, "").replace(/\\/g, "/");
  return normalized
    .split("/")
    .map((part) => part.replace(/[<>:"|?*\x00-\x1f]/g, "-").trim() || "file")
    .join("/");
}

async function forwardContentRequest<T extends ContentRequestType>(
  type: T,
  payload: RequestOf<T>["payload"],
): Promise<ResponsePayloadMap[T]> {
  return (await forwardContentRequestWithTarget(type, payload)).payload;
}

interface ForwardedContentResponse<T extends ContentRequestType> {
  payload: ResponsePayloadMap[T];
  target: PageSnapshotTarget;
}

async function forwardContentRequestWithTarget<T extends ContentRequestType>(
  type: T,
  payload: RequestOf<T>["payload"],
): Promise<ForwardedContentResponse<T>> {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    throw new Error("No active tab is available.");
  }
  if (!isTabUrlScriptable(tab.url)) {
    throw new Error("The active tab does not allow extension content scripts.");
  }

  const request = {
    id: createMessageId(),
    source: "background",
    type,
    payload,
  } as RequestOf<T>;
  const selectedFrame = getSelectedContentFrame(tab.id);
  const selectedFrameSnapshot = getSelectedContentFrameSnapshot(tab.id);
  const navigation = getTargetNavigationState(tab.id, false);
  let response = await sendTabRequest(tab.id, request, selectedFrame);

  if (
    !response.ok &&
    response.error.code === "TAB_MESSAGE_ERROR" &&
    !selectedFrame.documentId
  ) {
    await injectContentScript(tab.id, selectedFrame);
    response = await sendTabRequest(tab.id, request, selectedFrame);
  }

  if (
    !response.ok &&
    response.error.code === "TAB_MESSAGE_ERROR" &&
    selectedFrame.documentId
  ) {
    throw new Error(
      "The selected frame document is no longer available. Call browser_list_frames and select the current document before retrying.",
    );
  }

  if (!response.ok) {
    throw new Error(response.error.message);
  }

  return {
    payload: response.payload,
    target: {
      url: selectedFrameSnapshot?.url || tab.url || "",
      title: selectedFrameSnapshot?.title || tab.title || "",
      targetId: String(tab.id),
      tabId: tab.id,
      windowId: tab.windowId,
      frameId: selectedFrame.frameId,
      documentId:
        selectedFrame.documentId ?? selectedFrameSnapshot?.documentId,
      navigationId: navigation.navigationId,
      revision: navigation.revision,
    },
  };
}

export function assertToolCallMessage(message: ExtensionRequest): AnyToolCall {
  if (message.type !== MESSAGE_TYPES.TOOL_CALL) {
    throw new Error("Expected a tool call message.");
  }

  return message.payload.call;
}

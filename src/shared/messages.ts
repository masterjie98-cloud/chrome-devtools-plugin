import type {
  CssPatchInput,
  CssPatchResult,
  BrowserClickInput,
  BrowserCoordinateClickInput,
  BrowserCoordinateDragInput,
  BrowserCoordinateInput,
  BrowserElementActionResult,
  BrowserElementRectInput,
  BrowserElementRectResult,
  BrowserDebuggerFrameCleanupInput,
  BrowserDebuggerFrameCleanupResult,
  BrowserDragInput,
  BrowserDragResult,
  BrowserFormControlInspectInput,
  BrowserFormControlInspectResult,
  BrowserHoverInput,
  BrowserMouseResult,
  BrowserMouseWheelInput,
  AgentPointerInput,
  AgentPointerResult,
  BrowserSelectOptionApplyInput,
  BrowserStorageStateInput,
  BrowserStorageStateResult,
  BrowserTargetTab,
  BrowserWaitForInput,
  BrowserWaitForResult,
  DomQueryInput,
  DomQueryResult,
  DomSetValueInput,
  DomSetValueResult,
  ElementPickedEventPayload,
  HighlightElementInput,
  HighlightElementResult,
  PageSnapshot,
  PageSnapshotInput,
  RemoveCssPatchInput,
  RemoveCssPatchResult
} from "./dom";
import type {
  DebuggerProxyHit,
  DebuggerProxyRule,
  DebuggerProxyStatus,
} from "./debugger";
import type { DnrRuleMutationResult, DnrRuleSummary } from "./network";
import type { AnyToolCall, ToolExecutionResult } from "./tools";
import type { BrowserActivityEventInput } from "./browserActivity";

export const MESSAGE_TYPES = {
  TOOL_CALL: "tool:call",
  CONTENT_GET_PAGE_INFO: "content:getPageInfo",
  CONTENT_QUERY_DOM: "content:queryDom",
  CONTENT_START_ELEMENT_PICK: "content:startElementPick",
  CONTENT_CANCEL_ELEMENT_PICK: "content:cancelElementPick",
  CONTENT_ELEMENT_PICKED: "content:elementPicked",
  CONTENT_SELECTION_CANCELLED: "content:selectionCancelled",
  CONTENT_TARGET_AVAILABLE: "content:targetAvailable",
  CONTENT_SET_ACTIVITY_MONITOR: "content:setActivityMonitor",
  CONTENT_DOM_ACTIVITY: "content:domActivity",
  CONTENT_HIGHLIGHT_ELEMENT: "content:highlightElement",
  CONTENT_CLEAR_HIGHLIGHTS: "content:clearHighlights",
  CONTENT_SET_DOM_VALUE: "content:setDomValue",
  CONTENT_GET_ELEMENT_RECT: "content:getElementRect",
  CONTENT_CLICK_ELEMENT: "content:clickElement",
  CONTENT_HOVER_ELEMENT: "content:hoverElement",
  CONTENT_DRAG_ELEMENT: "content:dragElement",
  CONTENT_INSPECT_FORM_CONTROL: "content:inspectFormControl",
  CONTENT_SELECT_OPTION: "content:selectOption",
  CONTENT_MOUSE_MOVE: "content:mouseMove",
  CONTENT_MOUSE_CLICK: "content:mouseClick",
  CONTENT_MOUSE_DOWN: "content:mouseDown",
  CONTENT_MOUSE_UP: "content:mouseUp",
  CONTENT_MOUSE_DRAG: "content:mouseDrag",
  CONTENT_MOUSE_WHEEL: "content:mouseWheel",
  CONTENT_AGENT_POINTER: "content:agentPointer",
  CONTENT_WAIT_FOR: "content:waitFor",
  CONTENT_GET_STORAGE_STATE: "content:getStorageState",
  CONTENT_CLEAN_DEBUGGER_FRAMES: "content:cleanDebuggerFrames",
  CONTENT_APPLY_CSS_PATCH: "content:applyCssPatch",
  CONTENT_REMOVE_CSS_PATCH: "content:removeCssPatch",
  DNR_LIST_RULES: "dnr:listRules",
  DNR_REMOVE_RULE: "dnr:removeRule",
  SIDE_PANEL_READY: "sidepanel:ready",
  SIDE_PANEL_FOCUS_TARGET_TAB: "sidepanel:focusTargetTab",
  AGENT_POINTER_CLEAR: "agent:pointerClear",
  FOREGROUND_TAB_UPDATED: "browser:foregroundTabUpdated",
  DEBUGGER_PROXY_STATE_CHANGED: "debugger:proxyStateChanged",
} as const;

export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];
export type MessageSource = "sidepanel" | "background" | "content";

export type ExtensionRequest =
  | {
      id: string;
      source: "sidepanel";
      type: typeof MESSAGE_TYPES.TOOL_CALL;
      payload: { call: AnyToolCall };
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_GET_PAGE_INFO;
      payload: PageSnapshotInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_SET_ACTIVITY_MONITOR;
      payload: { enabled: boolean };
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_QUERY_DOM;
      payload: DomQueryInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_START_ELEMENT_PICK;
      payload: Record<string, never>;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_CANCEL_ELEMENT_PICK;
      payload: Record<string, never>;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_HIGHLIGHT_ELEMENT;
      payload: HighlightElementInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_CLEAR_HIGHLIGHTS;
      payload: Record<string, never>;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_SET_DOM_VALUE;
      payload: DomSetValueInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_GET_ELEMENT_RECT;
      payload: BrowserElementRectInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_CLICK_ELEMENT;
      payload: BrowserClickInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_HOVER_ELEMENT;
      payload: BrowserHoverInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_DRAG_ELEMENT;
      payload: BrowserDragInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_INSPECT_FORM_CONTROL;
      payload: BrowserFormControlInspectInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_SELECT_OPTION;
      payload: BrowserSelectOptionApplyInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_MOUSE_MOVE;
      payload: BrowserCoordinateInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_MOUSE_CLICK;
      payload: BrowserCoordinateClickInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_MOUSE_DOWN;
      payload: BrowserCoordinateClickInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_MOUSE_UP;
      payload: BrowserCoordinateClickInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_MOUSE_DRAG;
      payload: BrowserCoordinateDragInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_MOUSE_WHEEL;
      payload: BrowserMouseWheelInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_AGENT_POINTER;
      payload: AgentPointerInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_WAIT_FOR;
      payload: BrowserWaitForInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_GET_STORAGE_STATE;
      payload: BrowserStorageStateInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_CLEAN_DEBUGGER_FRAMES;
      payload: BrowserDebuggerFrameCleanupInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_APPLY_CSS_PATCH;
      payload: CssPatchInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.CONTENT_REMOVE_CSS_PATCH;
      payload: RemoveCssPatchInput;
    }
  | {
      id: string;
      source: "sidepanel";
      type: typeof MESSAGE_TYPES.DNR_LIST_RULES;
      payload: Record<string, never>;
    }
  | {
      id: string;
      source: "sidepanel";
      type: typeof MESSAGE_TYPES.DNR_REMOVE_RULE;
      payload: { ruleId: number };
    }
  | {
      id: string;
      source: "sidepanel";
      type: typeof MESSAGE_TYPES.SIDE_PANEL_READY;
      payload: Record<string, never>;
    }
  | {
      id: string;
      source: "sidepanel";
      type: typeof MESSAGE_TYPES.SIDE_PANEL_FOCUS_TARGET_TAB;
      payload: { tabId: number };
    }
  | {
      id: string;
      source: "sidepanel";
      type: typeof MESSAGE_TYPES.AGENT_POINTER_CLEAR;
      payload: Record<string, never>;
    };

export type ExtensionEvent =
  | {
      id: string;
      source: "content";
      type: typeof MESSAGE_TYPES.CONTENT_ELEMENT_PICKED;
      payload: ElementPickedEventPayload;
    }
  | {
      id: string;
      source: "content";
      type: typeof MESSAGE_TYPES.CONTENT_SELECTION_CANCELLED;
      payload: { reason: string };
    }
  | {
      id: string;
      source: "content";
      type: typeof MESSAGE_TYPES.CONTENT_TARGET_AVAILABLE;
      payload: { url: string; title: string; reason: string };
    }
  | {
      id: string;
      source: "content";
      type: typeof MESSAGE_TYPES.CONTENT_DOM_ACTIVITY;
      payload: BrowserActivityEventInput;
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.FOREGROUND_TAB_UPDATED;
      payload: { tab: BrowserTargetTab };
    }
  | {
      id: string;
      source: "background";
      type: typeof MESSAGE_TYPES.DEBUGGER_PROXY_STATE_CHANGED;
      payload: {
        status: DebuggerProxyStatus;
        rules: DebuggerProxyRule[];
        hits: DebuggerProxyHit[];
      };
    };

export type ExtensionMessage = ExtensionRequest | ExtensionEvent;
export type RequestOf<T extends ExtensionRequest["type"]> = Extract<ExtensionRequest, { type: T }>;
export type EventOf<T extends ExtensionEvent["type"]> = Extract<ExtensionEvent, { type: T }>;

export interface ResponsePayloadMap {
  [MESSAGE_TYPES.TOOL_CALL]: ToolExecutionResult;
  [MESSAGE_TYPES.CONTENT_GET_PAGE_INFO]: PageSnapshot;
  [MESSAGE_TYPES.CONTENT_SET_ACTIVITY_MONITOR]: { enabled: boolean };
  [MESSAGE_TYPES.CONTENT_QUERY_DOM]: DomQueryResult;
  [MESSAGE_TYPES.CONTENT_START_ELEMENT_PICK]: { started: boolean };
  [MESSAGE_TYPES.CONTENT_CANCEL_ELEMENT_PICK]: { cancelled: boolean };
  [MESSAGE_TYPES.CONTENT_HIGHLIGHT_ELEMENT]: HighlightElementResult;
  [MESSAGE_TYPES.CONTENT_CLEAR_HIGHLIGHTS]: { cleared: boolean };
  [MESSAGE_TYPES.CONTENT_SET_DOM_VALUE]: DomSetValueResult;
  [MESSAGE_TYPES.CONTENT_GET_ELEMENT_RECT]: BrowserElementRectResult;
  [MESSAGE_TYPES.CONTENT_CLICK_ELEMENT]: BrowserElementActionResult;
  [MESSAGE_TYPES.CONTENT_HOVER_ELEMENT]: BrowserElementActionResult;
  [MESSAGE_TYPES.CONTENT_DRAG_ELEMENT]: BrowserDragResult;
  [MESSAGE_TYPES.CONTENT_INSPECT_FORM_CONTROL]: BrowserFormControlInspectResult;
  [MESSAGE_TYPES.CONTENT_SELECT_OPTION]: BrowserElementActionResult;
  [MESSAGE_TYPES.CONTENT_MOUSE_MOVE]: BrowserMouseResult;
  [MESSAGE_TYPES.CONTENT_MOUSE_CLICK]: BrowserMouseResult;
  [MESSAGE_TYPES.CONTENT_MOUSE_DOWN]: BrowserMouseResult;
  [MESSAGE_TYPES.CONTENT_MOUSE_UP]: BrowserMouseResult;
  [MESSAGE_TYPES.CONTENT_MOUSE_DRAG]: BrowserMouseResult;
  [MESSAGE_TYPES.CONTENT_MOUSE_WHEEL]: BrowserMouseResult;
  [MESSAGE_TYPES.CONTENT_AGENT_POINTER]: AgentPointerResult;
  [MESSAGE_TYPES.CONTENT_WAIT_FOR]: BrowserWaitForResult;
  [MESSAGE_TYPES.CONTENT_GET_STORAGE_STATE]: BrowserStorageStateResult;
  [MESSAGE_TYPES.CONTENT_CLEAN_DEBUGGER_FRAMES]: BrowserDebuggerFrameCleanupResult;
  [MESSAGE_TYPES.CONTENT_APPLY_CSS_PATCH]: CssPatchResult;
  [MESSAGE_TYPES.CONTENT_REMOVE_CSS_PATCH]: RemoveCssPatchResult;
  [MESSAGE_TYPES.DNR_LIST_RULES]: DnrRuleSummary[];
  [MESSAGE_TYPES.DNR_REMOVE_RULE]: DnrRuleMutationResult;
  [MESSAGE_TYPES.SIDE_PANEL_READY]: { ready: true };
  [MESSAGE_TYPES.SIDE_PANEL_FOCUS_TARGET_TAB]: { focused: true };
  [MESSAGE_TYPES.AGENT_POINTER_CLEAR]: { cleared: true };
}

export interface MessageError {
  code: string;
  message: string;
  details?: unknown;
}

export type ExtensionResponse<T extends ExtensionRequest["type"] = ExtensionRequest["type"]> =
  | {
      id: string;
      type: T;
      ok: true;
      payload: ResponsePayloadMap[T];
    }
  | {
      id: string;
      type: T;
      ok: false;
      error: MessageError;
    };

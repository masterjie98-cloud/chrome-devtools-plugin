import type {
  CssPatchInput,
  CssPatchResult,
  BrowserClickInput,
  BrowserCloseResult,
  BrowserConsoleMessagesInput,
  BrowserConsoleMessagesResult,
  BrowserCookieDeleteInput,
  BrowserCookieDeleteResult,
  BrowserCookieListInput,
  BrowserCookieListResult,
  BrowserCookieSetInput,
  BrowserCookieSetResult,
  BrowserCoordinateClickInput,
  BrowserCoordinateDragInput,
  BrowserCoordinateInput,
  BrowserDialogInput,
  BrowserDialogResult,
  BrowserDragInput,
  BrowserDragResult,
  BrowserElementActionResult,
  BrowserEvaluateInput,
  BrowserEvaluateResult,
  BrowserFillFormInput,
  BrowserFillFormResult,
  BrowserHoverInput,
  BrowserMouseResult,
  BrowserMouseWheelInput,
  BrowserNavigateInput,
  BrowserNavigationResult,
  BrowserPressKeyInput,
  BrowserResizeInput,
  BrowserResizeResult,
  BrowserSelectOptionInput,
  BrowserStorageStateInput,
  BrowserStorageStateResult,
  BrowserTargetListResult,
  BrowserTargetFrameListResult,
  BrowserTargetFrameSetInput,
  BrowserTargetFrameSetResult,
  BrowserTargetSetInput,
  BrowserTargetSetResult,
  BrowserTypeInput,
  BrowserWaitForInput,
  BrowserWaitForResult,
  DomQueryInput,
  DomQueryResult,
  DomSetValueInput,
  DomSetValueResult,
  HighlightElementInput,
  HighlightElementResult,
  PageSnapshot,
  PageSnapshotInput,
  MultiFramePageSnapshot,
  RemoveCssPatchInput,
  RemoveCssPatchResult,
  ScreenshotCaptureInput,
  ScreenshotCaptureResult,
} from "./dom";
import { SUPPORTED_COMPUTED_STYLE_PROPERTIES } from "./dom";
import { isSupportedTrustedKey } from "./trustedKeyboard";
import type {
  DebuggerDetachInput,
  DebuggerDetachResult,
  DebuggerFetchPrepareInput,
  DebuggerFetchStatus,
  DebuggerNetworkBodyInput,
  DebuggerNetworkGetInput,
  DebuggerNetworkListInput,
  DebuggerNetworkListResult,
  DebuggerNetworkRequestDetail,
  DebuggerNetworkResponseBody,
  DebuggerNetworkStartInput,
  DebuggerNetworkStatus,
  DebuggerProxyListHitsInput,
  DebuggerProxyListHitsResult,
  DebuggerProxyListResult,
  DebuggerProxyRemoveRuleInput,
  DebuggerProxyRuleInput,
  DebuggerProxyRuleMutationResult,
  DebuggerProxyStatus,
} from "./debugger";
import type {
  DnrRuleMutationResult,
  DnrRuleSummary,
  GetMockRuleInput,
  HeaderRuleInput,
  RemoveDnrRuleInput,
} from "./network";
import { SANITIZE_LIMITS } from "./sanitize";
import type {
  BrowserActivityStartInput,
  BrowserActivityStatus,
} from "./browserActivity";
import type {
  BrowserLocateSourceInput,
  BrowserLocateSourceResult,
  GeneratedSourceLocation,
  SourceMapResolution,
} from "./sourceLocation";
import type {
  BrowserCssExplainInput,
  BrowserCssExplainResult,
  BrowserPerformanceDiagnosticsInput,
  BrowserPerformanceDiagnosticsResult,
  BrowserRealtimeActivityInput,
  BrowserRealtimeActivityResult,
} from "./pageDiagnostics";

export const TOOL_NAMES = {
  DOM_GET_PAGE_INFO: "dom.getPageInfo",
  DOM_QUERY: "dom.query",
  DOM_START_ELEMENT_PICK: "dom.startElementPick",
  DOM_CANCEL_ELEMENT_PICK: "dom.cancelElementPick",
  DOM_HIGHLIGHT_ELEMENT: "dom.highlightElement",
  DOM_CLEAR_HIGHLIGHTS: "dom.clearHighlights",
  DOM_SET_VALUE: "dom.setValue",
  DOM_LOCATE_SOURCE: "dom.locateSource",
  DOM_EXPLAIN_CSS: "dom.explainCss",
  PAGE_PERFORMANCE_DIAGNOSTICS: "page.performanceDiagnostics",
  PAGE_REALTIME_ACTIVITY: "page.realtimeActivity",
  CSS_APPLY_PATCH: "css.applyPatch",
  CSS_REMOVE_PATCH: "css.removePatch",
  BROWSER_TAKE_SCREENSHOT: "browser.takeScreenshot",
  BROWSER_LIST_TABS: "browser.listTabs",
  BROWSER_SET_TARGET_TAB: "browser.setTargetTab",
  BROWSER_LIST_FRAMES: "browser.listFrames",
  BROWSER_SET_TARGET_FRAME: "browser.setTargetFrame",
  BROWSER_NAVIGATE: "browser.navigate",
  BROWSER_NAVIGATE_BACK: "browser.navigateBack",
  BROWSER_NAVIGATE_FORWARD: "browser.navigateForward",
  BROWSER_RELOAD: "browser.reload",
  BROWSER_CLOSE: "browser.close",
  BROWSER_RESIZE: "browser.resize",
  BROWSER_CLICK: "browser.click",
  BROWSER_HOVER: "browser.hover",
  BROWSER_DRAG: "browser.drag",
  BROWSER_FILL_FORM: "browser.fillForm",
  BROWSER_TYPE: "browser.type",
  BROWSER_PRESS_KEY: "browser.pressKey",
  BROWSER_SELECT_OPTION: "browser.selectOption",
  BROWSER_MOUSE_MOVE: "browser.mouseMove",
  BROWSER_MOUSE_CLICK: "browser.mouseClick",
  BROWSER_MOUSE_DOWN: "browser.mouseDown",
  BROWSER_MOUSE_UP: "browser.mouseUp",
  BROWSER_MOUSE_DRAG: "browser.mouseDrag",
  BROWSER_MOUSE_WHEEL: "browser.mouseWheel",
  BROWSER_WAIT_FOR: "browser.waitFor",
  BROWSER_EVALUATE: "browser.evaluate",
  BROWSER_HANDLE_DIALOG: "browser.handleDialog",
  BROWSER_STORAGE_STATE: "browser.storageState",
  BROWSER_COOKIE_LIST: "browser.cookieList",
  BROWSER_COOKIE_SET: "browser.cookieSet",
  BROWSER_COOKIE_DELETE: "browser.cookieDelete",
  BROWSER_CONSOLE_MESSAGES: "browser.consoleMessages",
  BROWSER_ACTIVITY_START: "browser.activity.start",
  BROWSER_ACTIVITY_STOP: "browser.activity.stop",
  DNR_LIST_RULES: "dnr.listRules",
  DNR_UPSERT_HEADER_RULE: "dnr.upsertHeaderRule",
  DNR_REMOVE_RULE: "dnr.removeRule",
  MOCK_UPSERT_GET: "mock.upsertGet",
  MOCK_REMOVE: "mock.remove",
  DEBUGGER_FETCH_PREPARE: "debugger.fetch.prepare",
  DEBUGGER_PROXY_ENABLE: "debugger.proxy.enable",
  DEBUGGER_PROXY_DISABLE: "debugger.proxy.disable",
  DEBUGGER_PROXY_LIST_RULES: "debugger.proxy.listRules",
  DEBUGGER_PROXY_UPSERT_RULE: "debugger.proxy.upsertRule",
  DEBUGGER_PROXY_REMOVE_RULE: "debugger.proxy.removeRule",
  DEBUGGER_PROXY_CLEAR_RULES: "debugger.proxy.clearRules",
  DEBUGGER_PROXY_LIST_HITS: "debugger.proxy.listHits",
  DEBUGGER_NETWORK_START: "debugger.network.start",
  DEBUGGER_NETWORK_STOP: "debugger.network.stop",
  DEBUGGER_NETWORK_CLEAR: "debugger.network.clear",
  DEBUGGER_NETWORK_LIST: "debugger.network.list",
  DEBUGGER_RESOLVE_SOURCE: "debugger.resolveSource",
  DEBUGGER_NETWORK_GET: "debugger.network.get",
  DEBUGGER_NETWORK_GET_BODY: "debugger.network.getBody",
  DEBUGGER_DETACH: "debugger.detach",
} as const;

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

export interface ToolArgumentMap {
  [TOOL_NAMES.DOM_GET_PAGE_INFO]: PageSnapshotInput;
  [TOOL_NAMES.DOM_QUERY]: DomQueryInput;
  [TOOL_NAMES.DOM_START_ELEMENT_PICK]: Record<string, never>;
  [TOOL_NAMES.DOM_CANCEL_ELEMENT_PICK]: Record<string, never>;
  [TOOL_NAMES.DOM_HIGHLIGHT_ELEMENT]: HighlightElementInput;
  [TOOL_NAMES.DOM_CLEAR_HIGHLIGHTS]: Record<string, never>;
  [TOOL_NAMES.DOM_SET_VALUE]: DomSetValueInput;
  [TOOL_NAMES.DOM_LOCATE_SOURCE]: BrowserLocateSourceInput;
  [TOOL_NAMES.DOM_EXPLAIN_CSS]: BrowserCssExplainInput;
  [TOOL_NAMES.PAGE_PERFORMANCE_DIAGNOSTICS]: BrowserPerformanceDiagnosticsInput;
  [TOOL_NAMES.PAGE_REALTIME_ACTIVITY]: BrowserRealtimeActivityInput;
  [TOOL_NAMES.CSS_APPLY_PATCH]: CssPatchInput;
  [TOOL_NAMES.CSS_REMOVE_PATCH]: RemoveCssPatchInput;
  [TOOL_NAMES.BROWSER_TAKE_SCREENSHOT]: ScreenshotCaptureInput;
  [TOOL_NAMES.BROWSER_LIST_TABS]: Record<string, never>;
  [TOOL_NAMES.BROWSER_SET_TARGET_TAB]: BrowserTargetSetInput;
  [TOOL_NAMES.BROWSER_LIST_FRAMES]: Record<string, never>;
  [TOOL_NAMES.BROWSER_SET_TARGET_FRAME]: BrowserTargetFrameSetInput;
  [TOOL_NAMES.BROWSER_NAVIGATE]: BrowserNavigateInput;
  [TOOL_NAMES.BROWSER_NAVIGATE_BACK]: Record<string, never>;
  [TOOL_NAMES.BROWSER_NAVIGATE_FORWARD]: Record<string, never>;
  [TOOL_NAMES.BROWSER_RELOAD]: Record<string, never>;
  [TOOL_NAMES.BROWSER_CLOSE]: Record<string, never>;
  [TOOL_NAMES.BROWSER_RESIZE]: BrowserResizeInput;
  [TOOL_NAMES.BROWSER_CLICK]: BrowserClickInput;
  [TOOL_NAMES.BROWSER_HOVER]: BrowserHoverInput;
  [TOOL_NAMES.BROWSER_DRAG]: BrowserDragInput;
  [TOOL_NAMES.BROWSER_FILL_FORM]: BrowserFillFormInput;
  [TOOL_NAMES.BROWSER_TYPE]: BrowserTypeInput;
  [TOOL_NAMES.BROWSER_PRESS_KEY]: BrowserPressKeyInput;
  [TOOL_NAMES.BROWSER_SELECT_OPTION]: BrowserSelectOptionInput;
  [TOOL_NAMES.BROWSER_MOUSE_MOVE]: BrowserCoordinateInput;
  [TOOL_NAMES.BROWSER_MOUSE_CLICK]: BrowserCoordinateClickInput;
  [TOOL_NAMES.BROWSER_MOUSE_DOWN]: BrowserCoordinateClickInput;
  [TOOL_NAMES.BROWSER_MOUSE_UP]: BrowserCoordinateClickInput;
  [TOOL_NAMES.BROWSER_MOUSE_DRAG]: BrowserCoordinateDragInput;
  [TOOL_NAMES.BROWSER_MOUSE_WHEEL]: BrowserMouseWheelInput;
  [TOOL_NAMES.BROWSER_WAIT_FOR]: BrowserWaitForInput;
  [TOOL_NAMES.BROWSER_EVALUATE]: BrowserEvaluateInput;
  [TOOL_NAMES.BROWSER_HANDLE_DIALOG]: BrowserDialogInput;
  [TOOL_NAMES.BROWSER_STORAGE_STATE]: BrowserStorageStateInput;
  [TOOL_NAMES.BROWSER_COOKIE_LIST]: BrowserCookieListInput;
  [TOOL_NAMES.BROWSER_COOKIE_SET]: BrowserCookieSetInput;
  [TOOL_NAMES.BROWSER_COOKIE_DELETE]: BrowserCookieDeleteInput;
  [TOOL_NAMES.BROWSER_CONSOLE_MESSAGES]: BrowserConsoleMessagesInput;
  [TOOL_NAMES.BROWSER_ACTIVITY_START]: BrowserActivityStartInput;
  [TOOL_NAMES.BROWSER_ACTIVITY_STOP]: Record<string, never>;
  [TOOL_NAMES.DNR_LIST_RULES]: Record<string, never>;
  [TOOL_NAMES.DNR_UPSERT_HEADER_RULE]: HeaderRuleInput;
  [TOOL_NAMES.DNR_REMOVE_RULE]: RemoveDnrRuleInput;
  [TOOL_NAMES.MOCK_UPSERT_GET]: GetMockRuleInput;
  [TOOL_NAMES.MOCK_REMOVE]: RemoveDnrRuleInput;
  [TOOL_NAMES.DEBUGGER_FETCH_PREPARE]: DebuggerFetchPrepareInput;
  [TOOL_NAMES.DEBUGGER_PROXY_ENABLE]: Record<string, never>;
  [TOOL_NAMES.DEBUGGER_PROXY_DISABLE]: Record<string, never>;
  [TOOL_NAMES.DEBUGGER_PROXY_LIST_RULES]: Record<string, never>;
  [TOOL_NAMES.DEBUGGER_PROXY_UPSERT_RULE]: DebuggerProxyRuleInput;
  [TOOL_NAMES.DEBUGGER_PROXY_REMOVE_RULE]: DebuggerProxyRemoveRuleInput;
  [TOOL_NAMES.DEBUGGER_PROXY_CLEAR_RULES]: Record<string, never>;
  [TOOL_NAMES.DEBUGGER_PROXY_LIST_HITS]: DebuggerProxyListHitsInput;
  [TOOL_NAMES.DEBUGGER_NETWORK_START]: DebuggerNetworkStartInput;
  [TOOL_NAMES.DEBUGGER_NETWORK_STOP]: Record<string, never>;
  [TOOL_NAMES.DEBUGGER_NETWORK_CLEAR]: Record<string, never>;
  [TOOL_NAMES.DEBUGGER_NETWORK_LIST]: DebuggerNetworkListInput;
  [TOOL_NAMES.DEBUGGER_RESOLVE_SOURCE]: GeneratedSourceLocation & {
    includeSourceExcerpt?: boolean;
  };
  [TOOL_NAMES.DEBUGGER_NETWORK_GET]: DebuggerNetworkGetInput;
  [TOOL_NAMES.DEBUGGER_NETWORK_GET_BODY]: DebuggerNetworkBodyInput;
  [TOOL_NAMES.DEBUGGER_DETACH]: DebuggerDetachInput;
}

export interface ToolResultMap {
  [TOOL_NAMES.DOM_GET_PAGE_INFO]: PageSnapshot | MultiFramePageSnapshot;
  [TOOL_NAMES.DOM_QUERY]: DomQueryResult;
  [TOOL_NAMES.DOM_START_ELEMENT_PICK]: { started: boolean };
  [TOOL_NAMES.DOM_CANCEL_ELEMENT_PICK]: { cancelled: boolean };
  [TOOL_NAMES.DOM_HIGHLIGHT_ELEMENT]: HighlightElementResult;
  [TOOL_NAMES.DOM_CLEAR_HIGHLIGHTS]: { cleared: boolean };
  [TOOL_NAMES.DOM_SET_VALUE]: DomSetValueResult;
  [TOOL_NAMES.DOM_LOCATE_SOURCE]: BrowserLocateSourceResult;
  [TOOL_NAMES.DOM_EXPLAIN_CSS]: BrowserCssExplainResult;
  [TOOL_NAMES.PAGE_PERFORMANCE_DIAGNOSTICS]: BrowserPerformanceDiagnosticsResult;
  [TOOL_NAMES.PAGE_REALTIME_ACTIVITY]: BrowserRealtimeActivityResult;
  [TOOL_NAMES.CSS_APPLY_PATCH]: CssPatchResult;
  [TOOL_NAMES.CSS_REMOVE_PATCH]: RemoveCssPatchResult;
  [TOOL_NAMES.BROWSER_TAKE_SCREENSHOT]: ScreenshotCaptureResult;
  [TOOL_NAMES.BROWSER_LIST_TABS]: BrowserTargetListResult;
  [TOOL_NAMES.BROWSER_SET_TARGET_TAB]: BrowserTargetSetResult;
  [TOOL_NAMES.BROWSER_LIST_FRAMES]: BrowserTargetFrameListResult;
  [TOOL_NAMES.BROWSER_SET_TARGET_FRAME]: BrowserTargetFrameSetResult;
  [TOOL_NAMES.BROWSER_NAVIGATE]: BrowserNavigationResult;
  [TOOL_NAMES.BROWSER_NAVIGATE_BACK]: BrowserNavigationResult;
  [TOOL_NAMES.BROWSER_NAVIGATE_FORWARD]: BrowserNavigationResult;
  [TOOL_NAMES.BROWSER_RELOAD]: BrowserNavigationResult;
  [TOOL_NAMES.BROWSER_CLOSE]: BrowserCloseResult;
  [TOOL_NAMES.BROWSER_RESIZE]: BrowserResizeResult;
  [TOOL_NAMES.BROWSER_CLICK]: BrowserElementActionResult;
  [TOOL_NAMES.BROWSER_HOVER]: BrowserElementActionResult;
  [TOOL_NAMES.BROWSER_DRAG]: BrowserDragResult;
  [TOOL_NAMES.BROWSER_FILL_FORM]: BrowserFillFormResult;
  [TOOL_NAMES.BROWSER_TYPE]: BrowserElementActionResult;
  [TOOL_NAMES.BROWSER_PRESS_KEY]: BrowserElementActionResult;
  [TOOL_NAMES.BROWSER_SELECT_OPTION]: BrowserElementActionResult;
  [TOOL_NAMES.BROWSER_MOUSE_MOVE]: BrowserMouseResult;
  [TOOL_NAMES.BROWSER_MOUSE_CLICK]: BrowserMouseResult;
  [TOOL_NAMES.BROWSER_MOUSE_DOWN]: BrowserMouseResult;
  [TOOL_NAMES.BROWSER_MOUSE_UP]: BrowserMouseResult;
  [TOOL_NAMES.BROWSER_MOUSE_DRAG]: BrowserMouseResult;
  [TOOL_NAMES.BROWSER_MOUSE_WHEEL]: BrowserMouseResult;
  [TOOL_NAMES.BROWSER_WAIT_FOR]: BrowserWaitForResult;
  [TOOL_NAMES.BROWSER_EVALUATE]: BrowserEvaluateResult;
  [TOOL_NAMES.BROWSER_HANDLE_DIALOG]: BrowserDialogResult;
  [TOOL_NAMES.BROWSER_STORAGE_STATE]: BrowserStorageStateResult;
  [TOOL_NAMES.BROWSER_COOKIE_LIST]: BrowserCookieListResult;
  [TOOL_NAMES.BROWSER_COOKIE_SET]: BrowserCookieSetResult;
  [TOOL_NAMES.BROWSER_COOKIE_DELETE]: BrowserCookieDeleteResult;
  [TOOL_NAMES.BROWSER_CONSOLE_MESSAGES]: BrowserConsoleMessagesResult;
  [TOOL_NAMES.BROWSER_ACTIVITY_START]: BrowserActivityStatus;
  [TOOL_NAMES.BROWSER_ACTIVITY_STOP]: BrowserActivityStatus;
  [TOOL_NAMES.DNR_LIST_RULES]: DnrRuleSummary[];
  [TOOL_NAMES.DNR_UPSERT_HEADER_RULE]: DnrRuleMutationResult;
  [TOOL_NAMES.DNR_REMOVE_RULE]: DnrRuleMutationResult;
  [TOOL_NAMES.MOCK_UPSERT_GET]: DnrRuleMutationResult;
  [TOOL_NAMES.MOCK_REMOVE]: DnrRuleMutationResult;
  [TOOL_NAMES.DEBUGGER_FETCH_PREPARE]: DebuggerFetchStatus;
  [TOOL_NAMES.DEBUGGER_PROXY_ENABLE]: DebuggerProxyStatus;
  [TOOL_NAMES.DEBUGGER_PROXY_DISABLE]: DebuggerProxyStatus;
  [TOOL_NAMES.DEBUGGER_PROXY_LIST_RULES]: DebuggerProxyListResult;
  [TOOL_NAMES.DEBUGGER_PROXY_UPSERT_RULE]: DebuggerProxyRuleMutationResult;
  [TOOL_NAMES.DEBUGGER_PROXY_REMOVE_RULE]: DebuggerProxyRuleMutationResult;
  [TOOL_NAMES.DEBUGGER_PROXY_CLEAR_RULES]: DebuggerProxyRuleMutationResult;
  [TOOL_NAMES.DEBUGGER_PROXY_LIST_HITS]: DebuggerProxyListHitsResult;
  [TOOL_NAMES.DEBUGGER_NETWORK_START]: DebuggerNetworkStatus;
  [TOOL_NAMES.DEBUGGER_NETWORK_STOP]: DebuggerNetworkStatus;
  [TOOL_NAMES.DEBUGGER_NETWORK_CLEAR]: DebuggerNetworkStatus;
  [TOOL_NAMES.DEBUGGER_NETWORK_LIST]: DebuggerNetworkListResult;
  [TOOL_NAMES.DEBUGGER_RESOLVE_SOURCE]: SourceMapResolution;
  [TOOL_NAMES.DEBUGGER_NETWORK_GET]: DebuggerNetworkRequestDetail;
  [TOOL_NAMES.DEBUGGER_NETWORK_GET_BODY]: DebuggerNetworkResponseBody;
  [TOOL_NAMES.DEBUGGER_DETACH]: DebuggerDetachResult;
}

export type ToolCall<TName extends ToolName = ToolName> = {
  [Name in ToolName]: {
    id: string;
    toolName: Name;
    args: ToolArgumentMap[Name];
  };
}[TName];

export type AnyToolCall = ToolCall<ToolName>;

export type ToolExecutionResult<TName extends ToolName = ToolName> = {
  [Name in ToolName]: {
    toolName: Name;
    data: ToolResultMap[Name];
  };
}[TName];

export interface ToolDefinition {
  name: ToolName;
  title: string;
  description: string;
  writesPage: boolean;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: TOOL_NAMES.DOM_GET_PAGE_INFO,
    title: "读取页面",
    description:
      "Collect URL, title, visible text, and a sanitized DOM summary.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DOM_QUERY,
    title: "查询 DOM",
    description:
      "Query DOM by selector or className and return sanitized element details.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DOM_START_ELEMENT_PICK,
    title: "选择元素",
    description:
      "Start hover highlight and click-to-pick mode in the active tab.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.DOM_CANCEL_ELEMENT_PICK,
    title: "取消选择",
    description: "Stop the active element picker.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.DOM_HIGHLIGHT_ELEMENT,
    title: "高亮元素",
    description: "Draw a temporary overlay around the first matched selector.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.DOM_CLEAR_HIGHLIGHTS,
    title: "清除高亮",
    description: "Remove temporary element overlays.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.DOM_SET_VALUE,
    title: "设置 DOM 值",
    description:
      "Set an element value, textContent, innerText, or attribute by CSS selector.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.DOM_LOCATE_SOURCE,
    title: "定位组件源码",
    description:
      "Inspect fixed React/Vue runtime metadata for one exact element and return bounded component source hints.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DOM_EXPLAIN_CSS,
    title: "解释 CSS",
    description:
      "Read matched CSS rules, computed values, variables, and box-model evidence for one exact element.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.PAGE_PERFORMANCE_DIAGNOSTICS,
    title: "页面性能诊断",
    description:
      "Read bounded Navigation Timing, paint, layout-shift, long-task, and slow-resource evidence.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.PAGE_REALTIME_ACTIVITY,
    title: "实时通道诊断",
    description:
      "Summarize WebSocket, EventSource, Service Worker, and IndexedDB metadata without returning message or database values.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.CSS_APPLY_PATCH,
    title: "插入 CSS",
    description: "Insert or replace a temporary CSS patch style tag.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.CSS_REMOVE_PATCH,
    title: "移除 CSS",
    description: "Remove a temporary CSS patch by id.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_TAKE_SCREENSHOT,
    title: "页面截图",
    description:
      "Capture the active tab with CDP Page.captureScreenshot, including full-page and element screenshots.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.BROWSER_LIST_TABS,
    title: "目标页面",
    description: "List http(s)/file tabs that can be used as the explicit CDP target.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.BROWSER_SET_TARGET_TAB,
    title: "设置目标页面",
    description: "Pin one tab as the explicit target for DOM, screenshot, Network, and CDP proxy tools.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.BROWSER_LIST_FRAMES,
    title: "目标 Frame",
    description:
      "List content-script frames discovered in the selected tab, including cross-origin child frames.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.BROWSER_SET_TARGET_FRAME,
    title: "设置目标 Frame",
    description:
      "Pin one discovered frame/document as the target for DOM and selector-based tools.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.BROWSER_NAVIGATE,
    title: "打开地址",
    description: "Navigate the active tab to a URL.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_NAVIGATE_BACK,
    title: "后退",
    description: "Navigate the active tab back in history.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_NAVIGATE_FORWARD,
    title: "前进",
    description: "Navigate the active tab forward in history.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_RELOAD,
    title: "刷新",
    description: "Reload the active tab.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_CLOSE,
    title: "关闭标签页",
    description: "Close the active tab.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_RESIZE,
    title: "调整窗口",
    description: "Resize the active browser window.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_CLICK,
    title: "点击元素",
    description: "Click a visible top-frame element by selector using trusted CDP input.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_HOVER,
    title: "悬浮元素",
    description: "Hover a visible top-frame element by selector using trusted CDP input.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_DRAG,
    title: "拖拽元素",
    description: "Drag between visible top-frame elements using trusted CDP input.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_FILL_FORM,
    title: "填充表单",
    description:
      "Preflight up to 50 controls; use trusted CDP input for text/toggles and a scoped DOM exception for native select values.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_TYPE,
    title: "输入文本",
    description:
      "Focus a visible writable top-frame text target without clicking it and insert text through trusted CDP input.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_PRESS_KEY,
    title: "按键",
    description: "Press one supported key through trusted CDP input.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_SELECT_OPTION,
    title: "选择下拉项",
    description:
      "Select exact options through a bounded DOM operation because CDP has no deterministic cross-platform select-by-value command.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_MOUSE_MOVE,
    title: "移动鼠标",
    description: "Move the mouse to viewport coordinates.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_MOUSE_CLICK,
    title: "坐标点击",
    description: "Click viewport coordinates.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_MOUSE_DOWN,
    title: "鼠标按下",
    description: "Dispatch mouse down at viewport coordinates.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_MOUSE_UP,
    title: "鼠标松开",
    description: "Dispatch mouse up at viewport coordinates.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_MOUSE_DRAG,
    title: "坐标拖拽",
    description: "Drag from one viewport coordinate to another.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_MOUSE_WHEEL,
    title: "滚轮",
    description: "Dispatch a wheel event and scroll the page.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_WAIT_FOR,
    title: "等待页面",
    description: "Wait for text, text disappearance, a selector, or time.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.BROWSER_EVALUATE,
    title: "执行表达式",
    description:
      "Evaluate a constrained JavaScript expression or IIFE against the page DOM. It can read page state and perform controlled page-side mutations for temporary testing.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_HANDLE_DIALOG,
    title: "处理 Dialog",
    description:
      "Accept or dismiss only the currently open JavaScript dialog through CDP.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_STORAGE_STATE,
    title: "读取 Storage",
    description:
      "Read localStorage, sessionStorage, and optionally cookies for the active page.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.BROWSER_COOKIE_LIST,
    title: "读取 Cookie",
    description: "List cookies for the active page or a provided URL.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.BROWSER_COOKIE_SET,
    title: "设置 Cookie",
    description: "Set a cookie for the active page or a provided URL.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_COOKIE_DELETE,
    title: "删除 Cookie",
    description: "Delete a cookie for the active page or a provided URL.",
    writesPage: true,
  },
  {
    name: TOOL_NAMES.BROWSER_CONSOLE_MESSAGES,
    title: "Console 消息",
    description:
      "Attach Chrome debugger and list collected console/log messages for the active tab.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.BROWSER_ACTIVITY_START,
    title: "开始增量活动",
    description:
      "Start bounded DOM, Network, and Console activity notifications for the exact selected target.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.BROWSER_ACTIVITY_STOP,
    title: "停止增量活动",
    description:
      "Stop the activity monitor owned by this extension without replaying browser actions.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DNR_LIST_RULES,
    title: "规则列表",
    description:
      "List dynamic declarativeNetRequest rules created by the extension.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DNR_UPSERT_HEADER_RULE,
    title: "请求头规则",
    description: "Add or replace a dynamic request header modification rule.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DNR_REMOVE_RULE,
    title: "删除规则",
    description: "Remove a dynamic declarativeNetRequest rule by id.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.MOCK_UPSERT_GET,
    title: "GET Mock",
    description:
      "Redirect matched GET requests to an extension JSON mock resource.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.MOCK_REMOVE,
    title: "删除 Mock",
    description: "Remove a dynamic GET mock rule by id.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DEBUGGER_FETCH_PREPARE,
    title: "高级 Mock 预留",
    description:
      "Attach debugger and enable the CDP Fetch domain for future request handling.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DEBUGGER_PROXY_ENABLE,
    title: "启用请求代理",
    description:
      "Attach Chrome debugger and enable CDP Fetch interception for proxy rules.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DEBUGGER_PROXY_DISABLE,
    title: "停用请求代理",
    description: "Disable CDP Fetch interception while keeping rules in memory.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DEBUGGER_PROXY_LIST_RULES,
    title: "代理规则",
    description: "List in-memory CDP Fetch proxy rules.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DEBUGGER_PROXY_UPSERT_RULE,
    title: "保存代理规则",
    description:
      "Add or replace a CDP Fetch rule that can modify request headers or fulfill/replace responses.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DEBUGGER_PROXY_REMOVE_RULE,
    title: "删除代理规则",
    description: "Remove one in-memory CDP Fetch proxy rule.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DEBUGGER_PROXY_CLEAR_RULES,
    title: "清空代理规则",
    description: "Remove all in-memory CDP Fetch proxy rules.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DEBUGGER_PROXY_LIST_HITS,
    title: "代理命中记录",
    description: "List recent CDP Fetch proxy rule hits.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DEBUGGER_NETWORK_START,
    title: "开始 Network",
    description:
      "Attach Chrome debugger to the active tab and start collecting Network events for that tab only.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DEBUGGER_NETWORK_STOP,
    title: "停止 Network",
    description: "Disable Network collection for the active debugger tab.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DEBUGGER_NETWORK_CLEAR,
    title: "清空 Network",
    description: "Clear collected Network requests for the active debugger tab.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DEBUGGER_NETWORK_LIST,
    title: "Network 列表",
    description: "List collected Network requests from the active tab.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DEBUGGER_RESOLVE_SOURCE,
    title: "定位请求源码",
    description:
      "Resolve one generated Network initiator frame through the captured script source map.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DEBUGGER_NETWORK_GET,
    title: "Network 详情",
    description:
      "Read one collected Network request by requestId, optionally including response body.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DEBUGGER_NETWORK_GET_BODY,
    title: "响应体",
    description: "Read response body for one collected Network request.",
    writesPage: false,
  },
  {
    name: TOOL_NAMES.DEBUGGER_DETACH,
    title: "断开 Debugger",
    description: "Detach Chrome debugger from the active tab.",
    writesPage: false,
  },
];

const TOOL_NAME_ALIASES: Record<string, ToolName> = {
  read_page_info: TOOL_NAMES.DOM_GET_PAGE_INFO,
  take_snapshot: TOOL_NAMES.DOM_GET_PAGE_INFO,
  query_dom: TOOL_NAMES.DOM_QUERY,
  browser_query_dom: TOOL_NAMES.DOM_QUERY,
  start_element_picker: TOOL_NAMES.DOM_START_ELEMENT_PICK,
  highlight_element: TOOL_NAMES.DOM_HIGHLIGHT_ELEMENT,
  browser_highlight_element: TOOL_NAMES.DOM_HIGHLIGHT_ELEMENT,
  clear_highlights: TOOL_NAMES.DOM_CLEAR_HIGHLIGHTS,
  set_dom_value: TOOL_NAMES.DOM_SET_VALUE,
  browser_set_dom_value: TOOL_NAMES.DOM_SET_VALUE,
  browser_locate_source: TOOL_NAMES.DOM_LOCATE_SOURCE,
  take_screenshot: TOOL_NAMES.BROWSER_TAKE_SCREENSHOT,
  browser_take_screenshot: TOOL_NAMES.BROWSER_TAKE_SCREENSHOT,
  browser_list_tabs: TOOL_NAMES.BROWSER_LIST_TABS,
  browser_set_target_tab: TOOL_NAMES.BROWSER_SET_TARGET_TAB,
  browser_list_frames: TOOL_NAMES.BROWSER_LIST_FRAMES,
  browser_set_target_frame: TOOL_NAMES.BROWSER_SET_TARGET_FRAME,
  browser_navigate: TOOL_NAMES.BROWSER_NAVIGATE,
  browser_navigate_back: TOOL_NAMES.BROWSER_NAVIGATE_BACK,
  browser_navigate_forward: TOOL_NAMES.BROWSER_NAVIGATE_FORWARD,
  browser_reload: TOOL_NAMES.BROWSER_RELOAD,
  browser_close: TOOL_NAMES.BROWSER_CLOSE,
  browser_resize: TOOL_NAMES.BROWSER_RESIZE,
  browser_click: TOOL_NAMES.BROWSER_CLICK,
  browser_hover: TOOL_NAMES.BROWSER_HOVER,
  browser_drag: TOOL_NAMES.BROWSER_DRAG,
  browser_fill_form: TOOL_NAMES.BROWSER_FILL_FORM,
  browser_type: TOOL_NAMES.BROWSER_TYPE,
  browser_press_key: TOOL_NAMES.BROWSER_PRESS_KEY,
  browser_select_option: TOOL_NAMES.BROWSER_SELECT_OPTION,
  browser_mouse_move_xy: TOOL_NAMES.BROWSER_MOUSE_MOVE,
  browser_mouse_click_xy: TOOL_NAMES.BROWSER_MOUSE_CLICK,
  browser_mouse_down: TOOL_NAMES.BROWSER_MOUSE_DOWN,
  browser_mouse_up: TOOL_NAMES.BROWSER_MOUSE_UP,
  browser_mouse_drag_xy: TOOL_NAMES.BROWSER_MOUSE_DRAG,
  browser_mouse_wheel_xy: TOOL_NAMES.BROWSER_MOUSE_WHEEL,
  browser_wait_for: TOOL_NAMES.BROWSER_WAIT_FOR,
  browser_evaluate: TOOL_NAMES.BROWSER_EVALUATE,
  browser_handle_dialog: TOOL_NAMES.BROWSER_HANDLE_DIALOG,
  browser_storage_state: TOOL_NAMES.BROWSER_STORAGE_STATE,
  browser_cookie_list: TOOL_NAMES.BROWSER_COOKIE_LIST,
  browser_cookie_set: TOOL_NAMES.BROWSER_COOKIE_SET,
  browser_cookie_delete: TOOL_NAMES.BROWSER_COOKIE_DELETE,
  browser_console_messages: TOOL_NAMES.BROWSER_CONSOLE_MESSAGES,
  browser_activity_start: TOOL_NAMES.BROWSER_ACTIVITY_START,
  browser_activity_stop: TOOL_NAMES.BROWSER_ACTIVITY_STOP,
  browser_network_requests: TOOL_NAMES.DEBUGGER_NETWORK_LIST,
  apply_css_patch: TOOL_NAMES.CSS_APPLY_PATCH,
  browser_apply_css_patch: TOOL_NAMES.CSS_APPLY_PATCH,
  remove_css_patch: TOOL_NAMES.CSS_REMOVE_PATCH,
  browser_remove_css_patch: TOOL_NAMES.CSS_REMOVE_PATCH,
  browser_network_start_recording: TOOL_NAMES.DEBUGGER_NETWORK_START,
  browser_network_stop_recording: TOOL_NAMES.DEBUGGER_NETWORK_STOP,
  browser_network_clear: TOOL_NAMES.DEBUGGER_NETWORK_CLEAR,
  browser_network_list_requests: TOOL_NAMES.DEBUGGER_NETWORK_LIST,
  browser_network_get_request: TOOL_NAMES.DEBUGGER_NETWORK_GET,
  browser_network_get_response_body: TOOL_NAMES.DEBUGGER_NETWORK_GET_BODY,
  browser_debugger_detach: TOOL_NAMES.DEBUGGER_DETACH,
  browser_proxy_enable: TOOL_NAMES.DEBUGGER_PROXY_ENABLE,
  browser_proxy_disable: TOOL_NAMES.DEBUGGER_PROXY_DISABLE,
  browser_proxy_list_rules: TOOL_NAMES.DEBUGGER_PROXY_LIST_RULES,
  browser_proxy_upsert_rule: TOOL_NAMES.DEBUGGER_PROXY_UPSERT_RULE,
  browser_proxy_remove_rule: TOOL_NAMES.DEBUGGER_PROXY_REMOVE_RULE,
  browser_proxy_clear_rules: TOOL_NAMES.DEBUGGER_PROXY_CLEAR_RULES,
  browser_proxy_list_hits: TOOL_NAMES.DEBUGGER_PROXY_LIST_HITS,
  browser_list_network_rules: TOOL_NAMES.DNR_LIST_RULES,
  browser_upsert_header_rule: TOOL_NAMES.DNR_UPSERT_HEADER_RULE,
  browser_upsert_get_mock: TOOL_NAMES.MOCK_UPSERT_GET,
  browser_remove_network_rule: TOOL_NAMES.DNR_REMOVE_RULE,
};

export function isWhitelistedToolName(value: string): value is ToolName {
  return TOOL_DEFINITIONS.some((tool) => tool.name === value);
}

export function normalizeToolName(value: string): ToolName | null {
  if (isWhitelistedToolName(value)) {
    return value;
  }

  return TOOL_NAME_ALIASES[value] ?? null;
}

export function normalizeToolCall(call: unknown): AnyToolCall | null {
  if (!isPlainObject(call)) {
    return null;
  }

  const normalizedToolName =
    typeof call.toolName === "string" ? normalizeToolName(call.toolName) : null;

  if (
    !normalizedToolName ||
    typeof call.id !== "string" ||
    !isPlainObject(call.args)
  ) {
    return null;
  }

  return {
    id: call.id,
    toolName: normalizedToolName,
    args: call.args,
  } as AnyToolCall;
}

export function validateToolCall(call: unknown): string | null {
  if (!isPlainObject(call)) {
    return "Tool call must be an object.";
  }

  const toolName = call.toolName;
  const args = call.args;
  const normalizedToolName =
    typeof toolName === "string" ? normalizeToolName(toolName) : null;

  if (!normalizedToolName) {
    const requestedToolName =
      typeof toolName === "string" ? toolName : String(toolName);
    return `Tool is not supported by this extension allowlist: ${requestedToolName}.`;
  }

  if (!isPlainObject(args)) {
    return "Tool args must be an object.";
  }

  switch (normalizedToolName) {
    case TOOL_NAMES.DOM_GET_PAGE_INFO:
      return validatePageSnapshotInput(args);
    case TOOL_NAMES.DOM_START_ELEMENT_PICK:
    case TOOL_NAMES.DOM_CANCEL_ELEMENT_PICK:
    case TOOL_NAMES.DOM_CLEAR_HIGHLIGHTS:
    case TOOL_NAMES.BROWSER_NAVIGATE_BACK:
    case TOOL_NAMES.BROWSER_NAVIGATE_FORWARD:
    case TOOL_NAMES.BROWSER_RELOAD:
    case TOOL_NAMES.BROWSER_CLOSE:
    case TOOL_NAMES.BROWSER_LIST_TABS:
    case TOOL_NAMES.BROWSER_LIST_FRAMES:
    case TOOL_NAMES.DNR_LIST_RULES:
    case TOOL_NAMES.DEBUGGER_PROXY_ENABLE:
    case TOOL_NAMES.DEBUGGER_PROXY_DISABLE:
    case TOOL_NAMES.DEBUGGER_PROXY_LIST_RULES:
    case TOOL_NAMES.DEBUGGER_PROXY_CLEAR_RULES:
    case TOOL_NAMES.DEBUGGER_NETWORK_STOP:
    case TOOL_NAMES.DEBUGGER_NETWORK_CLEAR:
    case TOOL_NAMES.BROWSER_ACTIVITY_STOP:
      return null;
    case TOOL_NAMES.DOM_QUERY:
      return validateDomQuery(args);
    case TOOL_NAMES.DOM_LOCATE_SOURCE:
      return validateLocateSource(args);
    case TOOL_NAMES.DOM_EXPLAIN_CSS:
      return typeof args.selector === "string" && args.selector.trim()
        ? null
        : "selector is required.";
    case TOOL_NAMES.PAGE_PERFORMANCE_DIAGNOSTICS:
    case TOOL_NAMES.PAGE_REALTIME_ACTIVITY:
      return null;
    case TOOL_NAMES.BROWSER_TAKE_SCREENSHOT:
      return validateScreenshotCapture(args);
    case TOOL_NAMES.BROWSER_SET_TARGET_TAB:
      return Number.isInteger(args.tabId) ? null : "tabId is required.";
    case TOOL_NAMES.BROWSER_SET_TARGET_FRAME:
      return typeof args.frameId === "number" &&
        Number.isInteger(args.frameId) &&
        args.frameId >= 0
        ? null
        : "frameId must be a non-negative integer.";
    case TOOL_NAMES.BROWSER_NAVIGATE:
      return typeof args.url === "string" && args.url.trim()
        ? null
        : "url is required.";
    case TOOL_NAMES.BROWSER_RESIZE:
      return validateBrowserResize(args);
    case TOOL_NAMES.BROWSER_CLICK:
      return validateBrowserElementTarget(args);
    case TOOL_NAMES.BROWSER_HOVER:
      return validateBrowserElementTarget(args);
    case TOOL_NAMES.BROWSER_DRAG:
      return validateBrowserDrag(args);
    case TOOL_NAMES.BROWSER_FILL_FORM:
      return validateBrowserFillForm(args);
    case TOOL_NAMES.BROWSER_TYPE:
      return validateBrowserType(args);
    case TOOL_NAMES.BROWSER_PRESS_KEY:
      return typeof args.key === "string" && isSupportedTrustedKey(args.key)
        ? null
        : "key must be one character or a supported named key.";
    case TOOL_NAMES.BROWSER_SELECT_OPTION:
      return validateBrowserSelectOption(args);
    case TOOL_NAMES.BROWSER_MOUSE_MOVE:
      return validateCoordinate(args);
    case TOOL_NAMES.BROWSER_MOUSE_CLICK:
    case TOOL_NAMES.BROWSER_MOUSE_DOWN:
    case TOOL_NAMES.BROWSER_MOUSE_UP:
      return validateCoordinate(args, true);
    case TOOL_NAMES.BROWSER_MOUSE_DRAG:
      return validateCoordinateDrag(args);
    case TOOL_NAMES.BROWSER_MOUSE_WHEEL:
      return validateMouseWheel(args);
    case TOOL_NAMES.BROWSER_WAIT_FOR:
      return validateBrowserWaitFor(args);
    case TOOL_NAMES.BROWSER_EVALUATE:
      return validateBrowserEvaluate(args);
    case TOOL_NAMES.BROWSER_HANDLE_DIALOG:
      return args.action === "accept" || args.action === "dismiss"
        ? null
        : "action must be accept or dismiss.";
    case TOOL_NAMES.BROWSER_STORAGE_STATE:
      return validateStorageState(args);
    case TOOL_NAMES.BROWSER_COOKIE_LIST:
      return validateCookieList(args);
    case TOOL_NAMES.BROWSER_COOKIE_SET:
      return validateCookieSet(args);
    case TOOL_NAMES.BROWSER_COOKIE_DELETE:
      return validateCookieDelete(args);
    case TOOL_NAMES.BROWSER_CONSOLE_MESSAGES:
      return validateBrowserConsoleMessages(args);
    case TOOL_NAMES.BROWSER_ACTIVITY_START:
      return validateBrowserActivityStart(args);
    case TOOL_NAMES.DOM_SET_VALUE:
      return validateDomSetValue(args);
    case TOOL_NAMES.DOM_HIGHLIGHT_ELEMENT:
      return typeof args.selector === "string" && args.selector.trim()
        ? null
        : "selector is required.";
    case TOOL_NAMES.CSS_APPLY_PATCH:
      if (typeof args.patchId !== "string" || !args.patchId.trim()) {
        return "patchId is required.";
      }
      if (typeof args.css !== "string" || !args.css.trim()) {
        return "css is required.";
      }
      return args.css.length <= SANITIZE_LIMITS.cssPatch
        ? null
        : "css patch is too long.";
    case TOOL_NAMES.CSS_REMOVE_PATCH:
      return typeof args.patchId === "string" && args.patchId.trim()
        ? null
        : "patchId is required.";
    case TOOL_NAMES.DNR_UPSERT_HEADER_RULE:
      return validateHeaderRule(args);
    case TOOL_NAMES.DNR_REMOVE_RULE:
    case TOOL_NAMES.MOCK_REMOVE:
      return Number.isInteger(args.ruleId) ? null : "ruleId is required.";
    case TOOL_NAMES.MOCK_UPSERT_GET:
      return typeof args.urlFilter === "string" ||
        typeof args.regexFilter === "string"
        ? null
        : "urlFilter or regexFilter is required.";
    case TOOL_NAMES.DEBUGGER_FETCH_PREPARE:
      return args.urlPattern === undefined ||
        typeof args.urlPattern === "string"
        ? null
        : "urlPattern must be a string.";
    case TOOL_NAMES.DEBUGGER_PROXY_UPSERT_RULE:
      return validateDebuggerProxyRule(args);
    case TOOL_NAMES.DEBUGGER_PROXY_REMOVE_RULE:
      return typeof args.id === "string" && args.id.trim()
        ? null
        : "id is required.";
    case TOOL_NAMES.DEBUGGER_PROXY_LIST_HITS:
      return validateDebuggerProxyListHits(args);
    case TOOL_NAMES.DEBUGGER_NETWORK_START:
      return validateDebuggerNetworkStart(args);
    case TOOL_NAMES.DEBUGGER_NETWORK_LIST:
      return validateDebuggerNetworkList(args);
    case TOOL_NAMES.DEBUGGER_RESOLVE_SOURCE:
      return typeof args.url === "string" &&
        args.url.trim().length > 0 &&
        typeof args.lineNumber === "number" &&
        Number.isInteger(args.lineNumber) &&
        args.lineNumber >= 0 &&
        typeof args.columnNumber === "number" &&
        Number.isInteger(args.columnNumber) &&
        args.columnNumber >= 0
        ? null
        : "url, non-negative lineNumber, and non-negative columnNumber are required.";
    case TOOL_NAMES.DEBUGGER_NETWORK_GET:
      return validateDebuggerNetworkGet(args);
    case TOOL_NAMES.DEBUGGER_NETWORK_GET_BODY:
      return typeof args.requestId === "string" && args.requestId.trim()
        ? null
        : "requestId is required.";
    case TOOL_NAMES.DEBUGGER_DETACH:
      return args.tabId === undefined || Number.isInteger(args.tabId)
        ? null
        : "tabId must be an integer.";
    default:
      return "Unsupported tool.";
  }
}

function validatePageSnapshotInput(args: Record<string, unknown>): string | null {
  const frameAddressError = validateDirectFrameAddress(args);
  if (frameAddressError) {
    return frameAddressError;
  }
  if (
    args.cursor !== undefined &&
    (typeof args.cursor !== "string" || args.cursor.length < 1 || args.cursor.length > 100)
  ) {
    return "Snapshot cursor must be a non-empty string up to 100 characters.";
  }
  if (
    args.limit !== undefined &&
    (typeof args.limit !== "number" ||
      !Number.isInteger(args.limit) ||
      args.limit < 1 ||
      args.limit > 100)
  ) {
    return "Snapshot limit must be an integer between 1 and 100.";
  }
  if (
    args.mode !== undefined &&
    args.mode !== "interactive" &&
    args.mode !== "outline" &&
    args.mode !== "full"
  ) {
    return "Snapshot mode must be interactive, outline, or full.";
  }
  if (
    args.sourceLimit !== undefined &&
    (typeof args.sourceLimit !== "number" ||
      !Number.isInteger(args.sourceLimit) ||
      args.sourceLimit < 100 ||
      args.sourceLimit > 10000)
  ) {
    return "Snapshot sourceLimit must be an integer between 100 and 10000.";
  }
  if (
    args.sinceRevision !== undefined &&
    (typeof args.sinceRevision !== "number" ||
      !Number.isInteger(args.sinceRevision) ||
      args.sinceRevision < 0)
  ) {
    return "Snapshot sinceRevision must be a non-negative integer.";
  }
  if (args.compact !== undefined && typeof args.compact !== "boolean") {
    return "Snapshot compact must be a boolean.";
  }
  if (
    args.frameScope !== undefined &&
    args.frameScope !== "selected" &&
    args.frameScope !== "auto" &&
    args.frameScope !== "all-accessible"
  ) {
    return "Snapshot frameScope must be selected, auto, or all-accessible.";
  }
  if (
    args.maxFrames !== undefined &&
    (typeof args.maxFrames !== "number" ||
      !Number.isInteger(args.maxFrames) ||
      args.maxFrames < 1 ||
      args.maxFrames > 12)
  ) {
    return "Snapshot maxFrames must be an integer between 1 and 12.";
  }
  if (
    args.cursor !== undefined &&
    args.frameScope !== undefined &&
    args.frameScope !== "selected"
  ) {
    return "Snapshot cursor pagination is available only with frameScope=selected.";
  }
  const unknownKeys = Object.keys(args).filter(
    (key) =>
      key !== "cursor" &&
      key !== "limit" &&
      key !== "mode" &&
      key !== "sourceLimit" &&
      key !== "sinceRevision" &&
      key !== "compact" &&
      key !== "frameScope" &&
      key !== "maxFrames" &&
      key !== "frameId" &&
      key !== "documentId",
  );
  return unknownKeys.length > 0
    ? `Snapshot arguments contain unsupported keys: ${unknownKeys.join(", ")}.`
    : null;
}

function validateDebuggerProxyRule(
  args: Record<string, unknown>,
): string | null {
  if (
    typeof args.urlPattern !== "string" &&
    typeof args.urlContains !== "string" &&
    typeof args.regexFilter !== "string"
  ) {
    return "urlPattern, urlContains, or regexFilter is required.";
  }

  if (args.id !== undefined && typeof args.id !== "string") {
    return "id must be a string.";
  }
  if (args.enabled !== undefined && typeof args.enabled !== "boolean") {
    return "enabled must be a boolean.";
  }
  if (
    args.priority !== undefined &&
    (!Number.isInteger(args.priority) || Number(args.priority) <= 0)
  ) {
    return "priority must be a positive integer.";
  }
  if (args.method !== undefined && typeof args.method !== "string") {
    return "method must be a string.";
  }
  if (
    args.resourceType !== undefined &&
    typeof args.resourceType !== "string"
  ) {
    return "resourceType must be a string.";
  }
  if (
    args.mockStage !== undefined &&
    args.mockStage !== "request" &&
    args.mockStage !== "response"
  ) {
    return "mockStage must be request or response.";
  }
  if (
    args.statusCode !== undefined &&
    (!Number.isInteger(args.statusCode) ||
      Number(args.statusCode) < 100 ||
      Number(args.statusCode) > 599)
  ) {
    return "statusCode must be a valid HTTP status.";
  }
  if (
    args.responseBody !== undefined &&
    typeof args.responseBody !== "string"
  ) {
    return "responseBody must be a string.";
  }
  if (
    args.responseBodyBase64 !== undefined &&
    typeof args.responseBodyBase64 !== "string"
  ) {
    return "responseBodyBase64 must be a string.";
  }

  const requestHeaderError = validateProxyHeaderList(args.requestHeaders);
  if (requestHeaderError) {
    return `requestHeaders ${requestHeaderError}`;
  }

  const responseHeaderError = validateProxyHeaderList(args.responseHeaders);
  if (responseHeaderError) {
    return `responseHeaders ${responseHeaderError}`;
  }

  if (
    args.scenarioRepeat !== undefined &&
    args.scenarioRepeat !== "hold-last" &&
    args.scenarioRepeat !== "loop"
  ) {
    return "scenarioRepeat must be hold-last or loop.";
  }
  if (
    args.resetScenario !== undefined &&
    typeof args.resetScenario !== "boolean"
  ) {
    return "resetScenario must be a boolean.";
  }
  const scenarioError = validateProxyScenarioSteps(args.scenarioSteps);
  if (scenarioError) {
    return scenarioError;
  }

  if (
    !args.requestHeaders &&
    !args.responseHeaders &&
    args.responseBody === undefined &&
    args.responseBodyBase64 === undefined &&
    args.statusCode === undefined &&
    args.responsePhrase === undefined &&
    args.contentType === undefined &&
    args.scenarioSteps === undefined
  ) {
    return "At least one proxy action is required.";
  }

  return null;
}

function validateProxyScenarioSteps(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    return "scenarioSteps must contain between 1 and 50 steps.";
  }
  for (const [index, step] of value.entries()) {
    if (!isPlainObject(step)) {
      return `scenarioSteps[${index}] must be an object.`;
    }
    if (step.name !== undefined && typeof step.name !== "string") {
      return `scenarioSteps[${index}].name must be a string.`;
    }
    if (
      step.statusCode !== undefined &&
      (!Number.isInteger(step.statusCode) ||
        Number(step.statusCode) < 100 ||
        Number(step.statusCode) > 599)
    ) {
      return `scenarioSteps[${index}].statusCode must be a valid HTTP status.`;
    }
    for (const key of [
      "responseBody",
      "responseBodyBase64",
      "responsePhrase",
      "contentType",
    ] as const) {
      if (step[key] !== undefined && typeof step[key] !== "string") {
        return `scenarioSteps[${index}].${key} must be a string.`;
      }
    }
    const headerError = validateProxyHeaderList(step.responseHeaders);
    if (headerError) {
      return `scenarioSteps[${index}].responseHeaders ${headerError}`;
    }
    if (
      !step.responseHeaders &&
      step.responseBody === undefined &&
      step.responseBodyBase64 === undefined &&
      step.statusCode === undefined &&
      step.responsePhrase === undefined &&
      step.contentType === undefined
    ) {
      return `scenarioSteps[${index}] must define at least one response action.`;
    }
  }
  return null;
}

function validateScreenshotCapture(args: Record<string, unknown>): string | null {
  const frameAddressError = validateDirectFrameAddress(args);
  if (frameAddressError) {
    return frameAddressError;
  }
  if (
    args.type !== undefined &&
    args.type !== "png" &&
    args.type !== "jpeg"
  ) {
    return "type must be png or jpeg.";
  }
  if (args.selector !== undefined && typeof args.selector !== "string") {
    return "selector must be a string.";
  }
  if (args.target !== undefined && typeof args.target !== "string") {
    return "target must be a string.";
  }
  if (args.element !== undefined && typeof args.element !== "string") {
    return "element must be a string.";
  }
  const screenshotTarget = args.target ?? args.selector ?? args.element;
  if (typeof screenshotTarget === "string") {
    const targetError = validateNativeCssSelector(screenshotTarget, "selector");
    if (targetError) {
      return targetError;
    }
  }
  if (args.fullPage !== undefined && typeof args.fullPage !== "boolean") {
    return "fullPage must be a boolean.";
  }
  if (
    args.quality !== undefined &&
    (!Number.isInteger(args.quality) ||
      Number(args.quality) < 0 ||
      Number(args.quality) > 100)
  ) {
    return "quality must be an integer between 0 and 100.";
  }
  if (args.filename !== undefined && typeof args.filename !== "string") {
    return "filename must be a string.";
  }
  if (
    args.saveToDownloads !== undefined &&
    typeof args.saveToDownloads !== "boolean"
  ) {
    return "saveToDownloads must be a boolean.";
  }
  if (
    args.diffAgainst !== undefined &&
    args.diffAgainst !== "previous"
  ) {
    return "diffAgainst must be previous.";
  }
  if (
    args.returnImage !== undefined &&
    args.returnImage !== "always" &&
    args.returnImage !== "changed" &&
    args.returnImage !== "never"
  ) {
    return "returnImage must be always, changed, or never.";
  }
  if (
    args.diffThreshold !== undefined &&
    (!Number.isInteger(args.diffThreshold) ||
      Number(args.diffThreshold) < 0 ||
      Number(args.diffThreshold) > 255)
  ) {
    return "diffThreshold must be an integer between 0 and 255.";
  }
  return null;
}

function validateBrowserElementTarget(
  args: Record<string, unknown>,
): string | null {
  const frameAddressError = validateDirectFrameAddress(args);
  if (frameAddressError) {
    return frameAddressError;
  }
  const target = args.target ?? args.selector ?? args.element;
  if (typeof target !== "string" || !target.trim()) {
    return "selector or target is required.";
  }
  return validateNativeCssSelector(target, "selector");
}

function validateBrowserDrag(args: Record<string, unknown>): string | null {
  const frameAddressError = validateDirectFrameAddress(args);
  if (frameAddressError) {
    return frameAddressError;
  }
  const source = args.source ?? args.sourceSelector;
  const target = args.target ?? args.targetSelector;
  if (typeof source !== "string" || !source.trim()) {
    return "source is required.";
  }
  const sourceError = validateNativeCssSelector(source, "source");
  if (sourceError) {
    return sourceError;
  }
  if (typeof target !== "string" || !target.trim()) {
    return "target is required.";
  }
  return validateNativeCssSelector(target, "target");
}

function validateBrowserFillForm(args: Record<string, unknown>): string | null {
  if (!Array.isArray(args.fields) || args.fields.length === 0) {
    return "fields must be a non-empty array.";
  }
  if (args.fields.length > 50) {
    return "fields is limited to 50 controls per operation.";
  }
  if (
    Object.keys(args).some(
      (key) =>
        key !== "fields" &&
        key !== "frameId" &&
        key !== "documentId" &&
        key !== "decisionBarrier",
    )
  ) {
    return "fill form arguments contain unsupported keys.";
  }
  const frameAddressError = validateDirectFrameAddress(args);
  if (frameAddressError) {
    return frameAddressError;
  }

  for (const field of args.fields) {
    if (!isPlainObject(field)) {
      return "each field must be an object.";
    }
    const allowedKeys = new Set([
      "selector",
      "target",
      "element",
      "name",
      "value",
      "type",
    ]);
    if (Object.keys(field).some((key) => !allowedKeys.has(key))) {
      return "form field contains unsupported keys.";
    }
    const targetError = validateBoundedFormControlTarget(field, true);
    if (targetError) {
      return targetError;
    }
    if (
      typeof field.value !== "string" &&
      typeof field.value !== "boolean" &&
      !(
        Array.isArray(field.value) &&
        field.value.every((value) => typeof value === "string")
      )
    ) {
      return "field value must be a string, boolean, or string array.";
    }
    if (
      typeof field.value === "string" &&
      field.value.length > SANITIZE_LIMITS.domMutationValue
    ) {
      return "field string value is too long.";
    }
    if (Array.isArray(field.value)) {
      if (field.value.length === 0 || field.value.length > 50) {
        return "field option values must contain between 1 and 50 items.";
      }
      if (
        field.value.some(
          (value) =>
            !value || value.length > SANITIZE_LIMITS.domMutationValue,
        )
      ) {
        return "field option values must be non-empty bounded strings.";
      }
      if (new Set(field.value).size !== field.value.length) {
        return "field option values must be unique.";
      }
    }
    if (
      field.type !== undefined &&
      field.type !== "text" &&
      field.type !== "checkbox" &&
      field.type !== "radio" &&
      field.type !== "select"
    ) {
      return "field type must be text, checkbox, radio, or select.";
    }
    if (field.type === "text" && typeof field.value !== "string") {
      return "text fields require a string value.";
    }
    if (
      (field.type === "checkbox" || field.type === "radio") &&
      typeof field.value !== "boolean"
    ) {
      return "checkbox and radio fields require a boolean value.";
    }
    if (field.type === "select" && typeof field.value === "boolean") {
      return "select fields require a string or string-array value.";
    }
  }

  return null;
}

function validateBrowserType(args: Record<string, unknown>): string | null {
  const targetError = validateBrowserElementTarget(args);
  if (targetError) {
    return targetError;
  }
  if (typeof args.text !== "string") {
    return "text is required.";
  }
  if (args.submit !== undefined && typeof args.submit !== "boolean") {
    return "submit must be a boolean.";
  }
  if (args.slowly !== undefined && typeof args.slowly !== "boolean") {
    return "slowly must be a boolean.";
  }
  if (args.replace !== undefined && typeof args.replace !== "boolean") {
    return "replace must be a boolean.";
  }
  if (args.slowly === true && Array.from(args.text).length > 500) {
    return "slowly typed text is limited to 500 Unicode characters.";
  }
  return args.text.length <= SANITIZE_LIMITS.domMutationValue
    ? null
    : "text is too long.";
}

function validateCoordinate(
  args: Record<string, unknown>,
  allowButton = false,
): string | null {
  if (typeof args.x !== "number" || typeof args.y !== "number") {
    return "x and y are required numbers.";
  }
  if (
    allowButton &&
    args.button !== undefined &&
    args.button !== "left" &&
    args.button !== "right" &&
    args.button !== "middle"
  ) {
    return "button must be left, right, or middle.";
  }
  if (args.doubleClick !== undefined && typeof args.doubleClick !== "boolean") {
    return "doubleClick must be a boolean.";
  }
  return null;
}

function validateCoordinateDrag(args: Record<string, unknown>): string | null {
  for (const key of ["startX", "startY", "endX", "endY"]) {
    if (typeof args[key] !== "number") {
      return `${key} is required.`;
    }
  }
  if (
    args.steps !== undefined &&
    (!Number.isInteger(args.steps) ||
      Number(args.steps) < 1 ||
      Number(args.steps) > 50)
  ) {
    return "steps must be an integer between 1 and 50.";
  }
  return null;
}

function validateMouseWheel(args: Record<string, unknown>): string | null {
  if (args.deltaX !== undefined && typeof args.deltaX !== "number") {
    return "deltaX must be a number.";
  }
  if (args.deltaY !== undefined && typeof args.deltaY !== "number") {
    return "deltaY must be a number.";
  }
  if (args.x !== undefined && typeof args.x !== "number") {
    return "x must be a number.";
  }
  if (args.y !== undefined && typeof args.y !== "number") {
    return "y must be a number.";
  }
  return args.deltaX !== undefined || args.deltaY !== undefined
    ? null
    : "deltaX or deltaY is required.";
}

function validateBrowserEvaluate(args: Record<string, unknown>): string | null {
  if (typeof args.expression !== "string" || !args.expression.trim()) {
    return "expression is required.";
  }
  if (args.selector !== undefined && typeof args.selector !== "string") {
    return "selector must be a string.";
  }
  if (
    args.timeoutMs !== undefined &&
    (!Number.isInteger(args.timeoutMs) ||
      Number(args.timeoutMs) < 100 ||
      Number(args.timeoutMs) > 10000)
  ) {
    return "timeoutMs must be an integer between 100 and 10000.";
  }
  return args.expression.length <= 4000
    ? null
    : "expression is too long.";
}

function validateStorageState(args: Record<string, unknown>): string | null {
  for (const key of [
    "includeLocalStorage",
    "includeSessionStorage",
    "includeCookies",
  ]) {
    if (args[key] !== undefined && typeof args[key] !== "boolean") {
      return `${key} must be a boolean.`;
    }
  }
  return null;
}

function validateCookieList(args: Record<string, unknown>): string | null {
  if (args.url !== undefined && typeof args.url !== "string") {
    return "url must be a string.";
  }
  if (args.name !== undefined && typeof args.name !== "string") {
    return "name must be a string.";
  }
  if (args.domain !== undefined && typeof args.domain !== "string") {
    return "domain must be a string.";
  }
  return null;
}

function validateCookieSet(args: Record<string, unknown>): string | null {
  if (typeof args.name !== "string" || !args.name.trim()) {
    return "name is required.";
  }
  if (typeof args.value !== "string") {
    return "value is required.";
  }
  if (args.url !== undefined && typeof args.url !== "string") {
    return "url must be a string.";
  }
  if (args.domain !== undefined && typeof args.domain !== "string") {
    return "domain must be a string.";
  }
  if (args.path !== undefined && typeof args.path !== "string") {
    return "path must be a string.";
  }
  if (args.secure !== undefined && typeof args.secure !== "boolean") {
    return "secure must be a boolean.";
  }
  if (args.httpOnly !== undefined && typeof args.httpOnly !== "boolean") {
    return "httpOnly must be a boolean.";
  }
  if (
    args.sameSite !== undefined &&
    args.sameSite !== "no_restriction" &&
    args.sameSite !== "lax" &&
    args.sameSite !== "strict" &&
    args.sameSite !== "unspecified"
  ) {
    return "sameSite must be no_restriction, lax, strict, or unspecified.";
  }
  if (
    args.expirationDate !== undefined &&
    typeof args.expirationDate !== "number"
  ) {
    return "expirationDate must be a number.";
  }
  return null;
}

function validateCookieDelete(args: Record<string, unknown>): string | null {
  if (typeof args.name !== "string" || !args.name.trim()) {
    return "name is required.";
  }
  if (args.url !== undefined && typeof args.url !== "string") {
    return "url must be a string.";
  }
  return null;
}

function validateBrowserSelectOption(
  args: Record<string, unknown>,
): string | null {
  const allowedKeys = new Set([
    "selector",
    "target",
    "element",
    "values",
    "frameId",
    "documentId",
  ]);
  if (Object.keys(args).some((key) => !allowedKeys.has(key))) {
    return "select option arguments contain unsupported keys.";
  }
  const frameAddressError = validateDirectFrameAddress(args);
  if (frameAddressError) {
    return frameAddressError;
  }
  const targetError = validateBoundedFormControlTarget(args, false);
  if (targetError) {
    return targetError;
  }
  if (
    !Array.isArray(args.values) ||
    args.values.length === 0 ||
    args.values.length > 50 ||
    args.values.some(
      (value) =>
        typeof value !== "string" ||
        !value ||
        value.length > SANITIZE_LIMITS.domMutationValue,
    )
  ) {
    return "values must contain between 1 and 50 non-empty bounded strings.";
  }
  if (new Set(args.values).size !== args.values.length) {
    return "values must be unique.";
  }
  return null;
}

function validateDirectFrameAddress(
  args: Record<string, unknown>,
): string | null {
  if (args.frameId === undefined && args.documentId === undefined) {
    return null;
  }
  if (
    typeof args.frameId !== "number" ||
    !Number.isInteger(args.frameId) ||
    args.frameId < 0
  ) {
    return "frameId must be a non-negative integer.";
  }
  if (
    args.documentId !== undefined &&
    (typeof args.documentId !== "string" || !args.documentId.trim())
  ) {
    return "documentId must be a non-empty string.";
  }
  if (args.frameId !== 0 && args.documentId === undefined) {
    return "documentId is required for direct child-frame execution.";
  }
  return null;
}

function validateBoundedFormControlTarget(
  args: Record<string, unknown>,
  allowName: boolean,
): string | null {
  const keys = allowName
    ? ["selector", "target", "element", "name"]
    : ["selector", "target", "element"];
  for (const key of keys) {
    const value = args[key];
    if (
      value !== undefined &&
      (typeof value !== "string" ||
        !value.trim() ||
        value.length > (key === "name" ? 500 : 2_000))
    ) {
      return `${key} must be a non-empty bounded string.`;
    }
    if (key !== "name" && typeof value === "string") {
      const selectorError = validateNativeCssSelector(value, key);
      if (selectorError) {
        return selectorError;
      }
    }
  }
  return keys.some((key) => typeof args[key] === "string")
    ? null
    : allowName
      ? "each field needs selector, target, element, or name."
      : "selector or target is required.";
}

function validateNativeCssSelector(
  selector: string,
  label: string,
): string | null {
  const trimmed = selector.trim();
  if (!trimmed || trimmed.length > 2_000) {
    return `${label} must be a non-empty CSS selector no longer than 2000 characters.`;
  }

  const playwrightPseudo = /(^|[^\\]):(?:has-text|text|text-is|text-matches|contains|visible|near|above|below|right-of|left-of)(?:\s*\(|\b)/i;
  if (
    playwrightPseudo.test(trimmed) ||
    /^(?:text|xpath|css)\s*=/i.test(trimmed) ||
    />>/.test(trimmed) ||
    /\bgetBy(?:Role|Text|Label|Placeholder|TestId)\s*\(/i.test(trimmed)
  ) {
    return `${label} must use native browser CSS only. Playwright/jQuery text selectors, locator syntax, XPath, and selector chaining are not supported. Read a fresh browser_snapshot or browser_query_dom result and reuse its exact selector.`;
  }
  return null;
}

function validateBrowserWaitFor(args: Record<string, unknown>): string | null {
  const frameAddressError = validateDirectFrameAddress(args);
  if (frameAddressError) {
    return frameAddressError;
  }
  if (args.time !== undefined && typeof args.time !== "number") {
    return "time must be a number of seconds.";
  }
  if (args.text !== undefined && typeof args.text !== "string") {
    return "text must be a string.";
  }
  if (args.textGone !== undefined && typeof args.textGone !== "string") {
    return "textGone must be a string.";
  }
  if (args.selector !== undefined && typeof args.selector !== "string") {
    return "selector must be a string.";
  }
  if (
    args.timeoutMs !== undefined &&
    (!Number.isInteger(args.timeoutMs) ||
      Number(args.timeoutMs) < 100 ||
      Number(args.timeoutMs) > 60000)
  ) {
    return "timeoutMs must be an integer between 100 and 60000.";
  }
  return args.time !== undefined ||
    typeof args.text === "string" ||
    typeof args.textGone === "string" ||
    typeof args.selector === "string"
    ? null
    : "time, text, textGone, or selector is required.";
}

function validateBrowserResize(args: Record<string, unknown>): string | null {
  return Number.isInteger(args.width) &&
    Number(args.width) >= 320 &&
    Number.isInteger(args.height) &&
    Number(args.height) >= 240
    ? null
    : "width and height must be integers at least 320x240.";
}

function validateBrowserConsoleMessages(
  args: Record<string, unknown>,
): string | null {
  if (
    args.level !== undefined &&
    args.level !== "error" &&
    args.level !== "warning" &&
    args.level !== "info" &&
    args.level !== "debug"
  ) {
    return "level must be error, warning, info, or debug.";
  }
  if (args.all !== undefined && typeof args.all !== "boolean") {
    return "all must be a boolean.";
  }
  if (
    args.limit !== undefined &&
    (!Number.isInteger(args.limit) ||
      Number(args.limit) <= 0 ||
      Number(args.limit) > 500)
  ) {
    return "limit must be an integer between 1 and 500.";
  }
  return null;
}

function validateBrowserActivityStart(
  args: Record<string, unknown>,
): string | null {
  for (const key of ["includeDom", "includeNetwork", "includeConsole", "preserveLog"]) {
    if (args[key] !== undefined && typeof args[key] !== "boolean") {
      return `${key} must be a boolean.`;
    }
  }
  if (
    args.maxNetworkEntries !== undefined &&
    (!Number.isInteger(args.maxNetworkEntries) ||
      Number(args.maxNetworkEntries) < 10 ||
      Number(args.maxNetworkEntries) > 2_000)
  ) {
    return "maxNetworkEntries must be an integer between 10 and 2000.";
  }
  return null;
}

function validateLocateSource(args: Record<string, unknown>): string | null {
  if (typeof args.selector !== "string" || !args.selector.trim()) {
    return "selector is required.";
  }
  const frameError = validateDirectFrameAddress(args);
  if (frameError) {
    return frameError;
  }
  if (
    args.maxDepth !== undefined &&
    (!Number.isInteger(args.maxDepth) ||
      Number(args.maxDepth) < 1 ||
      Number(args.maxDepth) > 20)
  ) {
    return "maxDepth must be an integer between 1 and 20.";
  }
  return args.includeSourceExcerpt === undefined ||
    typeof args.includeSourceExcerpt === "boolean"
    ? null
    : "includeSourceExcerpt must be a boolean.";
}

function validateProxyHeaderList(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value)) {
    return "must be an array.";
  }

  for (const header of value) {
    if (!isPlainObject(header)) {
      return "entries must be objects.";
    }
    if (typeof header.header !== "string" || !header.header.trim()) {
      return "header is required.";
    }
    if (
      header.operation !== "set" &&
      header.operation !== "append" &&
      header.operation !== "remove"
    ) {
      return "operation must be set, append, or remove.";
    }
    if (header.operation !== "remove" && typeof header.value !== "string") {
      return "value is required for set and append.";
    }
  }

  return null;
}

function validateDebuggerProxyListHits(
  args: Record<string, unknown>,
): string | null {
  if (
    args.limit !== undefined &&
    (!Number.isInteger(args.limit) ||
      Number(args.limit) <= 0 ||
      Number(args.limit) > 500)
  ) {
    return "limit must be an integer between 1 and 500.";
  }
  if (args.ruleId !== undefined && typeof args.ruleId !== "string") {
    return "ruleId must be a string.";
  }
  return null;
}

function validateDebuggerNetworkStart(
  args: Record<string, unknown>,
): string | null {
  if (
    args.preserveLog !== undefined &&
    typeof args.preserveLog !== "boolean"
  ) {
    return "preserveLog must be a boolean.";
  }
  if (
    args.maxEntries !== undefined &&
    (!Number.isInteger(args.maxEntries) ||
      Number(args.maxEntries) < 10 ||
      Number(args.maxEntries) > 5000)
  ) {
    return "maxEntries must be an integer between 10 and 5000.";
  }
  return null;
}

function validateDebuggerNetworkList(
  args: Record<string, unknown>,
): string | null {
  if (args.digestOnly !== undefined && typeof args.digestOnly !== "boolean") {
    return "digestOnly must be a boolean.";
  }
  if (
    args.limit !== undefined &&
    (!Number.isInteger(args.limit) ||
      Number(args.limit) <= 0 ||
      Number(args.limit) > 500)
  ) {
    return "limit must be an integer between 1 and 500.";
  }
  if (
    args.urlContains !== undefined &&
    typeof args.urlContains !== "string"
  ) {
    return "urlContains must be a string.";
  }
  if (args.method !== undefined && typeof args.method !== "string") {
    return "method must be a string.";
  }
  if (
    args.resourceType !== undefined &&
    typeof args.resourceType !== "string"
  ) {
    return "resourceType must be a string.";
  }
  if (
    args.statusMin !== undefined &&
    (!Number.isInteger(args.statusMin) ||
      Number(args.statusMin) < 100 ||
      Number(args.statusMin) > 599)
  ) {
    return "statusMin must be a valid HTTP status.";
  }
  if (
    args.statusMax !== undefined &&
    (!Number.isInteger(args.statusMax) ||
      Number(args.statusMax) < 100 ||
      Number(args.statusMax) > 599)
  ) {
    return "statusMax must be a valid HTTP status.";
  }
  return null;
}

function validateDebuggerNetworkGet(
  args: Record<string, unknown>,
): string | null {
  if (typeof args.requestId !== "string" || !args.requestId.trim()) {
    return "requestId is required.";
  }
  if (args.includeBody !== undefined && typeof args.includeBody !== "boolean") {
    return "includeBody must be a boolean.";
  }
  return null;
}

function validateDomSetValue(args: Record<string, unknown>): string | null {
  if (typeof args.selector !== "string" || !args.selector.trim()) {
    return "selector is required.";
  }
  if (typeof args.value !== "string") {
    return "value is required.";
  }
  if (
    args.target !== undefined &&
    args.target !== "auto" &&
    args.target !== "value" &&
    args.target !== "textContent" &&
    args.target !== "innerText" &&
    args.target !== "attribute"
  ) {
    return "target must be auto, value, textContent, innerText, or attribute.";
  }
  if (
    args.target === "attribute" &&
    (typeof args.attributeName !== "string" || !args.attributeName.trim())
  ) {
    return "attributeName is required when target is attribute.";
  }
  if (
    args.dispatchEvents !== undefined &&
    typeof args.dispatchEvents !== "boolean"
  ) {
    return "dispatchEvents must be a boolean.";
  }
  return args.value.length <= SANITIZE_LIMITS.domMutationValue
    ? null
    : "value is too long.";
}

function validateDomQuery(args: Record<string, unknown>): string | null {
  if (typeof args.query !== "string" || !args.query.trim()) {
    return "query is required.";
  }

  if (
    args.queryType !== "selector" &&
    args.queryType !== "className" &&
    args.queryType !== "xpath"
  ) {
    return "queryType must be selector, className, or xpath.";
  }

  if (
    args.limit !== undefined &&
    (!Number.isInteger(args.limit) ||
      Number(args.limit) <= 0 ||
      Number(args.limit) > 100)
  ) {
    return "limit must be an integer between 1 and 100.";
  }

  for (const flag of [
    "includeText",
    "includeOuterHTML",
    "includeComputedStyle",
  ] as const) {
    if (args[flag] !== undefined && typeof args[flag] !== "boolean") {
      return `${flag} must be a boolean.`;
    }
  }

  for (const limitName of [
    "maxTextLength",
    "maxOuterHTMLLength",
  ] as const) {
    if (
      args[limitName] !== undefined &&
      (!Number.isInteger(args[limitName]) || Number(args[limitName]) < 0)
    ) {
      return `${limitName} must be a non-negative integer.`;
    }
  }

  if (args.computedStyleProperties !== undefined) {
    if (
      !Array.isArray(args.computedStyleProperties) ||
      args.computedStyleProperties.length === 0 ||
      args.computedStyleProperties.length >
        SUPPORTED_COMPUTED_STYLE_PROPERTIES.length
    ) {
      return "computedStyleProperties must be a non-empty bounded array.";
    }
    const supported = new Set<string>(SUPPORTED_COMPUTED_STYLE_PROPERTIES);
    if (
      args.computedStyleProperties.some(
        (property) => typeof property !== "string" || !supported.has(property),
      )
    ) {
      return "computedStyleProperties contains an unsupported property.";
    }
    if (
      new Set(args.computedStyleProperties).size !==
      args.computedStyleProperties.length
    ) {
      return "computedStyleProperties must be unique.";
    }
    if (args.includeComputedStyle === false) {
      return "computedStyleProperties cannot be used when includeComputedStyle is false.";
    }
  }

  return null;
}

function validateHeaderRule(args: Record<string, unknown>): string | null {
  if (
    args.target !== undefined &&
    args.target !== "request" &&
    args.target !== "response"
  ) {
    return "target must be request or response.";
  }

  if (
    typeof args.urlFilter !== "string" &&
    typeof args.regexFilter !== "string"
  ) {
    return "urlFilter or regexFilter is required.";
  }

  if (!Array.isArray(args.headers) || args.headers.length === 0) {
    return "headers are required.";
  }

  for (const header of args.headers) {
    if (!isPlainObject(header)) {
      return "each header modification must be an object.";
    }
    if (typeof header.header !== "string" || !header.header.trim()) {
      return "header name is required.";
    }
    if (
      header.operation !== "set" &&
      header.operation !== "append" &&
      header.operation !== "remove"
    ) {
      return "header operation must be set, append, or remove.";
    }
    if (header.operation !== "remove" && typeof header.value !== "string") {
      return "header value is required for set and append.";
    }
  }

  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

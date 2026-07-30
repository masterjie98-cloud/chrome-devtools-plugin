import {
  clickElement,
  clickMouse,
  cleanDebuggerBlockingFrames,
  dragElement,
  dragMouse,
  evaluateExpression,
  getElementRect,
  getStorageState,
  hoverElement,
  inspectFormControl,
  mouseDown,
  mouseUp,
  moveMouse,
  applySelectOption,
  waitFor,
  wheelMouse,
} from "./browserAutomation";
import {
  clearHighlights,
  configureDomActivityEmitter,
  getPageSnapshot,
  highlightElement,
  queryDom,
  setDomActivityMonitoring,
  setDomValue
} from "./domInspector";
import { cancelElementPicker, startElementPicker } from "./elementPicker";
import { presentAgentPointer } from "./agentPointer";
import { applyCssPatch, removeCssPatch } from "./stylePatches";
import { MESSAGE_TYPES, type ExtensionRequest } from "../shared/messages";
import {
  errorResponse,
  isBackgroundContentRequest,
  makeEvent,
  okResponse,
  sendRuntimeEvent,
} from "../shared/messaging";

type ContentRuntimeGlobal = typeof globalThis & {
  __AI_DEVTOOLS_CONTENT_SCRIPT_READY__?: boolean;
};

const contentRuntime = globalThis as ContentRuntimeGlobal;
if (!contentRuntime.__AI_DEVTOOLS_CONTENT_SCRIPT_READY__) {
  contentRuntime.__AI_DEVTOOLS_CONTENT_SCRIPT_READY__ = true;
  initializeContentScript();
}

function initializeContentScript(): void {
  announceTargetPage("load");
  configureDomActivityEmitter((entry) => {
    sendRuntimeEvent(
      makeEvent("content", MESSAGE_TYPES.CONTENT_DOM_ACTIVITY, {
        kind: "dom",
        observedAt: new Date().toISOString(),
        summary: {
          toRevision: entry.revision,
          added: entry.added,
          removed: entry.removed,
          attributes: entry.attributes,
          characterData: entry.characterData,
          domSamples: entry.domSamples,
          domSamplesOmitted: entry.domSamplesOmitted,
        },
      }),
    );
  });

  window.addEventListener("focus", () => announceTargetPage("focus"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      announceTargetPage("visible");
    }
  });

  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse) => {
      if (!isBackgroundContentRequest(message)) {
        return false;
      }

      void Promise.resolve()
        .then(() => handleContentRequest(message))
        .then(sendResponse)
        .catch((error) => {
          sendResponse(
            errorResponse(
              message as ExtensionRequest,
              "CONTENT_REQUEST_FAILED",
              error instanceof Error ? error.message : "Content request failed.",
              error,
            ),
          );
        });

      return true;
    },
  );
}

function handleContentRequest(request: ExtensionRequest) {
  switch (request.type) {
    case MESSAGE_TYPES.CONTENT_GET_PAGE_INFO:
      return okResponse(request, getPageSnapshot(request.payload));
    case MESSAGE_TYPES.CONTENT_SET_ACTIVITY_MONITOR:
      return okResponse(
        request,
        setDomActivityMonitoring(request.payload.enabled),
      );
    case MESSAGE_TYPES.CONTENT_QUERY_DOM:
      return okResponse(request, queryDom(request.payload));
    case MESSAGE_TYPES.CONTENT_START_ELEMENT_PICK:
      return okResponse(request, startElementPicker());
    case MESSAGE_TYPES.CONTENT_CANCEL_ELEMENT_PICK:
      return okResponse(request, cancelElementPicker("request"));
    case MESSAGE_TYPES.CONTENT_HIGHLIGHT_ELEMENT:
      return okResponse(request, highlightElement(request.payload));
    case MESSAGE_TYPES.CONTENT_CLEAR_HIGHLIGHTS:
      clearHighlights();
      return okResponse(request, { cleared: true });
    case MESSAGE_TYPES.CONTENT_SET_DOM_VALUE:
      return okResponse(request, setDomValue(request.payload));
    case MESSAGE_TYPES.CONTENT_GET_ELEMENT_RECT:
      return okResponse(request, getElementRect(request.payload));
    case MESSAGE_TYPES.CONTENT_CLICK_ELEMENT:
      return okResponse(request, clickElement(request.payload));
    case MESSAGE_TYPES.CONTENT_HOVER_ELEMENT:
      return okResponse(request, hoverElement(request.payload));
    case MESSAGE_TYPES.CONTENT_DRAG_ELEMENT:
      return okResponse(request, dragElement(request.payload));
    case MESSAGE_TYPES.CONTENT_INSPECT_FORM_CONTROL:
      return okResponse(request, inspectFormControl(request.payload));
    case MESSAGE_TYPES.CONTENT_SELECT_OPTION:
      return okResponse(request, applySelectOption(request.payload));
    case MESSAGE_TYPES.CONTENT_MOUSE_MOVE:
      return okResponse(request, moveMouse(request.payload));
    case MESSAGE_TYPES.CONTENT_MOUSE_CLICK:
      return okResponse(request, clickMouse(request.payload));
    case MESSAGE_TYPES.CONTENT_MOUSE_DOWN:
      return okResponse(request, mouseDown(request.payload));
    case MESSAGE_TYPES.CONTENT_MOUSE_UP:
      return okResponse(request, mouseUp(request.payload));
    case MESSAGE_TYPES.CONTENT_MOUSE_DRAG:
      return Promise.resolve(dragMouse(request.payload)).then((result) =>
        okResponse(request, result),
      );
    case MESSAGE_TYPES.CONTENT_MOUSE_WHEEL:
      return okResponse(request, wheelMouse(request.payload));
    case MESSAGE_TYPES.CONTENT_AGENT_POINTER:
      return Promise.resolve(presentAgentPointer(request.payload)).then((result) =>
        okResponse(request, result),
      );
    case MESSAGE_TYPES.CONTENT_WAIT_FOR:
      return Promise.resolve(waitFor(request.payload)).then((result) =>
        okResponse(request, result),
      );
    case MESSAGE_TYPES.CONTENT_EVALUATE:
      return okResponse(request, evaluateExpression(request.payload));
    case MESSAGE_TYPES.CONTENT_GET_STORAGE_STATE:
      return okResponse(request, getStorageState(request.payload));
    case MESSAGE_TYPES.CONTENT_CLEAN_DEBUGGER_FRAMES:
      return okResponse(request, cleanDebuggerBlockingFrames(request.payload));
    case MESSAGE_TYPES.CONTENT_APPLY_CSS_PATCH:
      return okResponse(request, applyCssPatch(request.payload));
    case MESSAGE_TYPES.CONTENT_REMOVE_CSS_PATCH:
      return okResponse(request, removeCssPatch(request.payload));
    default:
      return errorResponse(request, "UNSUPPORTED_CONTENT_MESSAGE", `Unsupported content message: ${request.type}`);
  }
}

function announceTargetPage(reason: string): void {
  sendRuntimeEvent(
    makeEvent("content", MESSAGE_TYPES.CONTENT_TARGET_AVAILABLE, {
      url: window.location.href,
      title: document.title,
      reason,
    }),
  );
}

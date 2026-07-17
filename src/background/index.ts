import {
  clearAgentPointerForCurrentTargetBestEffort,
  executeToolCall,
} from "./toolDispatcher";
import {
  clearContentFrames,
  getSelectedContentFrame,
  getSelectedContentFrameSnapshot,
  queryActiveTab,
  registerContentFrame,
  rememberTargetTab,
} from "./chromeApi";
import { requestProxyRestore } from "./debuggerAdapter";
import { stateHubBridge } from "./stateHubBridge";
import {
  clearTargetNavigationState,
  getTargetNavigationState,
} from "./targetNavigation";
import { MESSAGE_TYPES, type ExtensionMessage, type ExtensionRequest } from "../shared/messages";
import { TOOL_NAMES } from "../shared/tools";
import {
  errorResponse,
  isExtensionMessage,
  okResponse,
} from "../shared/messaging";

const keepAlivePorts = new Set<chrome.runtime.Port>();
stateHubBridge.connect();

chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
      // Older Chrome versions may not support this promise API shape.
    });
  }
});

chrome.action.onClicked.addListener((tab) => {
  void rememberAndSyncTargetTab(tab);
  if (tab.id && chrome.sidePanel?.open) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {
      // Opening can fail on restricted pages; the action title still guides the user to the panel.
    });
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError) {
      return;
    }
    void rememberAndSyncTargetTab(tab);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading") {
    clearContentFrames(tabId);
  }
  if (tab.active) {
    void rememberAndSyncTargetTab(
      tab,
      changeInfo.status === "loading",
    ).then((target) => {
      if (
        target?.id === tab.id &&
        (changeInfo.status === "loading" || changeInfo.status === "complete")
      ) {
        requestProxyRestore(tabId, `navigation.${changeInfo.status ?? "unknown"}`);
      }
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTargetNavigationState(tabId);
  clearContentFrames(tabId);
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "ai-devtools-sidepanel") {
    return;
  }

  keepAlivePorts.add(port);
  port.onDisconnect.addListener(() => {
    keepAlivePorts.delete(port);
    if (keepAlivePorts.size === 0) {
      void clearAgentPointerForCurrentTargetBestEffort();
    }
  });
  port.onMessage.addListener(() => {
    // The long-lived port keeps the MV3 service worker warm while the sidepanel is open.
  });
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isExtensionMessage(message)) {
    return false;
  }

  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => {
      const request = message as ExtensionRequest;
      sendResponse(
        errorResponse(
          request,
          "BACKGROUND_MESSAGE_FAILED",
          error instanceof Error ? error.message : "Background request failed.",
          error
        )
      );
    });

  return true;
});

async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
) {
  if (message.source === "content") {
    if (message.type === MESSAGE_TYPES.CONTENT_TARGET_AVAILABLE) {
      registerContentFrame(sender, message.payload);
    } else if (message.type === MESSAGE_TYPES.CONTENT_ELEMENT_PICKED) {
      registerContentFrame(sender, message.payload.page);
    }
    await rememberTargetTab(sender.tab);
    await syncContentEventToStateHub(message, sender);
    return {
      id: message.id,
      type: message.type,
      ok: true,
      payload: { received: true }
    };
  }

  switch (message.type) {
    case MESSAGE_TYPES.TOOL_CALL: {
      const result = await executeToolCall(message.payload.call);
      if (
        result.toolName === TOOL_NAMES.BROWSER_SET_TARGET_TAB ||
        result.toolName === TOOL_NAMES.BROWSER_SET_TARGET_FRAME
      ) {
        syncTabToStateHub(await queryActiveTab());
      }
      return okResponse(message, result);
    }
    case MESSAGE_TYPES.SIDE_PANEL_READY:
      return okResponse(message, { ready: true });
    case MESSAGE_TYPES.AGENT_POINTER_CLEAR:
      await clearAgentPointerForCurrentTargetBestEffort();
      return okResponse(message, { cleared: true });
    default:
      return errorResponse(
        message as ExtensionRequest,
        "UNSUPPORTED_BACKGROUND_MESSAGE",
        `Unsupported background message: ${message.type}`
      );
  }
}

function syncTabToStateHub(tab: chrome.tabs.Tab | undefined): void {
  const url = tab?.url ?? tab?.pendingUrl;
  if (!url || tab?.id === undefined) {
    return;
  }
  const navigation = getTargetNavigationState(tab.id, false);
  const selectedFrame = getSelectedContentFrameSnapshot(tab.id);
  stateHubBridge.sendActiveTab({
    url: selectedFrame?.url || url,
    title: selectedFrame?.title || tab?.title || "",
    targetId: String(tab.id),
    tabId: tab.id,
    windowId: tab.windowId,
    frameId: selectedFrame?.frameId ?? getSelectedContentFrame(tab.id).frameId,
    documentId: selectedFrame?.documentId,
    navigationId: navigation.navigationId,
    revision: navigation.revision,
  });
}

async function rememberAndSyncTargetTab(
  tab: chrome.tabs.Tab | undefined,
  navigationChanged = false,
): Promise<chrome.tabs.Tab | undefined> {
  await rememberTargetTab(tab);
  const target = await queryActiveTab();
  if (target?.id !== undefined) {
    getTargetNavigationState(
      target.id,
      navigationChanged && target.id === tab?.id,
    );
  }
  syncTabToStateHub(target);
  return target;
}

async function syncContentEventToStateHub(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  const target = await queryActiveTab();
  const senderTab = sender.tab;
  switch (message.type) {
    case MESSAGE_TYPES.CONTENT_TARGET_AVAILABLE:
      const targetTabId = target?.id;
      if (
        targetTabId !== undefined &&
        targetTabId === senderTab?.id &&
        getSelectedContentFrame(targetTabId).frameId === (sender.frameId ?? 0)
      ) {
        syncTabToStateHub(target);
      }
      break;
    case MESSAGE_TYPES.CONTENT_ELEMENT_PICKED:
      if (!target?.id || senderTab?.id !== target.id) {
        return;
      }
      stateHubBridge.sendElementSelected({
        activeTab: {
          url: target.url ?? target.pendingUrl ?? message.payload.page.url,
          title: target.title ?? message.payload.page.title,
          targetId: String(target.id),
          tabId: target.id,
          windowId: target.windowId,
          frameId: sender.frameId ?? 0,
          documentId: sender.documentId,
        },
        selectedElement: message.payload.element,
      });
      break;
    default:
      break;
  }
}

import type {
  BrowserNavigateInput,
  BrowserCloseResult,
  BrowserCookie,
  BrowserCookieDeleteInput,
  BrowserCookieDeleteResult,
  BrowserCookieListInput,
  BrowserCookieListResult,
  BrowserCookieSetInput,
  BrowserCookieSetResult,
  BrowserNavigationResult,
  BrowserResizeInput,
  BrowserResizeResult,
  BrowserTargetListResult,
  BrowserTargetFrame,
  BrowserTargetFrameListResult,
  BrowserTargetFrameSetInput,
  BrowserTargetFrameSetResult,
  BrowserTargetSetInput,
  BrowserTargetSetResult,
  BrowserTargetTab,
  ScreenshotCaptureResult,
  ScreenshotMimeType,
} from "../shared/dom";
import type {
  ExtensionRequest,
  ExtensionResponse,
  RequestOf,
} from "../shared/messages";
import { MESSAGE_TYPES } from "../shared/messages";
import { createMessageId, errorResponse } from "../shared/messaging";
import { transitionTargetSelection } from "./targetSelectionState";
import type { ActiveTabSnapshot } from "../shared/wsProtocol";
import { getTargetNavigationState } from "./targetNavigation";

const TARGET_TAB_STORAGE_KEY = "aiDevtools.targetTab";

export interface ContentFrameAddress {
  frameId: number;
  documentId?: string;
}

const contentFramesByTab = new Map<number, Map<number, BrowserTargetFrame>>();
const selectedContentFrameByTab = new Map<number, ContentFrameAddress>();

interface TargetTabStorageState {
  tabId?: number;
  selection?: "auto" | "manual";
  updatedAt?: string;
}

let lastTargetTabId: number | undefined;
let targetTabSelection: "auto" | "manual" = "auto";
let targetTabStateLoaded = false;
let targetTabStateLoadPromise: Promise<void> | undefined;
let targetTabStateGeneration = 0;
let targetTabStateWriteTail: Promise<void> = Promise.resolve();

export async function rememberTargetTab(
  tab: chrome.tabs.Tab | undefined,
): Promise<void> {
  await loadTargetTabState();
  if (!isUsableBrowserTarget(tab)) {
    return;
  }
  if (targetTabSelection === "manual" && tab.id !== lastTargetTabId) {
    return;
  }
  await commitTargetTabState(tab.id, targetTabSelection);
}

export async function queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  await loadTargetTabState();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const generation = targetTabStateGeneration;
    const selectedTabId = lastTargetTabId;
    const selection = targetTabSelection;
    const lastTargetTab =
      selectedTabId === undefined ? undefined : await getTab(selectedTabId);

    if (generation !== targetTabStateGeneration) {
      continue;
    }
    if (selection === "manual") {
      if (isUsableBrowserTarget(lastTargetTab)) {
        return lastTargetTab;
      }
      await commitTargetTabState(undefined, "auto", generation);
      continue;
    }

    const [
      activeCurrentWindowTabs,
      activeLastFocusedTabs,
      activeTabs,
      allTabs,
    ] = await Promise.all([
      queryTabs({ active: true, currentWindow: true }),
      queryTabs({ active: true, lastFocusedWindow: true }),
      queryTabs({ active: true }),
      queryTabs({}),
    ]);
    if (
      generation !== targetTabStateGeneration ||
      targetTabSelection !== "auto"
    ) {
      continue;
    }

    const recentScriptableTabs = sortTabsByLikelyTarget(
      allTabs.filter(isUsableBrowserTarget),
    );
    const candidates = [
      ...activeCurrentWindowTabs,
      ...activeLastFocusedTabs,
      lastTargetTab,
      ...activeTabs,
      ...recentScriptableTabs,
    ];
    const target = candidates.find(isUsableBrowserTarget);

    if (target) {
      const committedGeneration = await commitTargetTabState(
        target.id,
        "auto",
        generation,
      );
      if (
        committedGeneration === targetTabStateGeneration &&
        targetTabSelection === "auto" &&
        lastTargetTabId === target.id
      ) {
        return target;
      }
      continue;
    }

    const blockedTab = candidates.find((tab) => tab?.id !== undefined);
    if (blockedTab && (blockedTab.url || getPendingUrl(blockedTab))) {
      throw new Error(
        `当前活动页是受限页面 (${describeTabUrl(blockedTab)}); CDP 请求代理只能附加到 http(s) 或 file 页面。请先切到要调试的目标页面，再启用 Fetch/代理。`,
      );
    }

    return undefined;
  }

  throw new Error(
    "Browser target changed repeatedly while resolving the active tab. Retry after the target settles.",
  );
}

export async function queryForegroundTab(): Promise<chrome.tabs.Tab | undefined> {
  const [lastFocused, currentWindow] = await Promise.all([
    queryTabs({ active: true, lastFocusedWindow: true }),
    queryTabs({ active: true, currentWindow: true }),
  ]);
  return [...lastFocused, ...currentWindow].find(isUsableBrowserTarget);
}

export async function listTargetTabs(): Promise<BrowserTargetListResult> {
  await loadTargetTabState();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const generation = targetTabStateGeneration;
    const tabs = sortTabsByLikelyTarget(
      (await queryTabs({})).filter(isUsableBrowserTarget),
    ).map(toBrowserTargetTab);
    if (generation !== targetTabStateGeneration) {
      continue;
    }
    const selectedTabId = tabs.some((tab) => tab.id === lastTargetTabId)
      ? lastTargetTabId
      : undefined;

    if (selectedTabId === undefined && targetTabSelection === "manual") {
      const committedGeneration = await commitTargetTabState(
        undefined,
        "auto",
        generation,
      );
      if (
        committedGeneration !== targetTabStateGeneration ||
        lastTargetTabId !== undefined
      ) {
        continue;
      }
    }

    return {
      selectedTabId,
      tabs,
    };
  }
  throw new Error(
    "Browser target changed repeatedly while listing tabs. Retry after the target settles.",
  );
}

export async function selectTargetTab(
  input: BrowserTargetSetInput,
): Promise<BrowserTargetSetResult> {
  const tab = await getTab(input.tabId);
  if (!isUsableBrowserTarget(tab)) {
    throw new Error(
      `不能把这个页面设为 CDP 代理目标 (${describeTabUrl(tab)}); 请选择 http(s) 或 file 页面。`,
    );
  }

  const generation = await commitTargetTabState(tab.id, "manual");
  if (
    generation !== targetTabStateGeneration ||
    targetTabSelection !== "manual" ||
    lastTargetTabId !== tab.id
  ) {
    throw new Error(
      "Browser target changed while selecting the requested tab. Refresh the tab list and retry.",
    );
  }
  selectedContentFrameByTab.set(tab.id, { frameId: 0 });
  const list = await listTargetTabs();
  const selectedTab = toBrowserTargetTab(tab);
  return {
    ...list,
    selectedTabId: tab.id,
    selectedTab,
  };
}

export async function readTargetTabSnapshot(
  tabId: number,
): Promise<ActiveTabSnapshot | undefined> {
  const tab = await getTab(tabId);
  if (!isUsableBrowserTarget(tab)) {
    return undefined;
  }
  const navigation = getTargetNavigationState(tab.id, false);
  const selectedFrame = getSelectedContentFrameSnapshot(tab.id);
  return {
    url: selectedFrame?.url || tab.url || "",
    title: selectedFrame?.title || tab.title || "",
    targetId: String(tab.id),
    tabId: tab.id,
    windowId: tab.windowId,
    frameId: selectedFrame?.frameId ?? 0,
    documentId: selectedFrame?.documentId,
    navigationId: navigation.navigationId,
    revision: navigation.revision,
  };
}

export async function withTemporaryTargetTab<T>(
  tabId: number,
  operation: () => Promise<T>,
): Promise<T> {
  await loadTargetTabState();
  const previousTabId = lastTargetTabId;
  const previousSelection = targetTabSelection;
  const target = await getTab(tabId);
  if (!isUsableBrowserTarget(target)) {
    throw new Error(
      `STALE_CONTEXT: task target Tab ${tabId} is closed or no longer scriptable.`,
    );
  }
  await commitTargetTabState(tabId, "manual");
  try {
    return await operation();
  } finally {
    const previousTarget =
      previousTabId === undefined ? undefined : await getTab(previousTabId);
    if (isUsableBrowserTarget(previousTarget)) {
      await commitTargetTabState(previousTarget.id, previousSelection);
    } else {
      await commitTargetTabState(undefined, "auto");
    }
  }
}

export async function focusBrowserTab(tabId: number): Promise<chrome.tabs.Tab> {
  const tab = await getTab(tabId);
  if (!isUsableBrowserTarget(tab)) {
    throw new Error(
      `不能返回这个页面 (${describeTabUrl(tab)}); 目标 Tab 已关闭或不再支持。`,
    );
  }
  if (tab.windowId !== undefined) {
    await updateWindow(tab.windowId, { focused: true });
  }
  return updateTab(tabId, { active: true });
}

export function registerContentFrame(
  sender: chrome.runtime.MessageSender,
  page: { url: string; title: string },
): void {
  const tabId = sender.tab?.id;
  if (tabId === undefined) {
    return;
  }
  const frameId = sender.frameId ?? 0;
  const selected = getSelectedContentFrame(tabId);
  const frame: BrowserTargetFrame = {
    tabId,
    frameId,
    documentId: sender.documentId,
    url: page.url,
    title: page.title,
    isTop: frameId === 0,
    selected:
      selected.frameId === frameId &&
      (!selected.documentId || selected.documentId === sender.documentId),
    lastSeenAt: new Date().toISOString(),
  };
  const frames = contentFramesByTab.get(tabId) ?? new Map();
  frames.set(frameId, frame);
  contentFramesByTab.set(tabId, frames);

  if (
    frameId === 0 &&
    (!selectedContentFrameByTab.has(tabId) ||
      (selected.frameId === 0 && !selected.documentId))
  ) {
    selectedContentFrameByTab.set(tabId, {
      frameId: 0,
      documentId: sender.documentId,
    });
  }
}

export function updateContentFrameLocation(
  tabId: number,
  frameId: number,
  input: {
    url: string;
    documentId?: string;
    title?: string;
  },
): void {
  const frames = contentFramesByTab.get(tabId);
  const current = frames?.get(frameId);
  if (!frames || !current) {
    return;
  }
  if (
    input.documentId &&
    current.documentId &&
    input.documentId !== current.documentId
  ) {
    return;
  }
  frames.set(frameId, {
    ...current,
    url: input.url,
    title: input.title ?? current.title,
    documentId: input.documentId ?? current.documentId,
    lastSeenAt: new Date().toISOString(),
  });
}

export function clearContentFrames(tabId: number): void {
  contentFramesByTab.delete(tabId);
  selectedContentFrameByTab.set(tabId, { frameId: 0 });
}

export function getSelectedContentFrame(tabId: number): ContentFrameAddress {
  return selectedContentFrameByTab.get(tabId) ?? { frameId: 0 };
}

export function getSelectedContentFrameSnapshot(
  tabId: number,
): BrowserTargetFrame | undefined {
  const selected = getSelectedContentFrame(tabId);
  return getContentFrameSnapshot(tabId, selected);
}

export function getContentFrameSnapshot(
  tabId: number,
  address: ContentFrameAddress,
): BrowserTargetFrame | undefined {
  const frame = contentFramesByTab.get(tabId)?.get(address.frameId);
  if (!frame) {
    return undefined;
  }
  if (address.documentId && frame.documentId !== address.documentId) {
    return undefined;
  }
  const selected = getSelectedContentFrame(tabId);
  return {
    ...frame,
    selected:
      selected.frameId === frame.frameId &&
      (!selected.documentId || selected.documentId === frame.documentId),
  };
}

export function listRegisteredContentFrames(tabId: number): BrowserTargetFrame[] {
  const selected = getSelectedContentFrame(tabId);
  return [...(contentFramesByTab.get(tabId)?.values() ?? [])]
    .map((frame) => ({
      ...frame,
      selected:
        frame.frameId === selected.frameId &&
        (!selected.documentId || frame.documentId === selected.documentId),
    }))
    .sort((left, right) => {
      if (left.selected !== right.selected) return left.selected ? -1 : 1;
      if (left.isTop !== right.isTop) return left.isTop ? -1 : 1;
      return left.frameId - right.frameId;
    });
}

export async function waitForRegisteredContentFrames(
  tabId: number,
  options: {
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {},
): Promise<BrowserTargetFrame[]> {
  const timeoutMs = Math.min(5_000, Math.max(0, options.timeoutMs ?? 750));
  const pollIntervalMs = Math.min(
    250,
    Math.max(10, options.pollIntervalMs ?? 25),
  );
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const frames = listRegisteredContentFrames(tabId);
    if (frames.length > 0 || Date.now() >= deadline) {
      return frames;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, Math.min(pollIntervalMs, deadline - Date.now()));
    });
  }
}

export async function listTargetFrames(): Promise<BrowserTargetFrameListResult> {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    throw new Error("No active tab is available.");
  }
  const selected = getSelectedContentFrame(tab.id);
  const frames = listRegisteredContentFrames(tab.id).sort(
    (a, b) => a.frameId - b.frameId,
  );
  return {
    tabId: tab.id,
    selectedFrameId: selected.frameId,
    selectedDocumentId: selected.documentId,
    frames,
  };
}

export async function selectTargetFrame(
  input: BrowserTargetFrameSetInput,
): Promise<BrowserTargetFrameSetResult> {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    throw new Error("No active tab is available.");
  }
  const frame = selectRegisteredContentFrame(tab.id, input);
  const list = await listTargetFrames();
  return {
    ...list,
    selectedFrame: { ...frame, selected: true },
  };
}

export function selectRegisteredContentFrame(
  tabId: number,
  input: BrowserTargetFrameSetInput,
): BrowserTargetFrame {
  const frame = contentFramesByTab.get(tabId)?.get(input.frameId);
  if (!frame) {
    throw new Error(
      `Frame ${input.frameId} is not available in target tab ${tabId}. Refresh the frame list after navigation.`,
    );
  }
  if (input.documentId && frame.documentId !== input.documentId) {
    throw new Error(
      `Frame ${input.frameId} document changed. Refresh the frame list before selecting it.`,
    );
  }
  selectedContentFrameByTab.set(tabId, {
    frameId: frame.frameId,
    documentId: frame.documentId,
  });
  return frame;
}

export function sendTabRequest<T extends ExtensionRequest["type"]>(
  tabId: number,
  request: RequestOf<T>,
  frame: ContentFrameAddress = getSelectedContentFrame(tabId),
): Promise<ExtensionResponse<T>> {
  return new Promise((resolve) => {
    const options: chrome.tabs.MessageSendOptions = frame.documentId
      ? { frameId: frame.frameId, documentId: frame.documentId }
      : { frameId: frame.frameId };
    chrome.tabs.sendMessage(
      tabId,
      request,
      options,
      (response: ExtensionResponse<T> | undefined) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          resolve(
            errorResponse<T>(
              request,
              "TAB_MESSAGE_ERROR",
              lastError.message ?? "Tab message failed.",
            ),
          );
          return;
        }

        if (!response) {
          resolve(
            errorResponse<T>(
              request,
              "EMPTY_TAB_RESPONSE",
              "The content script returned no response.",
            ),
          );
          return;
        }

        resolve(response);
      },
    );
  });
}

export function injectContentScript(
  tabId: number,
  frame: ContentFrameAddress = getSelectedContentFrame(tabId),
): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId, frameIds: [frame.frameId] },
        files: ["assets/content.js"],
      },
      () => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }

        resolve();
      },
    );
  });
}

export function captureVisibleTab(): Promise<ScreenshotCaptureResult> {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab({ format: "png" }, (dataUrl) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!dataUrl) {
        reject(new Error("Screenshot capture returned no image data."));
        return;
      }

      resolve({
        capturedAt: new Date().toISOString(),
        mimeType: detectScreenshotMimeType(dataUrl),
        dataUrl,
        method: "visibleTab",
      });
    });
  });
}

export async function navigateActiveTab(
  input: BrowserNavigateInput,
): Promise<BrowserNavigationResult> {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    throw new Error("No active tab is available.");
  }

  const updatedTab = await updateTab(tab.id, { url: input.url });
  return {
    tabId: tab.id,
    url: updatedTab.url,
    title: updatedTab.title,
    action: "navigate",
  };
}

export async function goBackActiveTab(): Promise<BrowserNavigationResult> {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    throw new Error("No active tab is available.");
  }

  await goBack(tab.id);
  return {
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    action: "back",
  };
}

export async function goForwardActiveTab(): Promise<BrowserNavigationResult> {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    throw new Error("No active tab is available.");
  }

  await goForward(tab.id);
  return {
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    action: "forward",
  };
}

export async function reloadActiveTab(): Promise<BrowserNavigationResult> {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    throw new Error("No active tab is available.");
  }

  await reloadTab(tab.id);
  return {
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    action: "reload",
  };
}

export async function closeActiveTab(): Promise<BrowserCloseResult> {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    return { closed: false };
  }

  await removeTab(tab.id);
  return {
    tabId: tab.id,
    closed: true,
  };
}

export async function resizeActiveWindow(
  input: BrowserResizeInput,
): Promise<BrowserResizeResult> {
  const tab = await queryActiveTab();
  if (!tab?.windowId) {
    throw new Error("No active browser window is available.");
  }

  const windowInfo = await updateWindow(tab.windowId, {
    width: input.width,
    height: input.height,
  });

  return {
    windowId: windowInfo.id,
    width: windowInfo.width,
    height: windowInfo.height,
  };
}

export async function listCookies(
  input: BrowserCookieListInput,
): Promise<BrowserCookieListResult> {
  const url = input.url ?? (await queryActiveTab())?.url;
  const cookies = await getCookies({
    ...(url ? { url } : {}),
    ...(input.name ? { name: input.name } : {}),
    ...(input.domain ? { domain: input.domain } : {}),
  });
  return {
    url,
    total: cookies.length,
    cookies: cookies.map((cookie) =>
      toBrowserCookieSnapshot(cookie, input.includeValues),
    ),
    valuesIncluded: input.includeValues === true,
  };
}

export async function setCookie(
  input: BrowserCookieSetInput,
): Promise<BrowserCookieSetResult> {
  const url = input.url ?? (await queryActiveTab())?.url;
  if (!url) {
    throw new Error("Cookie url is required.");
  }

  const cookie = await setChromeCookie({
    url,
    name: input.name,
    value: input.value,
    domain: input.domain,
    path: input.path,
    secure: input.secure,
    httpOnly: input.httpOnly,
    sameSite: input.sameSite,
    expirationDate: input.expirationDate,
  });
  return { cookie: toBrowserCookieSnapshot(cookie, false) };
}

export async function deleteCookie(
  input: BrowserCookieDeleteInput,
): Promise<BrowserCookieDeleteResult> {
  const url = input.url ?? (await queryActiveTab())?.url;
  if (!url) {
    throw new Error("Cookie url is required.");
  }

  const details = await removeChromeCookie({
    url,
    name: input.name,
  });
  return {
    deleted: Boolean(details),
    name: input.name,
    url,
  };
}

export function downloadDataUrl(
  dataUrl: string,
  filename: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: dataUrl,
        filename,
        saveAs: false,
        conflictAction: "uniquify",
      },
      (downloadId) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        if (typeof downloadId !== "number") {
          reject(new Error("Chrome did not return a download id."));
          return;
        }
        resolve(filename);
      },
    );
  });
}

export function getDynamicRules(): Promise<
  chrome.declarativeNetRequest.Rule[]
> {
  return new Promise((resolve, reject) => {
    chrome.declarativeNetRequest.getDynamicRules((rules) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }

      resolve(rules);
    });
  });
}

export function updateDynamicRules(
  options: chrome.declarativeNetRequest.UpdateRuleOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.declarativeNetRequest.updateDynamicRules(options, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }

      resolve();
    });
  });
}

export function debuggerAttach(
  target: chrome.debugger.Debuggee,
  protocolVersion: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, protocolVersion, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        void describeDebuggerTarget(target).then((description) => {
          reject(
            new Error(
              `CDP attach failed for ${description}: ${lastError.message}`,
            ),
          );
        });
        return;
      }

      resolve();
    });
  });
}

export function debuggerGetTargets(): Promise<chrome.debugger.TargetInfo[]> {
  return new Promise((resolve, reject) => {
    chrome.debugger.getTargets((targets) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(targets);
    });
  });
}

export function getAllNavigationFrames(
  tabId: number,
): Promise<chrome.webNavigation.GetAllFrameResultDetails[]> {
  return new Promise((resolve, reject) => {
    chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(frames ?? []);
    });
  });
}

async function describeDebuggerTarget(
  target: chrome.debugger.Debuggee,
): Promise<string> {
  if (target.tabId !== undefined) {
    const tab = await getTab(target.tabId);
    return `tabId=${target.tabId}, url=${tab?.url ?? getPendingUrl(tab) ?? "unknown"}`;
  }
  if (target.extensionId) {
    return `extensionId=${target.extensionId}`;
  }
  if (target.targetId) {
    const debugTarget = (await debuggerGetTargets().catch(() => [])).find(
      (candidate) => candidate.id === target.targetId,
    );
    return `targetId=${target.targetId}, tabId=${debugTarget?.tabId ?? "unknown"}, type=${debugTarget?.type ?? "unknown"}, url=${debugTarget?.url ?? "unknown"}`;
  }
  return "unknown target";
}

export function debuggerDetach(
  target: chrome.debugger.Debuggee,
): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.detach(target, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }

      resolve();
    });
  });
}

export type DebuggerCommandTarget = chrome.debugger.Debuggee & {
  sessionId?: string;
};

export function debuggerSendCommand<TParams extends object, TResult>(
  target: DebuggerCommandTarget,
  method: string,
  params?: TParams,
): Promise<TResult> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(
      target as chrome.debugger.Debuggee,
      method,
      params ?? {},
      (result) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }

      resolve(result as TResult);
      },
    );
  });
}

export function isTabUrlScriptable(url?: string): boolean {
  return Boolean(url && /^(https?:|file:)/i.test(url));
}

function isUsableBrowserTarget(
  tab: chrome.tabs.Tab | undefined,
): tab is chrome.tabs.Tab & { id: number } {
  return Boolean(
    tab?.id !== undefined && isTabUrlScriptable(tab.url ?? getPendingUrl(tab)),
  );
}

function sortTabsByLikelyTarget(tabs: chrome.tabs.Tab[]): chrome.tabs.Tab[] {
  return [...tabs].sort((a, b) => {
    const activeDelta = Number(Boolean(b.active)) - Number(Boolean(a.active));
    if (activeDelta) {
      return activeDelta;
    }

    const focusedWindowDelta =
      Number(Boolean(b.highlighted)) - Number(Boolean(a.highlighted));
    if (focusedWindowDelta) {
      return focusedWindowDelta;
    }

    return tabLastAccessed(b) - tabLastAccessed(a);
  });
}

function tabLastAccessed(tab: chrome.tabs.Tab): number {
  return typeof tab.lastAccessed === "number" ? tab.lastAccessed : 0;
}

function getPendingUrl(tab: chrome.tabs.Tab | undefined): string | undefined {
  return (tab as (chrome.tabs.Tab & { pendingUrl?: string }) | undefined)
    ?.pendingUrl;
}

function describeTabUrl(tab: chrome.tabs.Tab | undefined): string {
  const url = tab?.url ?? getPendingUrl(tab) ?? "unknown";
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname || parsed.pathname}`;
  } catch {
    return url;
  }
}

function queryTabs(
  queryInfo: chrome.tabs.QueryInfo,
): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        resolve([]);
        return;
      }
      resolve(tabs);
    });
  });
}

export function getTab(tabId: number): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        resolve(undefined);
        return;
      }
      resolve(tab);
    });
  });
}

async function loadTargetTabState(): Promise<void> {
  if (targetTabStateLoaded) {
    return;
  }
  targetTabStateLoadPromise ??= (async () => {
    const stored = await readSessionStorage<TargetTabStorageState>(
      TARGET_TAB_STORAGE_KEY,
    );
    if (stored?.tabId !== undefined && Number.isInteger(stored.tabId)) {
      lastTargetTabId = stored.tabId;
    }
    if (stored?.selection === "manual" || stored?.selection === "auto") {
      targetTabSelection = stored.selection;
    }
    targetTabStateLoaded = true;
  })();
  await targetTabStateLoadPromise;
}

async function commitTargetTabState(
  tabId: number | undefined,
  selection: "auto" | "manual",
  expectedGeneration = targetTabStateGeneration,
): Promise<number> {
  const transition = transitionTargetSelection(
    {
      tabId: lastTargetTabId,
      selection: targetTabSelection,
      generation: targetTabStateGeneration,
    },
    { tabId, selection },
    expectedGeneration,
  );
  if (!transition.committed || !transition.changed) {
    return targetTabStateGeneration;
  }
  lastTargetTabId = transition.state.tabId;
  targetTabSelection = transition.state.selection;
  targetTabStateGeneration = transition.state.generation;
  const generation = transition.state.generation;
  const stored = {
    tabId,
    selection,
    updatedAt: new Date().toISOString(),
  } satisfies TargetTabStorageState;
  const write = targetTabStateWriteTail.then(() =>
    writeSessionStorage(TARGET_TAB_STORAGE_KEY, stored),
  );
  targetTabStateWriteTail = write.catch(() => undefined);
  await write;
  return generation;
}

function readSessionStorage<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.session.get(key, (items) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        resolve(undefined);
        return;
      }
      resolve(items[key] as T | undefined);
    });
  });
}

function writeSessionStorage(key: string, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.session.set({ [key]: value }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

export function toBrowserTargetTab(tab: chrome.tabs.Tab): BrowserTargetTab {
  return {
    id: tab.id ?? 0,
    windowId: tab.windowId,
    title: tab.title,
    url: tab.url ?? getPendingUrl(tab),
    active: tab.active,
    highlighted: tab.highlighted,
    selected: tab.id === lastTargetTabId,
    lastAccessed: tabLastAccessed(tab) || undefined,
  };
}

function detectScreenshotMimeType(dataUrl: string): ScreenshotMimeType {
  return dataUrl.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png";
}

function updateTab(
  tabId: number,
  properties: chrome.tabs.UpdateProperties,
): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, properties, (tab) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!tab) {
        reject(new Error("Chrome did not return an updated tab."));
        return;
      }
      resolve(tab);
    });
  });
}

function goBack(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.goBack(tabId, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve();
    });
  });
}

function goForward(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.goForward(tabId, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve();
    });
  });
}

function reloadTab(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.reload(tabId, {}, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve();
    });
  });
}

function removeTab(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.remove(tabId, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve();
    });
  });
}

function updateWindow(
  windowId: number,
  updateInfo: chrome.windows.UpdateInfo,
): Promise<chrome.windows.Window> {
  return new Promise((resolve, reject) => {
    chrome.windows.update(windowId, updateInfo, (windowInfo) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(windowInfo);
    });
  });
}

function getCookies(
  details: chrome.cookies.GetAllDetails,
): Promise<chrome.cookies.Cookie[]> {
  return new Promise((resolve, reject) => {
    chrome.cookies.getAll(details, (cookies) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(cookies);
    });
  });
}

function setChromeCookie(
  details: chrome.cookies.SetDetails,
): Promise<chrome.cookies.Cookie> {
  return new Promise((resolve, reject) => {
    chrome.cookies.set(details, (cookie) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      if (!cookie) {
        reject(new Error("Chrome did not return the created cookie."));
        return;
      }
      resolve(cookie);
    });
  });
}

function removeChromeCookie(
  details: chrome.cookies.CookieDetails,
): Promise<chrome.cookies.CookieDetails | null> {
  return new Promise((resolve, reject) => {
    chrome.cookies.remove(details, (removed) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }
      resolve(removed ?? null);
    });
  });
}

export function toBrowserCookieSnapshot(
  cookie: chrome.cookies.Cookie,
  includeValue = false,
): BrowserCookie {
  return {
    name: cookie.name,
    ...(includeValue ? { value: cookie.value } : {}),
    valueIncluded: includeValue,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: cookie.expirationDate,
    session: cookie.session,
  };
}

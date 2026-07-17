export interface BrowserDebuggerTargetInfo {
  id: string;
  tabId?: number;
  type: string;
  url: string;
  attached: boolean;
}

/**
 * A normal browser tab must be attached through its stable Chrome tab id.
 * Target ids returned by chrome.debugger.getTargets() are diagnostic metadata
 * and can include extension-owned or short-lived targets that must never be
 * used as the top-level debuggee.
 */
export function topLevelDebuggerTarget(tabId: number): { tabId: number } {
  return { tabId };
}

export function debuggerAttachFailureMessage(detail: string): string {
  let hint: string;
  if (
    /Cannot access a chrome-extension:\/\/ URL of different extension/i.test(
      detail,
    )
  ) {
    hint =
      "The tab contains a frame injected by another Chrome extension. Disable that extension for this site or use a clean Chrome Profile, refresh the page, and retry.";
  } else if (
    /another debugger|already attached|debugger is attached/i.test(detail)
  ) {
    hint =
      "Another debugger client is attached to this tab. Disconnect that client and retry.";
  } else {
    hint =
      "Chrome rejected the debugger attachment for the selected tab. Reload this extension and retry; if it persists, inspect the extension service-worker log.";
  }
  return `Unable to attach Chrome debugger without modifying the page. ${hint} Details: ${detail}`;
}

export function selectPageTargetInfo<T extends BrowserDebuggerTargetInfo>(
  targets: readonly T[],
  tabId: number,
  tabUrl: string | undefined,
): T | undefined {
  return targets
    .filter(
      (target) =>
        target.tabId === tabId &&
        target.type === "page" &&
        isScriptablePageUrl(target.url),
    )
    .sort((a, b) => targetInfoScore(b, tabUrl) - targetInfoScore(a, tabUrl))[0];
}

function targetInfoScore(
  target: BrowserDebuggerTargetInfo,
  tabUrl: string | undefined,
): number {
  let score = 0;
  if (target.url === tabUrl) {
    score += 10;
  }
  if (
    target.url &&
    tabUrl &&
    normalizeComparableUrl(target.url) === normalizeComparableUrl(tabUrl)
  ) {
    score += 5;
  }
  if (!target.attached) {
    score += 1;
  }
  return score;
}

function normalizeComparableUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function isScriptablePageUrl(url: string): boolean {
  return /^(https?:|file:)/i.test(url);
}

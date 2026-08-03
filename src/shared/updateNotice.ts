export interface UpdateNotice {
  version: string;
  buildId: string;
  updatedAt: string;
  source: string;
  commit?: string;
  previousCommit?: string;
  previousVersion?: string;
  needsExtensionReload: boolean;
  projectRoot?: string;
}

const ACK_STORAGE_KEY = "aiDevtools.localUpdateAck";

export async function fetchUpdateNotice(): Promise<UpdateNotice | null> {
  if (typeof chrome === "undefined" || !chrome.runtime?.getURL) {
    return null;
  }
  const url = `${chrome.runtime.getURL("update-notice.json")}?t=${Date.now()}`;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as Partial<UpdateNotice>;
    if (
      typeof data.version !== "string" ||
      typeof data.buildId !== "string" ||
      typeof data.updatedAt !== "string"
    ) {
      return null;
    }
    return {
      version: data.version,
      buildId: data.buildId,
      updatedAt: data.updatedAt,
      source: typeof data.source === "string" ? data.source : "unknown",
      commit: typeof data.commit === "string" ? data.commit : undefined,
      previousCommit:
        typeof data.previousCommit === "string"
          ? data.previousCommit
          : undefined,
      previousVersion:
        typeof data.previousVersion === "string"
          ? data.previousVersion
          : undefined,
      needsExtensionReload: Boolean(data.needsExtensionReload),
      projectRoot:
        typeof data.projectRoot === "string" ? data.projectRoot : undefined,
    };
  } catch {
    return null;
  }
}

export function getRunningExtensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "unknown";
  }
}

export function noticeAckToken(notice: UpdateNotice): string {
  return `${notice.buildId}@${notice.commit || notice.updatedAt}`;
}

export async function readUpdateAck(): Promise<string> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return "";
  }
  const result = await chrome.storage.local.get(ACK_STORAGE_KEY);
  return typeof result[ACK_STORAGE_KEY] === "string"
    ? result[ACK_STORAGE_KEY]
    : "";
}

export async function acknowledgeUpdateNotice(
  notice: UpdateNotice,
): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return;
  }
  await chrome.storage.local.set({
    [ACK_STORAGE_KEY]: noticeAckToken(notice),
  });
}

export async function shouldPromptExtensionReload(
  notice: UpdateNotice | null,
): Promise<boolean> {
  if (!notice?.needsExtensionReload) {
    return false;
  }
  const ack = await readUpdateAck();
  return ack !== noticeAckToken(notice);
}

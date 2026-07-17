const BRIDGE_TOKEN_STORAGE_KEY = "aiDevtools.bridgeToken";

type BridgeTokenListener = () => void;
const listeners = new Set<BridgeTokenListener>();
let storageListenerInstalled = false;

export async function getBridgeToken(): Promise<string> {
  const result = await chrome.storage.local.get(BRIDGE_TOKEN_STORAGE_KEY);
  const value = result[BRIDGE_TOKEN_STORAGE_KEY];
  return typeof value === "string" ? value.trim() : "";
}

export async function saveBridgeToken(token: string): Promise<void> {
  const normalized = token.trim();
  if (!normalized) {
    await chrome.storage.local.remove(BRIDGE_TOKEN_STORAGE_KEY);
    return;
  }
  await chrome.storage.local.set({
    [BRIDGE_TOKEN_STORAGE_KEY]: normalized,
  });
}

export function subscribeBridgeTokenChanges(
  listener: BridgeTokenListener,
): () => void {
  listeners.add(listener);
  installStorageListener();
  return () => listeners.delete(listener);
}

function installStorageListener(): void {
  if (storageListenerInstalled || !chrome.storage?.onChanged) {
    return;
  }
  storageListenerInstalled = true;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !(BRIDGE_TOKEN_STORAGE_KEY in changes)) {
      return;
    }
    for (const listener of listeners) {
      listener();
    }
  });
}

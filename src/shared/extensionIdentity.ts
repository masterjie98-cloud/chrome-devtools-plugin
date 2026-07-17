const INSTALLATION_ID_STORAGE_KEY = "aiDevtools.installationId";

let cachedInstallationId: string | undefined;

export async function getInstallationId(): Promise<string> {
  if (cachedInstallationId) {
    return cachedInstallationId;
  }

  const stored = await readStoredInstallationId();
  if (stored) {
    cachedInstallationId = stored;
    return stored;
  }

  const created = `chrome-${crypto.randomUUID()}`;
  await chrome.storage.local.set({
    [INSTALLATION_ID_STORAGE_KEY]: created,
  });
  cachedInstallationId = created;
  return created;
}

async function readStoredInstallationId(): Promise<string | undefined> {
  const result = await chrome.storage.local.get(INSTALLATION_ID_STORAGE_KEY);
  const value = result[INSTALLATION_ID_STORAGE_KEY];
  return typeof value === "string" && value.trim() ? value : undefined;
}

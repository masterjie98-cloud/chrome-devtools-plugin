import { validateAiProviderUrl } from "./aiEndpointPolicy";

const STORAGE_KEY_LEGACY = "ai-devtools-assistant.ai-config";
const STORAGE_KEY_PROFILES = "ai-devtools-assistant.ai-profiles-v1";
export const AI_CREDENTIALS_STORAGE_KEY = "aiDevtools.aiCredentialsV1";
export const MAX_TOOL_ROUNDS = 200;

export interface AiConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxHistory: number;
  /** Provider/model context window used for local input-budget enforcement. */
  contextWindowTokens: number;
  maxOutputTokens?: number;
  supportsVision: boolean;
  includeImageHistory: boolean;
  fastAgentMode: boolean;
  autoReadPage: boolean;
  enableTools: boolean;
  allowPseudoToolCalls: boolean;
  maxToolRounds: number;
  autoContinueAfterToolRoundLimit: boolean;
  includePageContext: boolean;
  includeDomSummary: boolean;
  includeSelectedElement: boolean;
  visibleTextLimit: number;
  domSummaryLimit: number;
  /** 若开启，会按 provider 自动注入联网搜索工具。 */
  supportsWebSearch: boolean;
  enableWebSearch: boolean;
  capabilityDetection: AiCapabilityDetection;
}

export interface AiCapabilityDetection {
  checkedAt?: string;
  visionError?: string;
  webSearchError?: string;
}

export interface AiProfile {
  id: string;
  /** Legacy display name retained for storage compatibility; new UI uses config.model. */
  name: string;
  config: AiConfig;
}

export interface AiProfilesState {
  profiles: AiProfile[];
  activeProfileId: string;
}

export interface AiModelCapabilityResult {
  supportsVision: boolean;
  supportsWebSearch: boolean;
  checkedAt: string;
  visionError?: string;
  webSearchError?: string;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  apiUrl: "https://api.openai.com/v1/chat/completions",
  apiKey: "",
  model: "gpt-4.1-mini",
  temperature: 0.2,
  maxHistory: 12,
  contextWindowTokens: 128_000,
  maxOutputTokens: undefined,
  supportsVision: false,
  includeImageHistory: false,
  fastAgentMode: true,
  autoReadPage: true,
  enableTools: true,
  allowPseudoToolCalls: false,
  maxToolRounds: 50,
  autoContinueAfterToolRoundLimit: true,
  includePageContext: true,
  includeDomSummary: true,
  includeSelectedElement: true,
  visibleTextLimit: 2200,
  domSummaryLimit: 6000,
  supportsWebSearch: false,
  enableWebSearch: false,
  capabilityDetection: {},
};

function generateProfileId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function createDefaultProfile(): AiProfile {
  return {
    id: generateProfileId(),
    name: DEFAULT_AI_CONFIG.model,
    config: { ...DEFAULT_AI_CONFIG },
  };
}

export function createDefaultProfilesState(): AiProfilesState {
  const profile = createDefaultProfile();
  return { profiles: [profile], activeProfileId: profile.id };
}

// ── Profiles state ─────────────────────────────────────────────────────────

export function loadProfilesState(): AiProfilesState {
  return stripApiKeys(loadProfilesStateWithLegacySecrets());
}

export async function loadProfilesStateSecure(): Promise<AiProfilesState> {
  if (!hasExtensionCredentialStorage()) {
    return loadProfilesState();
  }
  const legacyState = loadProfilesStateWithLegacySecrets();
  const storedCredentials = await loadStoredAiCredentials();
  const profiles = legacyState.profiles.map((profile) => ({
    ...profile,
    config: {
      ...profile.config,
      apiKey:
        storedCredentials[profile.id]?.apiKey ?? profile.config.apiKey.trim(),
    },
  }));
  const hydratedState = { ...legacyState, profiles };

  await saveStoredAiCredentials(hydratedState);
  saveProfilesState(hydratedState);
  localStorage.removeItem(STORAGE_KEY_LEGACY);
  return hydratedState;
}

function loadProfilesStateWithLegacySecrets(): AiProfilesState {
  if (typeof localStorage === "undefined") {
    return createDefaultProfilesState();
  }

  // Try new profiles format
  const raw = localStorage.getItem(STORAGE_KEY_PROFILES);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<AiProfilesState>;
      if (Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
        const profiles = parsed.profiles.map(normalizeProfile);
        const activeProfileId =
          profiles.some((p) => p.id === parsed.activeProfileId)
            ? (parsed.activeProfileId as string)
            : profiles[0]!.id;
        return { profiles, activeProfileId };
      }
    } catch {
      /* fall through to migration */
    }
  }

  // Migrate from old single-config format
  const legacyRaw = localStorage.getItem(STORAGE_KEY_LEGACY);
  if (legacyRaw) {
    try {
      const legacyConfig = normalizeAiConfig(
        JSON.parse(legacyRaw) as Partial<AiConfig>,
      );
      const profile: AiProfile = {
        id: generateProfileId(),
        name: legacyConfig.model,
        config: legacyConfig,
      };
      return { profiles: [profile], activeProfileId: profile.id };
    } catch {
      /* fall through */
    }
  }

  return createDefaultProfilesState();
}

export function saveProfilesState(state: AiProfilesState): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  const normalizedState = {
    ...state,
    profiles: state.profiles.map(normalizeProfile),
  };
  localStorage.setItem(
    STORAGE_KEY_PROFILES,
    serializeProfilesMetadata(normalizedState),
  );
}

export async function saveProfilesStateSecure(
  state: AiProfilesState,
): Promise<void> {
  if (!hasExtensionCredentialStorage()) {
    if (state.profiles.some((profile) => profile.config.apiKey.trim())) {
      throw new Error(
        "Chrome Profile credential storage is unavailable; the API key was not saved.",
      );
    }
    saveProfilesState(state);
    return;
  }
  await saveStoredAiCredentials(state);
  saveProfilesState(state);
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(STORAGE_KEY_LEGACY);
  }
}

export function serializeProfilesMetadata(state: AiProfilesState): string {
  const sanitized = stripApiKeys(state);
  const activeProfileId = sanitized.profiles.some(
    (profile) => profile.id === sanitized.activeProfileId,
  )
    ? sanitized.activeProfileId
    : sanitized.profiles[0]?.id ?? "";
  return JSON.stringify({
    profiles: sanitized.profiles,
    activeProfileId,
  });
}

export function getActiveConfig(state: AiProfilesState): AiConfig {
  const active = state.profiles.find((p) => p.id === state.activeProfileId);
  return active?.config ?? DEFAULT_AI_CONFIG;
}

export function activateAiProfile(
  state: AiProfilesState,
  profileId: string,
): AiProfilesState {
  if (
    state.activeProfileId === profileId ||
    !state.profiles.some((profile) => profile.id === profileId)
  ) {
    return state;
  }
  return { ...state, activeProfileId: profileId };
}

export function addAiModelsToState(
  state: AiProfilesState,
  modelIds: readonly string[],
  baseConfig: AiConfig = getActiveConfig(state),
): { state: AiProfilesState; addedProfileIds: string[] } {
  const apiUrl = baseConfig.apiUrl.trim();
  const existing = new Set(
    state.profiles.map(
      (profile) =>
        `${profile.config.apiUrl.trim()}\u0000${profile.config.model.trim()}`,
    ),
  );
  const addedProfiles: AiProfile[] = [];

  for (const rawModelId of modelIds) {
    const model = rawModelId.trim();
    const key = `${apiUrl}\u0000${model}`;
    if (!model || existing.has(key)) {
      continue;
    }
    existing.add(key);
    addedProfiles.push({
      id: generateProfileId(),
      name: model,
      config: {
        ...baseConfig,
        apiUrl,
        model,
        supportsVision: false,
        supportsWebSearch: false,
        includeImageHistory: false,
        enableWebSearch: false,
        capabilityDetection: {},
      },
    });
  }

  if (addedProfiles.length === 0) {
    return { state, addedProfileIds: [] };
  }
  return {
    state: {
      ...state,
      profiles: [...state.profiles, ...addedProfiles],
    },
    addedProfileIds: addedProfiles.map((profile) => profile.id),
  };
}

export function applyAiModelCapabilities(
  state: AiProfilesState,
  profileId: string,
  result: AiModelCapabilityResult,
): AiProfilesState {
  if (!state.profiles.some((profile) => profile.id === profileId)) {
    return state;
  }

  return {
    ...state,
    profiles: state.profiles.map((profile) =>
      profile.id === profileId
        ? {
            ...profile,
            config: {
              ...profile.config,
              supportsVision: result.supportsVision,
              supportsWebSearch: result.supportsWebSearch,
              includeImageHistory: result.supportsVision
                ? profile.config.includeImageHistory
                : false,
              enableWebSearch: result.supportsWebSearch,
              capabilityDetection: {
                checkedAt: result.checkedAt,
                visionError: result.visionError,
                webSearchError: result.webSearchError,
              },
            },
          }
        : profile,
    ),
  };
}

function normalizeProfile(raw: unknown): AiProfile {
  const obj = raw as Partial<AiProfile>;
  return {
    id:
      typeof obj.id === "string" && obj.id ? obj.id : generateProfileId(),
    name:
      typeof obj.name === "string" && obj.name.trim()
        ? obj.name.trim()
        : "未命名模型",
    config: normalizeAiConfig((obj.config as Partial<AiConfig>) ?? {}),
  };
}

export function isAiConfigured(config: AiConfig): boolean {
  return Boolean(
    config.model.trim() && !validateAiProviderUrl(config.apiUrl),
  );
}

interface StoredAiCredential {
  apiKey: string;
}

type StoredAiCredentials = Record<string, StoredAiCredential>;

function hasExtensionCredentialStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

async function loadStoredAiCredentials(): Promise<StoredAiCredentials> {
  if (!hasExtensionCredentialStorage()) {
    return {};
  }
  const result = await chrome.storage.local.get(AI_CREDENTIALS_STORAGE_KEY);
  const raw = result[AI_CREDENTIALS_STORAGE_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const credentials: StoredAiCredentials = {};
  for (const [profileId, value] of Object.entries(raw)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof (value as { apiKey?: unknown }).apiKey === "string"
    ) {
      const apiKey = (value as { apiKey: string }).apiKey.trim();
      if (apiKey) {
        credentials[profileId] = { apiKey };
      }
    }
  }
  return credentials;
}

async function saveStoredAiCredentials(state: AiProfilesState): Promise<void> {
  if (!hasExtensionCredentialStorage()) {
    return;
  }
  const credentials: StoredAiCredentials = {};
  for (const profile of state.profiles) {
    const apiKey = profile.config.apiKey.trim();
    if (apiKey) {
      credentials[profile.id] = { apiKey };
    }
  }
  if (Object.keys(credentials).length === 0) {
    await chrome.storage.local.remove(AI_CREDENTIALS_STORAGE_KEY);
    return;
  }
  await chrome.storage.local.set({
    [AI_CREDENTIALS_STORAGE_KEY]: credentials,
  });
}

function stripApiKeys(state: AiProfilesState): AiProfilesState {
  return {
    ...state,
    profiles: state.profiles.map((profile) => ({
      ...profile,
      config: { ...profile.config, apiKey: "" },
    })),
  };
}

function normalizeAiConfig(config: Partial<AiConfig>): AiConfig {
  return {
    ...DEFAULT_AI_CONFIG,
    ...config,
    apiUrl:
      typeof config.apiUrl === "string"
        ? config.apiUrl
        : DEFAULT_AI_CONFIG.apiUrl,
    apiKey:
      typeof config.apiKey === "string"
        ? config.apiKey
        : DEFAULT_AI_CONFIG.apiKey,
    model:
      typeof config.model === "string" ? config.model : DEFAULT_AI_CONFIG.model,
    temperature: clampNumber(
      config.temperature,
      0,
      2,
      DEFAULT_AI_CONFIG.temperature,
    ),
    maxHistory: clampInteger(
      config.maxHistory,
      0,
      40,
      DEFAULT_AI_CONFIG.maxHistory,
    ),
    contextWindowTokens: clampInteger(
      config.contextWindowTokens,
      8_192,
      2_000_000,
      DEFAULT_AI_CONFIG.contextWindowTokens,
    ),
    maxOutputTokens:
      config.maxOutputTokens === undefined || config.maxOutputTokens === null
        ? undefined
        : clampInteger(config.maxOutputTokens, 128, 32000, 2048),
    supportsVision: config.supportsVision ?? DEFAULT_AI_CONFIG.supportsVision,
    includeImageHistory:
      config.includeImageHistory ?? DEFAULT_AI_CONFIG.includeImageHistory,
    fastAgentMode:
      config.fastAgentMode ?? DEFAULT_AI_CONFIG.fastAgentMode,
    autoReadPage: config.autoReadPage ?? DEFAULT_AI_CONFIG.autoReadPage,
    enableTools: config.enableTools ?? DEFAULT_AI_CONFIG.enableTools,
    allowPseudoToolCalls:
      config.allowPseudoToolCalls ?? DEFAULT_AI_CONFIG.allowPseudoToolCalls,
    maxToolRounds: clampInteger(
      config.maxToolRounds,
      0,
      MAX_TOOL_ROUNDS,
      DEFAULT_AI_CONFIG.maxToolRounds,
    ),
    autoContinueAfterToolRoundLimit:
      config.autoContinueAfterToolRoundLimit ??
      DEFAULT_AI_CONFIG.autoContinueAfterToolRoundLimit,
    includePageContext:
      config.includePageContext ?? DEFAULT_AI_CONFIG.includePageContext,
    includeDomSummary:
      config.includeDomSummary ?? DEFAULT_AI_CONFIG.includeDomSummary,
    includeSelectedElement:
      config.includeSelectedElement ?? DEFAULT_AI_CONFIG.includeSelectedElement,
    visibleTextLimit: clampInteger(
      config.visibleTextLimit,
      0,
      8000,
      DEFAULT_AI_CONFIG.visibleTextLimit,
    ),
    domSummaryLimit: clampInteger(
      config.domSummaryLimit,
      0,
      16000,
      DEFAULT_AI_CONFIG.domSummaryLimit,
    ),
    supportsWebSearch:
      config.supportsWebSearch ?? DEFAULT_AI_CONFIG.supportsWebSearch,
    enableWebSearch: config.enableWebSearch ?? DEFAULT_AI_CONFIG.enableWebSearch,
    capabilityDetection: normalizeCapabilityDetection(
      config.capabilityDetection,
    ),
  };
}

function normalizeCapabilityDetection(
  detection: unknown,
): AiCapabilityDetection {
  if (typeof detection !== "object" || detection === null) {
    return {};
  }

  const value = detection as Partial<AiCapabilityDetection>;
  return {
    checkedAt:
      typeof value.checkedAt === "string" ? value.checkedAt : undefined,
    visionError:
      typeof value.visionError === "string" ? value.visionError : undefined,
    webSearchError:
      typeof value.webSearchError === "string"
        ? value.webSearchError
        : undefined,
  };
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(max, Math.max(min, value)))
    : fallback;
}

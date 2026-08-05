import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_CREDENTIALS_STORAGE_KEY,
  addAiModelsToState,
  activateAiProfile,
  applyAiModelCapabilities,
  DEFAULT_AI_CONFIG,
  loadProfilesState,
  loadProfilesStateSecure,
  serializeProfilesMetadata,
  type AiProfilesState,
} from "../src/sidepanel/services/aiConfig";

const PROFILE_STORAGE_KEY = "ai-devtools-assistant.ai-profiles-v1";

test("profile metadata serialization never includes an API key", () => {
  const state = createState("sk-must-not-enter-local-storage");
  const serialized = serializeProfilesMetadata(state);

  assert.equal(serialized.includes("sk-must-not-enter-local-storage"), false);
  assert.equal(JSON.parse(serialized).profiles[0].config.apiKey, "");
});

test("saved model profiles can switch without mutating profile configs", () => {
  const first = createState("secret-1");
  const state: AiProfilesState = {
    ...first,
    profiles: [
      ...first.profiles,
      {
        id: "profile-2",
        name: "Second provider",
        config: {
          ...DEFAULT_AI_CONFIG,
          apiUrl: "https://second.example/v1/chat/completions",
          apiKey: "secret-2",
          model: "second-model",
        },
      },
    ],
  };
  const switched = activateAiProfile(state, "profile-2");
  assert.equal(switched.activeProfileId, "profile-2");
  assert.equal(switched.profiles[0], state.profiles[0]);
  assert.equal(switched.profiles[1], state.profiles[1]);
  assert.equal(activateAiProfile(switched, "missing"), switched);
});

test("model catalog selections create independent model entries without changing the active model", () => {
  const state = createState("secret-1");
  state.profiles[0]!.name = "existing-model";
  state.profiles[0]!.config.model = "existing-model";
  state.profiles[0]!.config.supportsVision = true;
  state.profiles[0]!.config.supportsWebSearch = true;

  const result = addAiModelsToState(state, [
    "existing-model",
    "model-a",
    "model-a",
    " model-b ",
    "",
  ]);

  assert.equal(result.state.activeProfileId, state.activeProfileId);
  assert.equal(result.addedProfileIds.length, 2);
  assert.deepEqual(
    result.state.profiles.map((profile) => profile.config.model),
    ["existing-model", "model-a", "model-b"],
  );
  for (const profile of result.state.profiles.slice(1)) {
    assert.equal(profile.config.apiUrl, state.profiles[0]!.config.apiUrl);
    assert.equal(profile.config.apiKey, "secret-1");
    assert.equal(profile.config.supportsVision, false);
    assert.equal(profile.config.supportsWebSearch, false);
    assert.deepEqual(profile.config.capabilityDetection, {});
  }
});

test("capability probing updates only the selected model", () => {
  const first = createState("secret-1");
  const second = addAiModelsToState(first, ["second-model"]).state;
  const secondId = second.profiles[1]!.id;
  const updated = applyAiModelCapabilities(second, secondId, {
    supportsVision: true,
    supportsWebSearch: false,
    checkedAt: "2026-08-05T12:00:00.000Z",
    webSearchError: "unsupported",
  });

  assert.equal(updated.profiles[0], second.profiles[0]);
  assert.equal(updated.profiles[1]!.config.supportsVision, true);
  assert.equal(updated.profiles[1]!.config.supportsWebSearch, false);
  assert.equal(updated.profiles[1]!.config.enableWebSearch, false);
  assert.deepEqual(updated.profiles[1]!.config.capabilityDetection, {
    checkedAt: "2026-08-05T12:00:00.000Z",
    visionError: undefined,
    webSearchError: "unsupported",
  });
  assert.equal(
    applyAiModelCapabilities(second, "missing", {
      supportsVision: true,
      supportsWebSearch: true,
      checkedAt: "2026-08-05T12:00:00.000Z",
    }),
    second,
  );
});

test("legacy profiles inherit fast Agent mode as the default", () => {
  const originalLocalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const localValues = new Map<string, string>();
  localValues.set(
    PROFILE_STORAGE_KEY,
    JSON.stringify({
      activeProfileId: "legacy-profile",
      profiles: [
        {
          id: "legacy-profile",
          name: "Legacy",
          config: {
            apiUrl: "https://provider.example/v1/chat/completions",
            apiKey: "",
            model: "model",
          },
        },
      ],
    }),
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: createStorage(localValues),
  });

  try {
    const loaded = loadProfilesState();
    assert.equal(loaded.profiles[0]?.config.fastAgentMode, true);
    const optedIn = {
      ...loaded,
      profiles: loaded.profiles.map((profile) => ({
        ...profile,
        config: { ...profile.config, fastAgentMode: true },
      })),
    };
    assert.equal(
      JSON.parse(serializeProfilesMetadata(optedIn)).profiles[0].config
        .fastAgentMode,
      true,
    );
  } finally {
    restoreProperty("localStorage", originalLocalStorage);
  }
});

test("secure profile loading migrates legacy localStorage keys into extension storage", async () => {
  const originalLocalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const originalChrome = Object.getOwnPropertyDescriptor(globalThis, "chrome");
  const localValues = new Map<string, string>();
  const extensionValues: Record<string, unknown> = {};
  const secret = "sk-legacy-profile-secret";
  localValues.set(PROFILE_STORAGE_KEY, JSON.stringify(createState(secret)));

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: createStorage(localValues),
  });
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: extensionValues[key] }),
          set: async (items: Record<string, unknown>) => {
            Object.assign(extensionValues, items);
          },
          remove: async (key: string) => {
            delete extensionValues[key];
          },
        },
      },
    },
  });

  try {
    const loaded = await loadProfilesStateSecure();
    assert.equal(loaded.profiles[0]?.config.apiKey, secret);
    assert.deepEqual(extensionValues[AI_CREDENTIALS_STORAGE_KEY], {
      "profile-1": { apiKey: secret },
    });
    const persistedMetadata = localValues.get(PROFILE_STORAGE_KEY) ?? "";
    assert.equal(persistedMetadata.includes(secret), false);
    assert.equal(JSON.parse(persistedMetadata).profiles[0].config.apiKey, "");
  } finally {
    restoreProperty("localStorage", originalLocalStorage);
    restoreProperty("chrome", originalChrome);
  }
});

function createState(apiKey: string): AiProfilesState {
  return {
    activeProfileId: "profile-1",
    profiles: [
      {
        id: "profile-1",
        name: "Provider",
        config: {
          ...DEFAULT_AI_CONFIG,
          apiUrl: "https://provider.example/v1/chat/completions",
          apiKey,
        },
      },
    ],
  };
}

function createStorage(values: Map<string, string>): Storage {
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function restoreProperty(
  key: "localStorage" | "chrome",
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, key, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, key);
  }
}

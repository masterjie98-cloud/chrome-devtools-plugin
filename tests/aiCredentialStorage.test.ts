import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_CREDENTIALS_STORAGE_KEY,
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

test("legacy profiles default fast Agent mode to off until the user opts in", () => {
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
    assert.equal(loaded.profiles[0]?.config.fastAgentMode, false);
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

interface MainWorldActivityHookState {
  token: string;
  restores: Array<() => void>;
  pending: Map<string, number>;
}

type ActivityHookWindow = Window & {
  __AI_DEVTOOLS_ACTIVITY_HOOK_V1__?: MainWorldActivityHookState;
};

export interface MainWorldActivityHookOptions {
  token: string;
  includeStyle: boolean;
  includeVisual: boolean;
  includeStorage: boolean;
}

/**
 * Runs in the page MAIN world through chrome.scripting.executeScript. Keep the
 * implementation self-contained because Chrome serializes only this function.
 */
export function installMainWorldActivityHooks(
  options: MainWorldActivityHookOptions,
): void {
  const activityWindow = window as ActivityHookWindow;
  const existing = activityWindow.__AI_DEVTOOLS_ACTIVITY_HOOK_V1__;
  if (existing) {
    existing.token = options.token;
    return;
  }

  const state: MainWorldActivityHookState = {
    token: options.token,
    restores: [],
    pending: new Map(),
  };
  activityWindow.__AI_DEVTOOLS_ACTIVITY_HOOK_V1__ = state;

  const dispatch = (
    kind: "storage" | "style" | "visual",
    category: string,
    action: string,
    area?: string,
  ) => {
    const key = `${kind}:${category}:${action}:${area ?? ""}`;
    if (state.pending.has(key)) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      state.pending.delete(key);
      window.dispatchEvent(
        new CustomEvent("ai-devtools:page-activity-v1", {
          detail: {
            token: state.token,
            kind,
            category,
            action,
            ...(area ? { area } : {}),
          },
        }),
      );
    }, 80);
    state.pending.set(key, timeoutId);
  };

  const patch = (
    prototype: object | undefined,
    methodName: string,
    kind: "storage" | "style" | "visual",
    category: string,
    area?: string,
  ) => {
    if (!prototype) {
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
    const original = descriptor?.value;
    if (!descriptor || typeof original !== "function") {
      return;
    }
    const wrapped = function (this: unknown, ...args: unknown[]) {
      const result = Reflect.apply(original, this, args);
      dispatch(kind, category, methodName, area);
      return result;
    };
    try {
      Object.defineProperty(prototype, methodName, {
        ...descriptor,
        value: wrapped,
      });
      state.restores.push(() => {
        const current = Object.getOwnPropertyDescriptor(prototype, methodName);
        if (current?.value === wrapped) {
          Object.defineProperty(prototype, methodName, descriptor);
        }
      });
    } catch {
      // Frozen platform prototypes remain unmodified; polling still provides
      // coarse change detection without breaking the page.
    }
  };

  if (options.includeStorage) {
    for (const method of ["setItem", "removeItem", "clear"]) {
      patch(Storage.prototype, method, "storage", "web-storage", "storage");
    }
    for (const method of ["add", "put", "delete", "clear"]) {
      patch(
        typeof IDBObjectStore === "undefined"
          ? undefined
          : IDBObjectStore.prototype,
        method,
        "storage",
        "indexeddb-records",
        "indexedDB",
      );
    }
    for (const method of ["createObjectStore", "deleteObjectStore"]) {
      patch(
        typeof IDBDatabase === "undefined" ? undefined : IDBDatabase.prototype,
        method,
        "storage",
        "indexeddb-schema",
        "indexedDB",
      );
    }
    for (const method of ["open", "deleteDatabase"]) {
      patch(
        typeof IDBFactory === "undefined" ? undefined : IDBFactory.prototype,
        method,
        "storage",
        "indexeddb-database",
        "indexedDB",
      );
    }
  }

  if (options.includeStyle) {
    for (const method of ["insertRule", "deleteRule", "replace", "replaceSync"]) {
      patch(
        typeof CSSStyleSheet === "undefined"
          ? undefined
          : CSSStyleSheet.prototype,
        method,
        "style",
        "cssom",
      );
    }
    for (const method of ["setProperty", "removeProperty"]) {
      patch(
        typeof CSSStyleDeclaration === "undefined"
          ? undefined
          : CSSStyleDeclaration.prototype,
        method,
        "style",
        "inline-or-rule-style",
      );
    }
  }

  if (options.includeVisual) {
    const twoDimensionalMethods = [
      "clearRect",
      "drawImage",
      "fill",
      "fillRect",
      "fillText",
      "putImageData",
      "stroke",
      "strokeRect",
      "strokeText",
    ];
    for (const method of twoDimensionalMethods) {
      patch(
        typeof CanvasRenderingContext2D === "undefined"
          ? undefined
          : CanvasRenderingContext2D.prototype,
        method,
        "visual",
        "canvas-2d",
      );
    }
    for (const prototype of [
      typeof WebGLRenderingContext === "undefined"
        ? undefined
        : WebGLRenderingContext.prototype,
      typeof WebGL2RenderingContext === "undefined"
        ? undefined
        : WebGL2RenderingContext.prototype,
    ]) {
      for (const method of ["clear", "drawArrays", "drawElements"]) {
        patch(prototype, method, "visual", "webgl");
      }
    }
  }
}

/** Runs in the page MAIN world. See the serialization note above. */
export function uninstallMainWorldActivityHooks(): void {
  const activityWindow = window as ActivityHookWindow;
  const state = activityWindow.__AI_DEVTOOLS_ACTIVITY_HOOK_V1__;
  if (!state) {
    return;
  }
  for (const timeoutId of state.pending.values()) {
    clearTimeout(timeoutId);
  }
  for (const restore of [...state.restores].reverse()) {
    try {
      restore();
    } catch {
      // A page may replace the same method after monitoring starts. Restore
      // only wrappers still owned by us and otherwise leave the page's value.
    }
  }
  delete activityWindow.__AI_DEVTOOLS_ACTIVITY_HOOK_V1__;
}

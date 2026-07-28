import {
  getContentFrameSnapshot,
  getSelectedContentFrame,
  getSelectedContentFrameSnapshot,
  queryActiveTab,
} from "./chromeApi";
import { resolveGeneratedSourceLocation } from "./debuggerAdapter";
import type {
  BrowserLocateSourceInput,
  BrowserLocateSourceResult,
  FrameworkComponentLocation,
  FrameworkKind,
} from "../shared/sourceLocation";

interface MainWorldFrameworkResult {
  matched: boolean;
  framework: FrameworkKind;
  components: FrameworkComponentLocation[];
  warnings: string[];
}

export async function locateElementSource(
  input: BrowserLocateSourceInput,
): Promise<BrowserLocateSourceResult> {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    throw new Error("No active tab is available.");
  }
  const selected =
    input.frameId === undefined
      ? getSelectedContentFrameSnapshot(tab.id)
      : getContentFrameSnapshot(tab.id, {
          frameId: input.frameId,
          documentId: input.documentId,
        });
  const frameId =
    input.frameId ??
    selected?.frameId ??
    getSelectedContentFrame(tab.id).frameId;
  const documentId = input.documentId ?? selected?.documentId;
  if (frameId !== 0 && !documentId) {
    throw new Error(
      "FRAME_DOCUMENT_REQUIRED: child-frame source inspection requires documentId.",
    );
  }
  if (
    input.documentId &&
    (!selected || selected.documentId !== input.documentId)
  ) {
    throw new Error(
      "STALE_FRAME: the requested frame document is no longer registered.",
    );
  }

  const target: chrome.scripting.InjectionTarget = documentId
    ? { tabId: tab.id, documentIds: [documentId] }
    : { tabId: tab.id, frameIds: [frameId] };
  const results = await chrome.scripting.executeScript({
    target,
    world: "MAIN",
    func: inspectFrameworkElementInMainWorld,
    args: [input.selector, input.maxDepth ?? 8],
  });
  const value = results[0]?.result as MainWorldFrameworkResult | undefined;
  if (!value) {
    throw new Error(
      "SOURCE_LOCATION_FAILED: MAIN-world inspection returned no result.",
    );
  }
  const sourceHint = value.components.find(
    (component) =>
      component.fileName &&
      component.lineNumber !== undefined &&
      component.columnNumber !== undefined &&
      /^(https?:|file:|webpack:|vite:)/.test(component.fileName),
  );
  const sourceMap = sourceHint
    ? await resolveGeneratedSourceLocation(
        {
          url: sourceHint.fileName!,
          lineNumber: Math.max(0, sourceHint.lineNumber! - 1),
          columnNumber: Math.max(0, sourceHint.columnNumber! - 1),
          functionName: sourceHint.name,
        },
        input.includeSourceExcerpt === true,
      )
    : undefined;
  return {
    version: "browser-source-location-v1",
    matched: value.matched,
    selector: input.selector,
    framework: value.framework,
    components: value.components.slice(0, 12),
    sourceMap,
    target: {
      tabId: tab.id,
      frameId,
      documentId,
    },
    warnings: value.warnings.slice(0, 10),
  };
}

function inspectFrameworkElementInMainWorld(
  selector: string,
  maxDepth: number,
): MainWorldFrameworkResult {
  const safeName = (value: unknown): string | undefined => {
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 200);
    }
    if (
      typeof value === "function" &&
      typeof (value as { name?: unknown }).name === "string"
    ) {
      return String((value as { name?: unknown }).name).slice(0, 200);
    }
    return undefined;
  };
  const location = (
    name: string,
    source: unknown,
  ): FrameworkComponentLocation => {
    const record =
      source && typeof source === "object"
        ? (source as Record<string, unknown>)
        : {};
    return {
      name,
      fileName:
        typeof record.fileName === "string"
          ? record.fileName.slice(0, 2_000)
          : typeof record.__file === "string"
            ? record.__file.slice(0, 2_000)
            : undefined,
      lineNumber:
        typeof record.lineNumber === "number"
          ? Math.max(0, Math.floor(record.lineNumber))
          : undefined,
      columnNumber:
        typeof record.columnNumber === "number"
          ? Math.max(0, Math.floor(record.columnNumber))
          : undefined,
    };
  };
  let element: Element | null;
  try {
    element = document.querySelector(selector);
  } catch (error) {
    return {
      matched: false,
      framework: "unknown",
      components: [],
      warnings: [
        `Invalid selector: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          500,
        ),
      ],
    };
  }
  if (!element) {
    return {
      matched: false,
      framework: "unknown",
      components: [],
      warnings: ["No element matched the selector."],
    };
  }

  const record = element as unknown as Record<string, unknown>;
  const reactKey = Object.keys(record).find(
    (key) =>
      key.startsWith("__reactFiber$") ||
      key.startsWith("__reactInternalInstance$"),
  );
  if (reactKey) {
    const components: FrameworkComponentLocation[] = [];
    let fiber = record[reactKey] as Record<string, unknown> | null;
    const seen = new Set<unknown>();
    for (
      let depth = 0;
      fiber && depth < Math.min(20, Math.max(1, maxDepth));
      depth += 1
    ) {
      if (seen.has(fiber)) {
        break;
      }
      seen.add(fiber);
      const type = fiber.type as
        | Record<string, unknown>
        | ((...args: unknown[]) => unknown)
        | string
        | undefined;
      const name =
        safeName(
          typeof type === "object" && type
            ? type.displayName ?? type.name
            : type,
        ) ??
        safeName(
          (fiber.elementType as Record<string, unknown> | undefined)
            ?.displayName,
        );
      if (name && /^[A-Z]/.test(name)) {
        components.push(
          location(name, fiber._debugSource ?? fiber._debugOwner),
        );
      }
      fiber =
        fiber.return && typeof fiber.return === "object"
          ? (fiber.return as Record<string, unknown>)
          : null;
    }
    return {
      matched: true,
      framework: "react",
      components,
      warnings:
        components.length === 0
          ? [
              "React Fiber was found, but this production build exposes no component source hints.",
            ]
          : [],
    };
  }

  let instance =
    (record.__vueParentComponent as Record<string, unknown> | undefined) ??
    (record.__vue__ as Record<string, unknown> | undefined);
  if (instance) {
    const components: FrameworkComponentLocation[] = [];
    const seen = new Set<unknown>();
    for (
      let depth = 0;
      instance && depth < Math.min(20, Math.max(1, maxDepth));
      depth += 1
    ) {
      if (seen.has(instance)) {
        break;
      }
      seen.add(instance);
      const type =
        (instance.type as Record<string, unknown> | undefined) ??
        (instance.$options as Record<string, unknown> | undefined) ??
        {};
      const name =
        safeName(type.name) ??
        safeName(type.__name) ??
        safeName(type._componentTag) ??
        "AnonymousVueComponent";
      components.push(location(name, { __file: type.__file }));
      instance =
        instance.parent && typeof instance.parent === "object"
          ? (instance.parent as Record<string, unknown>)
          : undefined;
    }
    return {
      matched: true,
      framework: "vue",
      components,
      warnings:
        components.some((component) => component.fileName)
          ? []
          : [
              "Vue component instances were found, but this production build exposes no __file hints.",
            ],
    };
  }

  return {
    matched: true,
    framework: "unknown",
    components: [],
    warnings: [
      "No supported React Fiber or Vue component instance was exposed on this element.",
    ],
  };
}

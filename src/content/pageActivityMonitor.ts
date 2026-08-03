import type { BrowserActivityEventInput } from "../shared/browserActivity";

export const PAGE_ACTIVITY_EVENT_NAME = "ai-devtools:page-activity-v1";

export interface PageActivityMonitorOptions {
  enabled: boolean;
  includeStyle?: boolean;
  includeVisual?: boolean;
  includeStorage?: boolean;
  visualSampleIntervalMs?: number;
  hookToken?: string;
}

type PageActivityEmitter = (event: BrowserActivityEventInput) => void;

let emitter: PageActivityEmitter | null = null;
let options: PageActivityMonitorOptions = { enabled: false };
let sampleTimer: ReturnType<typeof setInterval> | null = null;
let sampleInFlight = false;
let styleFingerprint: string | undefined;
let visualFingerprint: string | undefined;
let storageFingerprint: string | undefined;
let hookListenerInstalled = false;

export function configurePageActivityEmitter(next: PageActivityEmitter): void {
  emitter = next;
}

export function setPageActivityMonitoring(
  next: PageActivityMonitorOptions,
): PageActivityMonitorOptions {
  options = normalizeOptions(next);
  ensureHookListener();
  stopSampleTimer();
  resetFingerprints();
  if (options.enabled && needsSampling(options)) {
    void samplePageState(false);
    sampleTimer = setInterval(
      () => void samplePageState(true),
      options.visualSampleIntervalMs,
    );
  }
  return { ...options };
}

function normalizeOptions(
  value: PageActivityMonitorOptions,
): PageActivityMonitorOptions {
  const requestedInterval = Number(value.visualSampleIntervalMs);
  return {
    enabled: value.enabled === true,
    includeStyle: value.includeStyle === true,
    includeVisual: value.includeVisual === true,
    includeStorage: value.includeStorage === true,
    visualSampleIntervalMs: Number.isFinite(requestedInterval)
      ? Math.min(10_000, Math.max(500, Math.round(requestedInterval)))
      : 1_000,
    hookToken:
      typeof value.hookToken === "string" ? value.hookToken.slice(0, 200) : "",
  };
}

function needsSampling(value: PageActivityMonitorOptions): boolean {
  return Boolean(
    value.includeStyle || value.includeVisual || value.includeStorage,
  );
}

function stopSampleTimer(): void {
  if (sampleTimer !== null) {
    clearInterval(sampleTimer);
    sampleTimer = null;
  }
}

function resetFingerprints(): void {
  styleFingerprint = undefined;
  visualFingerprint = undefined;
  storageFingerprint = undefined;
}

async function samplePageState(emitChanges: boolean): Promise<void> {
  if (!options.enabled || sampleInFlight) {
    return;
  }
  sampleInFlight = true;
  try {
    const nextStyle =
      options.includeStyle || options.includeVisual
        ? sampleStyleFingerprint()
        : undefined;
    const nextVisual = options.includeVisual
      ? sampleVisualFingerprint(nextStyle ?? "")
      : undefined;
    const nextStorage = options.includeStorage
      ? await sampleStorageFingerprint()
      : undefined;

    if (emitChanges && nextStyle && styleFingerprint && nextStyle !== styleFingerprint) {
      emit({
        kind: "style",
        summary: {
          category: "cssom-computed-layout",
          action: "sample-changed",
          reason: "style-or-layout-fingerprint-changed",
          sampled: Math.min(80, document.querySelectorAll("*").length),
        },
      });
    }
    if (
      emitChanges &&
      nextVisual &&
      visualFingerprint &&
      nextVisual !== visualFingerprint
    ) {
      emit({
        kind: "visual",
        summary: {
          category: "rendered-page",
          action: "sample-changed",
          reason: "viewport-style-layout-or-canvas-changed",
          sampled: Math.min(4, document.querySelectorAll("canvas").length),
        },
      });
    }
    if (
      emitChanges &&
      nextStorage &&
      storageFingerprint &&
      nextStorage !== storageFingerprint
    ) {
      emit({
        kind: "storage",
        summary: {
          category: "browser-storage",
          action: "sample-changed",
          reason: "storage-keys-lengths-or-database-metadata-changed",
        },
      });
    }

    styleFingerprint = nextStyle;
    visualFingerprint = nextVisual;
    storageFingerprint = nextStorage;
  } finally {
    sampleInFlight = false;
  }
}

function sampleStyleFingerprint(): string {
  const parts: string[] = [
    String(document.styleSheets.length),
    `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}`,
  ];
  let retainedRules = 0;
  for (const sheet of Array.from(document.styleSheets).slice(0, 32)) {
    try {
      const rules = Array.from(sheet.cssRules ?? []);
      parts.push(`sheet:${rules.length}`);
      for (const rule of rules) {
        if (retainedRules >= 120) {
          break;
        }
        parts.push(rule.cssText.slice(0, 500));
        retainedRules += 1;
      }
    } catch {
      parts.push("sheet:cross-origin");
    }
  }

  for (const element of Array.from(document.querySelectorAll("*")).slice(0, 80)) {
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    parts.push(
      [
        element.tagName,
        element.id,
        element.className,
        round(rect.x),
        round(rect.y),
        round(rect.width),
        round(rect.height),
        computed.display,
        computed.visibility,
        computed.opacity,
        computed.color,
        computed.backgroundColor,
        computed.transform,
        computed.zIndex,
      ].join("|"),
    );
  }
  return hashParts(parts);
}

function sampleVisualFingerprint(styleHash: string): string {
  const parts = [
    styleHash,
    `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
    `${window.scrollX},${window.scrollY}`,
  ];
  for (const canvas of Array.from(document.querySelectorAll("canvas")).slice(0, 4)) {
    parts.push(sampleCanvas(canvas));
  }
  return hashParts(parts);
}

async function sampleStorageFingerprint(): Promise<string> {
  const parts: string[] = [];
  try {
    sampleStorageArea("localStorage", window.localStorage, parts);
  } catch {
    parts.push("localStorage:unavailable");
  }
  try {
    sampleStorageArea("sessionStorage", window.sessionStorage, parts);
  } catch {
    parts.push("sessionStorage:unavailable");
  }
  try {
    const databases = await indexedDB.databases?.();
    for (const database of databases ?? []) {
      parts.push(`idb:${database.name ?? ""}:${database.version ?? 0}`);
    }
  } catch {
    parts.push("idb:unavailable");
  }
  return hashParts(parts);
}

function sampleStorageArea(
  area: string,
  storage: Storage,
  parts: string[],
): void {
  try {
    const keys = Array.from({ length: storage.length }, (_, index) =>
      storage.key(index),
    )
      .filter((key): key is string => Boolean(key))
      .sort()
      .slice(0, 500);
    for (const key of keys) {
      const value = storage.getItem(key) ?? "";
      parts.push(`${area}:${key}:${value.length}:${hashParts([value])}`);
    }
  } catch {
    parts.push(`${area}:unavailable`);
  }
}

function sampleCanvas(canvas: HTMLCanvasElement): string {
  try {
    const scratch = document.createElement("canvas");
    scratch.width = 32;
    scratch.height = 32;
    const context = scratch.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return `canvas:${canvas.width}x${canvas.height}:unavailable`;
    }
    context.drawImage(canvas, 0, 0, scratch.width, scratch.height);
    const bytes = context.getImageData(0, 0, scratch.width, scratch.height).data;
    let hash = 2166136261;
    for (let index = 0; index < bytes.length; index += 4) {
      hash ^= bytes[index] ?? 0;
      hash = Math.imul(hash, 16777619);
      hash ^= bytes[index + 1] ?? 0;
      hash = Math.imul(hash, 16777619);
      hash ^= bytes[index + 2] ?? 0;
      hash = Math.imul(hash, 16777619);
      hash ^= bytes[index + 3] ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    return `canvas:${canvas.width}x${canvas.height}:${(hash >>> 0).toString(16)}`;
  } catch {
    return `canvas:${canvas.width}x${canvas.height}:tainted`;
  }
}

function ensureHookListener(): void {
  if (hookListenerInstalled) {
    return;
  }
  hookListenerInstalled = true;
  window.addEventListener(PAGE_ACTIVITY_EVENT_NAME, (rawEvent) => {
    if (!options.enabled) {
      return;
    }
    const detail = (rawEvent as CustomEvent<unknown>).detail;
    if (
      !isHookEvent(detail) ||
      detail.token !== options.hookToken ||
      !isPageActivityHookKindEnabled(options, detail.kind)
    ) {
      return;
    }
    emit({
      kind: detail.kind,
      summary: {
        category: detail.category,
        action: detail.action,
        area: detail.area,
        reason: "main-world-operation-observed",
      },
    });
  });
}

export function isPageActivityHookKindEnabled(
  value: PageActivityMonitorOptions,
  kind: "storage" | "style" | "visual",
): boolean {
  if (!value.enabled) {
    return false;
  }
  if (kind === "storage") {
    return value.includeStorage === true;
  }
  if (kind === "style") {
    return value.includeStyle === true;
  }
  return value.includeVisual === true;
}

function isHookEvent(value: unknown): value is {
  token: string;
  kind: "storage" | "style" | "visual";
  category: string;
  action: string;
  area?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.token === "string" &&
    ["storage", "style", "visual"].includes(String(candidate.kind)) &&
    typeof candidate.category === "string" &&
    typeof candidate.action === "string" &&
    (candidate.area === undefined || typeof candidate.area === "string")
  );
}

function emit(event: BrowserActivityEventInput): void {
  emitter?.({ ...event, observedAt: new Date().toISOString() });
}

function hashParts(parts: string[]): string {
  let hash = 2166136261;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

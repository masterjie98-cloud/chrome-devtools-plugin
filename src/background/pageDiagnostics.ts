import {
  getContentFrameSnapshot,
  getSelectedContentFrame,
  getSelectedContentFrameSnapshot,
  queryActiveTab,
} from "./chromeApi";
import type {
  BrowserCssDeclaration,
  BrowserCssExplainInput,
  BrowserCssExplainResult,
  BrowserPerformanceDiagnosticsInput,
  BrowserPerformanceDiagnosticsResult,
  BrowserRealtimeActivityInput,
} from "../shared/pageDiagnostics";

interface PageDiagnosticTarget {
  tabId: number;
  frameId: number;
  documentId?: string;
  injectionTarget: chrome.scripting.InjectionTarget;
}

interface PageRealtimeMetadata {
  serviceWorkers: {
    controlled: boolean;
    controllerUrl?: string;
    registrations: Array<{
      scope: string;
      activeUrl?: string;
      state?: string;
    }>;
  };
  indexedDb: Array<{
    name: string;
    version?: number;
    objectStores?: string[];
  }>;
  warnings: string[];
}

export async function explainElementCss(
  input: BrowserCssExplainInput,
): Promise<BrowserCssExplainResult> {
  const target = await resolvePageDiagnosticTarget(input);
  const results = await chrome.scripting.executeScript({
    target: target.injectionTarget,
    world: "MAIN",
    func: inspectElementCssInMainWorld,
    args: [
      input.selector,
      (input.properties ?? []).slice(0, 64),
      Math.min(200, Math.max(1, input.maxRules ?? 80)),
      input.includeVariables !== false,
    ],
  });
  const value = results[0]?.result as
    | Omit<BrowserCssExplainResult, "target">
    | undefined;
  if (!value) {
    throw new Error("CSS_DIAGNOSTICS_FAILED: page inspection returned no result.");
  }
  return {
    ...value,
    target: {
      tabId: target.tabId,
      frameId: target.frameId,
      documentId: target.documentId,
    },
  };
}

export async function collectPerformanceDiagnostics(
  input: BrowserPerformanceDiagnosticsInput,
): Promise<BrowserPerformanceDiagnosticsResult> {
  const target = await resolvePageDiagnosticTarget(input);
  const results = await chrome.scripting.executeScript({
    target: target.injectionTarget,
    world: "MAIN",
    func: inspectPerformanceInMainWorld,
    args: [
      Math.min(100, Math.max(1, input.resourceLimit ?? 20)),
      Math.min(100, Math.max(1, input.longTaskLimit ?? 20)),
    ],
  });
  const value = results[0]?.result as
    | Omit<BrowserPerformanceDiagnosticsResult, "target">
    | undefined;
  if (!value) {
    throw new Error(
      "PERFORMANCE_DIAGNOSTICS_FAILED: page inspection returned no result.",
    );
  }
  return {
    ...value,
    target: {
      tabId: target.tabId,
      frameId: target.frameId,
      documentId: target.documentId,
    },
  };
}

export async function collectPageRealtimeMetadata(
  input: BrowserRealtimeActivityInput,
): Promise<PageRealtimeMetadata & {
  target: {
    tabId: number;
    frameId: number;
    documentId?: string;
  };
}> {
  const target = await resolvePageDiagnosticTarget(input);
  const results = await chrome.scripting.executeScript({
    target: target.injectionTarget,
    world: "MAIN",
    func: inspectRealtimeMetadataInMainWorld,
    args: [Math.min(100, Math.max(1, input.limit ?? 30))],
  });
  const value = results[0]?.result;
  if (!value) {
    throw new Error(
      "REALTIME_DIAGNOSTICS_FAILED: page inspection returned no result.",
    );
  }
  return {
    ...(value as PageRealtimeMetadata),
    target: {
      tabId: target.tabId,
      frameId: target.frameId,
      documentId: target.documentId,
    },
  };
}

async function resolvePageDiagnosticTarget(input: {
  frameId?: number;
  documentId?: string;
}): Promise<PageDiagnosticTarget> {
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
      "FRAME_DOCUMENT_REQUIRED: child-frame diagnostics require documentId.",
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
  return {
    tabId: tab.id,
    frameId,
    documentId,
    injectionTarget: documentId
      ? { tabId: tab.id, documentIds: [documentId] }
      : { tabId: tab.id, frameIds: [frameId] },
  };
}

async function inspectElementCssInMainWorld(
  selector: string,
  requestedProperties: string[],
  maxRules: number,
  includeVariables: boolean,
): Promise<Omit<BrowserCssExplainResult, "target">> {
  const warnings: string[] = [];
  let element: Element | null = null;
  try {
    element = document.querySelector(selector);
  } catch (error) {
    warnings.push(
      `Invalid selector: ${error instanceof Error ? error.message : String(error)}`.slice(
        0,
        500,
      ),
    );
  }
  if (!element) {
    return {
      version: "browser-css-explain-v1",
      matched: false,
      selector,
      computed: {},
      variables: {},
      inlineStyle: [],
      matchedRules: [],
      sourceHints: [],
      warnings:
        warnings.length > 0 ? warnings : ["No element matched the selector."],
    };
  }

  const computedStyle = getComputedStyle(element);
  const defaultProperties = [
    "display",
    "position",
    "box-sizing",
    "width",
    "height",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "color",
    "background-color",
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "z-index",
    "opacity",
    "overflow",
  ];
  const properties = (requestedProperties.length
    ? requestedProperties
    : defaultProperties
  )
    .map((property) => property.trim())
    .filter(Boolean)
    .slice(0, 64);
  const computed = Object.fromEntries(
    properties.map((property) => [
      property,
      computedStyle.getPropertyValue(property).trim(),
    ]),
  );
  const variables: Record<string, string> = {};
  if (includeVariables) {
    for (
      let index = 0;
      index < computedStyle.length && Object.keys(variables).length < 80;
      index += 1
    ) {
      const property = computedStyle.item(index);
      if (property.startsWith("--")) {
        variables[property] = computedStyle.getPropertyValue(property).trim();
      }
    }
  }

  const toDeclarations = (
    style: CSSStyleDeclaration,
  ): BrowserCssDeclaration[] => {
    const declarations: BrowserCssDeclaration[] = [];
    for (
      let index = 0;
      index < style.length && declarations.length < 80;
      index += 1
    ) {
      const property = style.item(index);
      if (
        requestedProperties.length > 0 &&
        !requestedProperties.includes(property) &&
        !property.startsWith("--")
      ) {
        continue;
      }
      declarations.push({
        property,
        value: style.getPropertyValue(property).trim().slice(0, 2_000),
        important: style.getPropertyPriority(property) === "important",
      });
    }
    return declarations;
  };

  const matchedRules: BrowserCssExplainResult["matchedRules"] = [];
  const sourceHints = new Map<
    string,
    { url: string; sourceMapUrl?: string; originalSources?: string[] }
  >();
  const readBoundedResponseText = async (
    response: Response,
    maxBytes: number,
  ): Promise<string> => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error(`response exceeds ${maxBytes} bytes`);
    }
    if (!response.body) {
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > maxBytes) {
        throw new Error(`response exceeds ${maxBytes} bytes`);
      }
      return text;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new Error(`response exceeds ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  };
  const visitRuleList = (
    rules: CSSRuleList,
    source: string | undefined,
    media: string | undefined,
  ) => {
    for (const rule of Array.from(rules)) {
      if (matchedRules.length >= maxRules) {
        return;
      }
      if (rule instanceof CSSStyleRule) {
        let matches = false;
        try {
          matches = element?.matches(rule.selectorText) === true;
        } catch {
          continue;
        }
        if (!matches) {
          continue;
        }
        matchedRules.push({
          selector: rule.selectorText.slice(0, 1_000),
          source,
          media,
          declarations: toDeclarations(rule.style),
        });
        continue;
      }
      if (rule instanceof CSSMediaRule) {
        if (matchMedia(rule.conditionText).matches) {
          visitRuleList(
            rule.cssRules,
            source,
            [media, rule.conditionText].filter(Boolean).join(" and "),
          );
        }
        continue;
      }
      if ("cssRules" in rule) {
        const nested = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
        if (nested) {
          visitRuleList(nested, source, media);
        }
      }
    }
  };

  for (const sheet of Array.from(document.styleSheets)) {
    const source = sheet.href ?? "inline";
    const hint:
      | { url: string; sourceMapUrl?: string; originalSources?: string[] }
      | undefined = sheet.href ? { url: sheet.href } : undefined;
    try {
      visitRuleList(sheet.cssRules, source, undefined);
    } catch {
      warnings.push(
        `Stylesheet rules are not readable because of browser origin policy: ${source}`.slice(
          0,
          1_000,
        ),
      );
    }
    if (hint && sourceHints.size < 40) {
      try {
        if (new URL(sheet.href!).origin === location.origin) {
          const cssText = await readBoundedResponseText(
            await fetch(sheet.href!, {
              credentials: "same-origin",
              cache: "force-cache",
            }),
            512 * 1024,
          );
          const match =
            /\/[/*][#@]\s*sourceMappingURL\s*=\s*([^\s*]+)\s*(?:\*\/)?/i.exec(
              cssText.slice(-4_000),
            );
          if (match?.[1]) {
            hint.sourceMapUrl = new URL(match[1], sheet.href!).href;
            const sourceMapText = await readBoundedResponseText(
              await fetch(hint.sourceMapUrl, {
                credentials: "same-origin",
                cache: "force-cache",
              }),
              2 * 1024 * 1024,
            );
            const sourceMap = JSON.parse(sourceMapText) as unknown;
            if (
              sourceMap &&
              typeof sourceMap === "object" &&
              Array.isArray((sourceMap as { sources?: unknown }).sources)
            ) {
              hint.originalSources = (
                sourceMap as { sources: unknown[] }
              ).sources
                .filter((value): value is string => typeof value === "string")
                .slice(0, 80)
                .map((value) => value.slice(0, 2_000));
            }
          }
        }
      } catch (error) {
        warnings.push(
          `CSS source map lookup failed for ${sheet.href}: ${
            error instanceof Error ? error.message : String(error)
          }`.slice(0, 1_000),
        );
      }
      sourceHints.set(sheet.href!, hint);
    }
    if (matchedRules.length >= maxRules) {
      warnings.push(`Matched CSS rules were capped at ${maxRules}.`);
      break;
    }
  }

  const rect = element.getBoundingClientRect();
  const sideValues = (prefix: string, suffix = "") =>
    Object.fromEntries(
      ["top", "right", "bottom", "left"].map((side) => [
        side,
        computedStyle.getPropertyValue(`${prefix}-${side}${suffix}`).trim(),
      ]),
    );
  return {
    version: "browser-css-explain-v1",
    matched: true,
    selector,
    computed,
    variables,
    inlineStyle:
      element instanceof HTMLElement || element instanceof SVGElement
        ? toDeclarations(element.style)
        : [],
    matchedRules,
    boxModel: {
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      margin: sideValues("margin"),
      border: sideValues("border", "-width"),
      padding: sideValues("padding"),
    },
    sourceHints: Array.from(sourceHints.values()).slice(0, 40),
    warnings,
  };
}

async function inspectPerformanceInMainWorld(
  resourceLimit: number,
  longTaskLimit: number,
): Promise<Omit<BrowserPerformanceDiagnosticsResult, "target">> {
  const warnings: string[] = [];
  const round = (value: number) => Math.round(value * 100) / 100;
  const observeBuffered = async (type: string): Promise<PerformanceEntry[]> => {
    if (
      typeof PerformanceObserver !== "function" ||
      !PerformanceObserver.supportedEntryTypes.includes(type)
    ) {
      return [];
    }
    return new Promise((resolve) => {
      const entries: PerformanceEntry[] = [];
      let observer: PerformanceObserver | undefined;
      const finish = () => {
        observer?.disconnect();
        resolve(entries);
      };
      try {
        observer = new PerformanceObserver((list) => {
          entries.push(...list.getEntries());
        });
        observer.observe(
          type === "event"
            ? ({
                type,
                buffered: true,
                durationThreshold: 16,
              } as PerformanceObserverInit)
            : { type, buffered: true },
        );
        window.setTimeout(finish, 50);
      } catch {
        finish();
      }
    });
  };
  const navigation = performance.getEntriesByType(
    "navigation",
  )[0] as PerformanceNavigationTiming | undefined;
  const paints = performance
    .getEntriesByType("paint")
    .slice(0, 10)
    .map((entry) => ({ name: entry.name, startTime: round(entry.startTime) }));
  const [
    observedLcpEntries,
    observedLayoutShifts,
    observedLongTasks,
    observedInteractions,
  ] =
    await Promise.all([
      observeBuffered("largest-contentful-paint"),
      observeBuffered("layout-shift"),
      observeBuffered("longtask"),
      observeBuffered("event"),
    ]);
  const lcpEntries = observedLcpEntries as Array<
    PerformanceEntry & { size?: number; element?: Element }
  >;
  const lcp = lcpEntries.at(-1);
  const layoutShifts = (
    observedLayoutShifts as Array<
      PerformanceEntry & { value?: number; hadRecentInput?: boolean }
    >
  )
    .filter((entry) => entry.hadRecentInput !== true)
    .slice(-50)
    .map((entry) => ({
      value: round(entry.value ?? 0),
      startTime: round(entry.startTime),
      hadRecentInput: entry.hadRecentInput === true,
    }));
  const cumulativeLayoutShift = round(
    layoutShifts.reduce((total, entry) => total + entry.value, 0),
  );
  const longTasks = observedLongTasks
    .slice(-longTaskLimit)
    .map((entry) => ({
      startTime: round(entry.startTime),
      duration: round(entry.duration),
    }));
  const interactions = (
    observedInteractions as Array<
      PerformanceEntry & {
        interactionId?: number;
        target?: EventTarget | null;
      }
    >
  )
    .filter((entry) => (entry.interactionId ?? 0) > 0)
    .sort((left, right) => right.duration - left.duration)
    .slice(0, 20)
    .map((entry) => {
      const target = entry.target;
      return {
        name: entry.name.slice(0, 120),
        startTime: round(entry.startTime),
        duration: round(entry.duration),
        interactionId: entry.interactionId ?? 0,
        ...(target instanceof Element
          ? {
              target: `${target.tagName.toLowerCase()}${
                target.id ? `#${target.id}` : ""
              }`.slice(0, 500),
            }
          : {}),
      };
    });
  const resources = (
    performance.getEntriesByType("resource") as PerformanceResourceTiming[]
  )
    .map((entry) => ({
      name: entry.name.slice(0, 2_000),
      initiatorType: entry.initiatorType,
      duration: round(entry.duration),
      transferSize: entry.transferSize,
      decodedBodySize: entry.decodedBodySize,
    }))
    .sort((left, right) => right.duration - left.duration)
    .slice(0, resourceLimit);
  const firstContentfulPaint =
    paints.find((entry) => entry.name === "first-contentful-paint")?.startTime ??
    null;
  const totalBlockingTimeMs = round(
    longTasks.reduce(
      (total, entry) => total + Math.max(0, entry.duration - 50),
      0,
    ),
  );
  const summary = {
    domContentLoadedMs: navigation
      ? round(navigation.domContentLoadedEventEnd)
      : null,
    loadMs: navigation ? round(navigation.loadEventEnd) : null,
    firstContentfulPaintMs: firstContentfulPaint,
    largestContentfulPaintMs: lcp ? round(lcp.startTime) : null,
    totalBlockingTimeMs,
    cumulativeLayoutShift,
    resourceCount: performance.getEntriesByType("resource").length,
    interactionToNextPaintMs: interactions[0]?.duration ?? null,
  };
  const findings: string[] = [];
  if ((summary.largestContentfulPaintMs ?? 0) > 2_500) {
    findings.push("Largest Contentful Paint is above 2500 ms.");
  }
  if (summary.cumulativeLayoutShift > 0.1) {
    findings.push("Cumulative Layout Shift is above 0.1.");
  }
  if (summary.totalBlockingTimeMs > 200) {
    findings.push("Observed long tasks contribute more than 200 ms blocking time.");
  }
  if ((summary.interactionToNextPaintMs ?? 0) > 200) {
    findings.push("Interaction to Next Paint is above 200 ms.");
  }
  if (resources.some((resource) => resource.duration > 1_000)) {
    findings.push("At least one resource took longer than 1000 ms.");
  }
  if (!navigation) {
    warnings.push("Navigation Timing is unavailable for the selected document.");
  }
  if (longTasks.length === 0) {
    warnings.push(
      "No retained Long Task entries were available; start observation earlier for complete attribution.",
    );
  }
  return {
    version: "browser-performance-diagnostics-v1",
    capturedAt: new Date().toISOString(),
    navigation: navigation
      ? {
          type: navigation.type,
          startTime: round(navigation.startTime),
          responseStart: round(navigation.responseStart),
          responseEnd: round(navigation.responseEnd),
          domInteractive: round(navigation.domInteractive),
          domContentLoadedEventEnd: round(
            navigation.domContentLoadedEventEnd,
          ),
          loadEventEnd: round(navigation.loadEventEnd),
          transferSize: navigation.transferSize,
          decodedBodySize: navigation.decodedBodySize,
        }
      : {},
    paints,
    largestContentfulPaint: lcp
      ? {
          startTime: round(lcp.startTime),
          size: lcp.size,
          element:
            lcp.element instanceof Element
              ? `${lcp.element.tagName.toLowerCase()}${lcp.element.id ? `#${lcp.element.id}` : ""}`.slice(
                  0,
                  500,
                )
              : undefined,
        }
      : null,
    cumulativeLayoutShift,
    layoutShifts,
    longTasks,
    interactions,
    resources,
    summary,
    traceSummary: {
      longTaskCount: longTasks.length,
      longestTaskMs: round(
        longTasks.reduce(
          (longest, entry) => Math.max(longest, entry.duration),
          0,
        ),
      ),
      totalLongTaskMs: round(
        longTasks.reduce((total, entry) => total + entry.duration, 0),
      ),
      slowResourceCount: resources.filter((entry) => entry.duration > 1_000)
        .length,
      totalResourceDurationMs: round(
        resources.reduce((total, entry) => total + entry.duration, 0),
      ),
    },
    findings,
    warnings,
  };
}

async function inspectRealtimeMetadataInMainWorld(limit: number): Promise<{
  serviceWorkers: {
    controlled: boolean;
    controllerUrl?: string;
    registrations: Array<{
      scope: string;
      activeUrl?: string;
      state?: string;
    }>;
  };
  indexedDb: Array<{
    name: string;
    version?: number;
    objectStores?: string[];
  }>;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const registrations: Array<{
    scope: string;
    activeUrl?: string;
    state?: string;
  }> = [];
  if ("serviceWorker" in navigator) {
    try {
      const values = await navigator.serviceWorker.getRegistrations();
      for (const registration of values.slice(0, limit)) {
        const worker =
          registration.active ?? registration.waiting ?? registration.installing;
        registrations.push({
          scope: registration.scope.slice(0, 2_000),
          activeUrl: worker?.scriptURL.slice(0, 2_000),
          state: worker?.state,
        });
      }
    } catch (error) {
      warnings.push(
        `Service Worker metadata unavailable: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          500,
        ),
      );
    }
  }

  const indexedDb: Array<{
    name: string;
    version?: number;
    objectStores?: string[];
  }> = [];
  if ("databases" in indexedDB) {
    try {
      const databases = await indexedDB.databases();
      for (const database of databases.slice(0, limit)) {
        if (!database.name) {
          continue;
        }
        const summary: {
          name: string;
          version?: number;
          objectStores?: string[];
        } = {
          name: database.name.slice(0, 500),
          version: database.version,
        };
        const objectStores = await new Promise<string[] | undefined>((resolve) => {
          let settled = false;
          const finish = (value: string[] | undefined) => {
            if (settled) return;
            settled = true;
            resolve(value);
          };
          const timer = window.setTimeout(() => finish(undefined), 500);
          try {
            const request = indexedDB.open(database.name!);
            request.addEventListener("success", () => {
              window.clearTimeout(timer);
              const connection = request.result;
              const names = Array.from(connection.objectStoreNames)
                .slice(0, limit)
                .map((name) => name.slice(0, 500));
              connection.close();
              finish(names);
            });
            request.addEventListener("error", () => {
              window.clearTimeout(timer);
              finish(undefined);
            });
            request.addEventListener("blocked", () => {
              window.clearTimeout(timer);
              finish(undefined);
            });
          } catch {
            window.clearTimeout(timer);
            finish(undefined);
          }
        });
        if (objectStores) {
          summary.objectStores = objectStores;
        }
        indexedDb.push(summary);
      }
    } catch (error) {
      warnings.push(
        `IndexedDB metadata unavailable: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          500,
        ),
      );
    }
  } else {
    warnings.push("indexedDB.databases() is not supported by this page runtime.");
  }

  return {
    serviceWorkers: {
      controlled: Boolean(navigator.serviceWorker?.controller),
      controllerUrl: navigator.serviceWorker?.controller?.scriptURL.slice(0, 2_000),
      registrations,
    },
    indexedDb,
    warnings,
  };
}

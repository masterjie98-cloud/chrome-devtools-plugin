import type { ActiveTabSnapshot } from "./wsProtocol";
import { redactSensitiveData } from "./sensitiveData";
import { sanitizeActiveTabForMcp } from "./wsProtocol";
import { sanitizeText, sanitizeUrl } from "./sanitize";

export const BROWSER_ACTIVITY_STREAM_VERSION = "browser-activity-stream-v1";
export const BROWSER_ACTIVITY_EVENT_LIMIT = 200;

export type BrowserActivityKind =
  | "dom"
  | "network"
  | "console"
  | "navigation";

export interface BrowserActivitySourceLocation {
  url?: string;
  functionName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface BrowserActivityEvent {
  sequence: number;
  kind: BrowserActivityKind;
  observedAt: string;
  target?: ActiveTabSnapshot;
  summary: {
    message?: string;
    level?: string;
    method?: string;
    url?: string;
    resourceType?: string;
    status?: number;
    failed?: boolean;
    requestId?: string;
    initiatorType?: string;
    source?: BrowserActivitySourceLocation;
    fromRevision?: number;
    toRevision?: number;
    added?: number;
    removed?: number;
    attributes?: number;
    characterData?: number;
    reason?: string;
  };
}

export interface BrowserActivityEventInput {
  kind: BrowserActivityKind;
  observedAt?: string;
  target?: ActiveTabSnapshot;
  summary: BrowserActivityEvent["summary"];
}

export interface BrowserActivityStreamSnapshot {
  version: typeof BROWSER_ACTIVITY_STREAM_VERSION;
  sessionId: string;
  active: boolean;
  target: ActiveTabSnapshot | null;
  latestSequence: number;
  retainedFromSequence: number | null;
  retainedToSequence: number | null;
  droppedEvents: number;
  events: BrowserActivityEvent[];
  updatedAt: string;
}

export interface BrowserActivityStartInput {
  includeDom?: boolean;
  includeNetwork?: boolean;
  includeConsole?: boolean;
  preserveLog?: boolean;
  maxNetworkEntries?: number;
}

export interface BrowserActivityStatus {
  active: boolean;
  includeDom: boolean;
  includeNetwork: boolean;
  includeConsole: boolean;
  tabId?: number;
  frameId?: number;
  documentId?: string;
  networkObservationSessionId?: string;
}

export function sanitizeBrowserActivityEventInput(
  input: BrowserActivityEventInput,
): BrowserActivityEventInput {
  const summary = input.summary;
  const source = summary.source
    ? {
        url: summary.source.url
          ? sanitizeActivityUrl(summary.source.url)
          : undefined,
        functionName: summary.source.functionName
          ? sanitizeText(summary.source.functionName, 160)
          : undefined,
        lineNumber: safeNonNegativeInteger(summary.source.lineNumber),
        columnNumber: safeNonNegativeInteger(summary.source.columnNumber),
      }
    : undefined;
  return {
    kind: input.kind,
    observedAt: normalizeTimestamp(input.observedAt),
    target: input.target
      ? sanitizeActiveTabForMcp(input.target)
      : undefined,
    summary: {
      message: summary.message
        ? sanitizeText(
            String(redactSensitiveData(summary.message)),
            1_000,
          )
        : undefined,
      level: summary.level
        ? sanitizeText(summary.level, 40)
        : undefined,
      method: summary.method
        ? sanitizeText(summary.method.toUpperCase(), 20)
        : undefined,
      url: summary.url ? sanitizeActivityUrl(summary.url) : undefined,
      resourceType: summary.resourceType
        ? sanitizeText(summary.resourceType, 80)
        : undefined,
      status: safeStatus(summary.status),
      failed: summary.failed === true ? true : undefined,
      requestId: summary.requestId
        ? sanitizeText(summary.requestId, 200)
        : undefined,
      initiatorType: summary.initiatorType
        ? sanitizeText(summary.initiatorType, 80)
        : undefined,
      source,
      fromRevision: safeNonNegativeInteger(summary.fromRevision),
      toRevision: safeNonNegativeInteger(summary.toRevision),
      added: safeNonNegativeInteger(summary.added),
      removed: safeNonNegativeInteger(summary.removed),
      attributes: safeNonNegativeInteger(summary.attributes),
      characterData: safeNonNegativeInteger(summary.characterData),
      reason: summary.reason
        ? sanitizeText(summary.reason, 240)
        : undefined,
    },
  };
}

function sanitizeActivityUrl(value: string): string {
  const sanitized = sanitizeUrl(value);
  try {
    const url = new URL(sanitized);
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      url.searchParams.set(key, "[redacted]");
    }
    return sanitizeText(url.toString(), 2_000);
  } catch {
    return sanitizeText(sanitized.split("#", 1)[0] ?? "", 2_000);
  }
}

function normalizeTimestamp(value: string | undefined): string {
  if (value && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return new Date().toISOString();
}

function safeNonNegativeInteger(
  value: number | undefined,
): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : undefined;
}

function safeStatus(value: number | undefined): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 999
    ? value
    : undefined;
}

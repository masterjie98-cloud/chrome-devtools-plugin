import type { ActiveTabSnapshot } from "./wsProtocol";
import { redactSensitiveData } from "./sensitiveData";
import { sanitizeActiveTabForMcp } from "./wsProtocol";
import { sanitizeText, sanitizeUrl } from "./sanitize";

export const BROWSER_ACTIVITY_STREAM_VERSION = "browser-activity-stream-v2";

export type BrowserActivityKind =
  | "dom"
  | "network"
  | "console"
  | "navigation";

export const BROWSER_ACTIVITY_EVENT_LIMITS: Readonly<
  Record<BrowserActivityKind, number>
> = Object.freeze({
  dom: 1_000,
  network: 2_000,
  console: 500,
  navigation: 500,
});

export const BROWSER_ACTIVITY_EVENT_LIMIT = Object.values(
  BROWSER_ACTIVITY_EVENT_LIMITS,
).reduce((total, limit) => total + limit, 0);

export interface BrowserActivitySourceLocation {
  url?: string;
  functionName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface BrowserActivityDomSample {
  changeType: "added" | "removed" | "attribute" | "text";
  selector?: string;
  text?: string;
}

export interface BrowserActivityCursor {
  streamId: string;
  sequence: number;
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
    domSamples?: BrowserActivityDomSample[];
    domSamplesOmitted?: number;
    transportDroppedEvents?: number;
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
  streamId: string;
  startedAt: string;
  active: boolean;
  target: ActiveTabSnapshot | null;
  latestSequence: number;
  retainedFromSequence: number | null;
  retainedToSequence: number | null;
  droppedEvents: number;
  retentionLimits: Record<BrowserActivityKind, number>;
  events: BrowserActivityEvent[];
  updatedAt: string;
}

export interface BrowserActivityDigest {
  streamId: string;
  startedAt: string;
  requestedStreamId?: string;
  requestedAfterSequence: number;
  cursorStatus: "ok" | "stream_restarted" | "events_dropped";
  nextCursor: BrowserActivityCursor;
  nextSequence: number;
  target: ActiveTabSnapshot | null;
  retainedFromSequence: number | null;
  retainedToSequence: number | null;
  droppedEvents: number;
  retentionLimits: Record<BrowserActivityKind, number>;
  missedEvents: number;
  observedEvents: number;
  counts: Record<BrowserActivityKind, number>;
  transportDroppedEvents: Record<BrowserActivityKind, number>;
  domChanges: {
    events: number;
    added: number;
    removed: number;
    attributes: number;
    characterData: number;
    samples: Array<BrowserActivityDomSample & { sequence: number }>;
    omittedSamples: number;
  };
  network: {
    requests: number;
    groups: Array<{
      method: string;
      url: string;
      resourceType?: string;
      status?: number;
      count: number;
      failedCount: number;
      latestSequence: number;
      heartbeatLike: boolean;
    }>;
    totalGroups: number;
    returnedGroups: number;
    omittedGroups: number;
    collapsedRequests: number;
  };
  notableEvents: Array<
    Pick<
      BrowserActivityEvent,
      "sequence" | "kind" | "observedAt" | "summary"
    >
  >;
  omittedNotableEvents: number;
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
  runtimeErrorCursor?: {
    streamId: string;
    sequence: number;
  };
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
      ? sanitizeActivityTarget(input.target)
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
      domSamples: Array.isArray(summary.domSamples)
        ? summary.domSamples.slice(0, 12).flatMap((sample) => {
            if (
              !sample ||
              typeof sample !== "object" ||
              !["added", "removed", "attribute", "text"].includes(
                sample.changeType,
              )
            ) {
              return [];
            }
            const selector = sample.selector
              ? sanitizeText(sample.selector, 500)
              : undefined;
            const text = sample.text
              ? sanitizeText(
                  String(redactSensitiveData(sample.text)),
                  240,
                )
              : undefined;
            return [
              {
                changeType: sample.changeType,
                ...(selector ? { selector } : {}),
                ...(text ? { text } : {}),
              } satisfies BrowserActivityDomSample,
            ];
          })
        : undefined,
      domSamplesOmitted: safeNonNegativeInteger(summary.domSamplesOmitted),
      transportDroppedEvents: safeNonNegativeInteger(
        summary.transportDroppedEvents,
      ),
      reason: summary.reason
        ? sanitizeText(summary.reason, 240)
        : undefined,
    },
  };
}

export function buildBrowserActivityDigest(
  stream: BrowserActivityStreamSnapshot,
  afterSequence = 0,
  notableLimit = 20,
  afterStreamId?: string,
): BrowserActivityDigest {
  const requestedAfterSequence =
    Number.isSafeInteger(afterSequence) && afterSequence >= 0
      ? afterSequence
      : 0;
  const limit = Math.max(1, Math.min(40, Math.trunc(notableLimit) || 20));
  const streamRestarted =
    (afterStreamId !== undefined && afterStreamId !== stream.streamId) ||
    requestedAfterSequence > stream.latestSequence;
  const effectiveAfterSequence = streamRestarted ? 0 : requestedAfterSequence;
  const events = stream.events.filter(
    (event) => event.sequence > effectiveAfterSequence,
  );
  const missedEvents = streamRestarted
    ? 0
    : Math.max(
        0,
        stream.latestSequence - effectiveAfterSequence - events.length,
      );
  const counts: Record<BrowserActivityKind, number> = {
    dom: 0,
    network: 0,
    console: 0,
    navigation: 0,
  };
  const transportDroppedEvents: Record<BrowserActivityKind, number> = {
    dom: 0,
    network: 0,
    console: 0,
    navigation: 0,
  };
  const domChanges = {
    events: 0,
    added: 0,
    removed: 0,
    attributes: 0,
    characterData: 0,
    samples: [] as Array<BrowserActivityDomSample & { sequence: number }>,
    omittedSamples: 0,
  };
  const networkGroups = new Map<
    string,
    BrowserActivityDigest["network"]["groups"][number] & { priority: number }
  >();

  for (const event of events) {
    if ((event.summary.transportDroppedEvents ?? 0) > 0) {
      transportDroppedEvents[event.kind] +=
        event.summary.transportDroppedEvents ?? 0;
      continue;
    }
    counts[event.kind] += 1;
    if (event.kind === "dom") {
      domChanges.events += 1;
      domChanges.added += event.summary.added ?? 0;
      domChanges.removed += event.summary.removed ?? 0;
      domChanges.attributes += event.summary.attributes ?? 0;
      domChanges.characterData += event.summary.characterData ?? 0;
      for (const sample of event.summary.domSamples ?? []) {
        if (domChanges.samples.length < 12) {
          domChanges.samples.push({ ...sample, sequence: event.sequence });
        } else {
          domChanges.omittedSamples += 1;
        }
      }
      domChanges.omittedSamples += event.summary.domSamplesOmitted ?? 0;
      continue;
    }
    if (event.kind !== "network") {
      continue;
    }
    const method = event.summary.method ?? "UNKNOWN";
    const url = event.summary.url ?? "unknown-url";
    const resourceType = event.summary.resourceType;
    const status = event.summary.status;
    const key = [
      method,
      url,
      resourceType ?? "",
      status ?? "pending",
    ].join("\n");
    const failed =
      event.summary.failed === true || (event.summary.status ?? 0) >= 400;
    const existing = networkGroups.get(key);
    if (existing) {
      existing.count += 1;
      existing.failedCount += failed ? 1 : 0;
      existing.latestSequence = Math.max(
        existing.latestSequence,
        event.sequence,
      );
      continue;
    }
    networkGroups.set(key, {
      method,
      url,
      resourceType,
      status,
      count: 1,
      failedCount: failed ? 1 : 0,
      latestSequence: event.sequence,
      heartbeatLike: false,
      priority: browserActivityNetworkPriority(
        method,
        resourceType,
        status,
        failed,
      ),
    });
  }

  const groups = [...networkGroups.values()]
    .map((group) => ({
      ...group,
      heartbeatLike:
        group.count >= 8 &&
        (group.method === "GET" || group.method === "HEAD") &&
        group.failedCount === 0 &&
        (group.resourceType === "XHR" || group.resourceType === "Fetch"),
    }))
    .sort((left, right) => {
      const heartbeatOrder =
        Number(left.heartbeatLike) - Number(right.heartbeatLike);
      if (heartbeatOrder !== 0) {
        return heartbeatOrder;
      }
      const priorityOrder = right.priority - left.priority;
      return priorityOrder || right.latestSequence - left.latestSequence;
    });
  const notableCandidates = events.filter(
    (event) =>
      (event.summary.transportDroppedEvents ?? 0) > 0 ||
      event.kind === "navigation" ||
      (event.kind === "console" &&
        (event.summary.level === "error" ||
          event.summary.level === "warning")),
  );
  const notableEvents = notableCandidates
    .slice(-limit)
    .map(({ sequence, kind, observedAt, summary }) => ({
      sequence,
      kind,
      observedAt,
      summary,
    }));

  return {
    streamId: stream.streamId,
    startedAt: stream.startedAt,
    ...(afterStreamId !== undefined ? { requestedStreamId: afterStreamId } : {}),
    requestedAfterSequence,
    cursorStatus: streamRestarted
      ? "stream_restarted"
      : missedEvents > 0
        ? "events_dropped"
        : "ok",
    nextCursor: {
      streamId: stream.streamId,
      sequence: stream.latestSequence,
    },
    nextSequence: stream.latestSequence,
    target: stream.target ? sanitizeActivityTarget(stream.target) : null,
    retainedFromSequence: stream.retainedFromSequence,
    retainedToSequence: stream.retainedToSequence,
    droppedEvents: stream.droppedEvents,
    retentionLimits: { ...stream.retentionLimits },
    missedEvents,
    observedEvents: events.length,
    counts,
    transportDroppedEvents,
    domChanges,
    network: {
      requests: counts.network,
      groups: groups
        .slice(0, 12)
        .map(({ priority: _priority, ...group }) => group),
      totalGroups: groups.length,
      returnedGroups: Math.min(groups.length, 12),
      omittedGroups: Math.max(0, groups.length - 12),
      collapsedRequests: groups.reduce(
        (total, group) =>
          total + (group.heartbeatLike ? group.count : 0),
        0,
      ),
    },
    notableEvents,
    omittedNotableEvents: notableCandidates.length - notableEvents.length,
  };
}

function browserActivityNetworkPriority(
  method: string,
  resourceType: string | undefined,
  status: number | undefined,
  failed: boolean,
): number {
  let priority = 0;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    priority += 8;
  }
  if (failed) {
    priority += 8;
  } else if ((status ?? 0) >= 300) {
    priority += 4;
  }
  if (resourceType === "Document") {
    priority += 6;
  } else if (resourceType === "XHR" || resourceType === "Fetch") {
    priority += 3;
  }
  return priority;
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

function sanitizeActivityTarget(
  target: ActiveTabSnapshot,
): ActiveTabSnapshot {
  const sanitized = sanitizeActiveTabForMcp(target);
  return {
    ...sanitized,
    url: sanitizeActivityUrl(sanitized.url),
  };
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

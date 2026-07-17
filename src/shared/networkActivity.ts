import type { DebuggerNetworkRequestSummary } from "./debugger";
import type { CollectionPagination } from "./collectionPagination";

const MAX_ACTIVITY_GROUPS = 12;
const HEARTBEAT_REPEAT_THRESHOLD = 3;

export interface NetworkActivityGroup {
  method: string;
  url: string;
  resourceType?: string;
  status?: number;
  count: number;
  failedCount: number;
  latestStartedAt: number;
  latestDurationMs?: number;
  heartbeatLike: boolean;
}

export interface NetworkActivityDigest {
  observedRequests: number;
  totalGroups: number;
  returnedGroups: number;
  heartbeatRequestsCollapsed: number;
  groups: NetworkActivityGroup[];
}

export function normalizeNetworkResultPagination(
  pagination: CollectionPagination,
  digestOnly: boolean,
): CollectionPagination {
  if (!digestOnly) {
    return pagination;
  }
  const { nextCursor: _nextCursor, ...digestPagination } = pagination;
  return {
    ...digestPagination,
    returnedCount: 0,
    hasMore: false,
  };
}

export function buildNetworkActivityDigest(
  requests: readonly DebuggerNetworkRequestSummary[],
  maxGroups = MAX_ACTIVITY_GROUPS,
): NetworkActivityDigest {
  const grouped = new Map<
    string,
    NetworkActivityGroup & { priority: number }
  >();

  for (const request of requests) {
    const method = request.method.toUpperCase();
    const url = toNetworkActivityUrl(request.url);
    const key = [method, url, request.resourceType ?? "", request.status ?? "pending"].join("\n");
    const failed = request.failed === true || (request.status ?? 0) >= 400;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      existing.failedCount += failed ? 1 : 0;
      if (request.startedAt >= existing.latestStartedAt) {
        existing.latestStartedAt = request.startedAt;
        existing.latestDurationMs = request.durationMs;
      }
      continue;
    }

    grouped.set(key, {
      method,
      url,
      resourceType: request.resourceType,
      status: request.status,
      count: 1,
      failedCount: failed ? 1 : 0,
      latestStartedAt: request.startedAt,
      latestDurationMs: request.durationMs,
      heartbeatLike: false,
      priority: networkActivityPriority(request),
    });
  }

  const allGroups = [...grouped.values()].map((group) => ({
    ...group,
    heartbeatLike:
      group.count >= HEARTBEAT_REPEAT_THRESHOLD &&
      (group.method === "GET" || group.method === "HEAD") &&
      group.failedCount === 0 &&
      (group.resourceType === "XHR" || group.resourceType === "Fetch"),
  }));
  allGroups.sort((left, right) => {
    const heartbeatOrder = Number(left.heartbeatLike) - Number(right.heartbeatLike);
    if (heartbeatOrder !== 0) {
      return heartbeatOrder;
    }
    const priorityOrder = right.priority - left.priority;
    return priorityOrder || right.latestStartedAt - left.latestStartedAt;
  });

  const groups = allGroups
    .slice(0, Math.max(1, Math.min(maxGroups, MAX_ACTIVITY_GROUPS)))
    .map(({ priority: _priority, ...group }) => group);
  return {
    observedRequests: requests.length,
    totalGroups: allGroups.length,
    returnedGroups: groups.length,
    heartbeatRequestsCollapsed: allGroups.reduce(
      (total, group) => total + (group.heartbeatLike ? group.count : 0),
      0,
    ),
    groups,
  };
}

function networkActivityPriority(
  request: DebuggerNetworkRequestSummary,
): number {
  const method = request.method.toUpperCase();
  let priority = 0;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    priority += 8;
  }
  if (request.failed || (request.status ?? 0) >= 400) {
    priority += 8;
  } else if ((request.status ?? 0) >= 300) {
    priority += 4;
  }
  if (request.resourceType === "Document") {
    priority += 6;
  } else if (
    request.resourceType === "XHR" ||
    request.resourceType === "Fetch"
  ) {
    priority += 3;
  }
  return priority;
}

function toNetworkActivityUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return `${url.protocol}//`;
    }
    return `${url.origin}${url.pathname}`.slice(0, 1_000);
  } catch {
    return "invalid-or-relative-url";
  }
}

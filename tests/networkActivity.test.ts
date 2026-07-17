import assert from "node:assert/strict";
import test from "node:test";
import type { DebuggerNetworkRequestSummary } from "../src/shared/debugger";
import {
  buildNetworkActivityDigest,
  normalizeNetworkResultPagination,
} from "../src/shared/networkActivity";

function request(
  overrides: Partial<DebuggerNetworkRequestSummary>,
): DebuggerNetworkRequestSummary {
  return {
    requestId: overrides.requestId ?? crypto.randomUUID(),
    url: overrides.url ?? "https://example.test/api/heartbeat?token=secret",
    method: overrides.method ?? "GET",
    resourceType: overrides.resourceType ?? "Fetch",
    status: overrides.status ?? 200,
    startedAt: overrides.startedAt ?? 1,
    ...overrides,
  };
}

test("Network activity digest collapses heartbeat noise and strips query data", () => {
  const digest = buildNetworkActivityDigest([
    request({ requestId: "heartbeat-1", startedAt: 1 }),
    request({ requestId: "heartbeat-2", startedAt: 2 }),
    request({ requestId: "heartbeat-3", startedAt: 3 }),
    request({ requestId: "heartbeat-4", startedAt: 4 }),
    request({
      requestId: "save",
      url: "https://example.test/api/services/42?authorization=secret",
      method: "PATCH",
      status: 200,
      startedAt: 5,
    }),
  ]);

  assert.equal(digest.observedRequests, 5);
  assert.equal(digest.totalGroups, 2);
  assert.equal(digest.heartbeatRequestsCollapsed, 4);
  assert.equal(digest.groups[0]?.method, "PATCH");
  assert.equal(digest.groups[0]?.url, "https://example.test/api/services/42");
  assert.doesNotMatch(JSON.stringify(digest), /secret|authorization/);
  assert.deepEqual(
    digest.groups.find((group) => group.heartbeatLike),
    {
      method: "GET",
      url: "https://example.test/api/heartbeat",
      resourceType: "Fetch",
      status: 200,
      count: 4,
      failedCount: 0,
      latestStartedAt: 4,
      latestDurationMs: undefined,
      heartbeatLike: true,
    },
  );
});

test("Network activity digest prioritizes failures and navigation over heartbeat groups", () => {
  const requests = Array.from({ length: 8 }, (_, index) =>
    request({ requestId: `heartbeat-${index}`, startedAt: index }),
  );
  requests.push(
    request({
      requestId: "navigation",
      url: "https://example.test/next?state=private",
      resourceType: "Document",
      status: 302,
      startedAt: 20,
    }),
    request({
      requestId: "failed-save",
      url: "https://example.test/api/save",
      method: "POST",
      status: 500,
      failed: true,
      startedAt: 21,
    }),
  );

  const digest = buildNetworkActivityDigest(requests, 2);
  assert.deepEqual(
    digest.groups.map((group) => [group.method, group.status]),
    [
      ["POST", 500],
      ["GET", 302],
    ],
  );
});

test("digest-only Network pagination never claims raw rows were returned", () => {
  const rawPagination = {
    version: "collection-page-v1" as const,
    kind: "network",
    fingerprint: "deadbeef",
    offset: 0,
    limit: 50,
    returnedCount: 50,
    totalCount: 75,
    hasMore: true,
    nextCursor: "cp1_network_deadbeef_75_50",
  };

  assert.deepEqual(normalizeNetworkResultPagination(rawPagination, true), {
    version: "collection-page-v1",
    kind: "network",
    fingerprint: "deadbeef",
    offset: 0,
    limit: 50,
    returnedCount: 0,
    totalCount: 75,
    hasMore: false,
  });
  assert.equal(
    normalizeNetworkResultPagination(rawPagination, false),
    rawPagination,
  );
});

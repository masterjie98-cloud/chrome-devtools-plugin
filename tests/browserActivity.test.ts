import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_ACTIVITY_EVENT_LIMIT,
  BROWSER_ACTIVITY_EVENT_LIMITS,
  buildBrowserActivityDigest,
  sanitizeBrowserActivityEventInput,
} from "../src/shared/browserActivity";
import { BrowserStateHub } from "../src/mcp/browserStateHub";

test("browser activity sanitizes URLs and sensitive console text", () => {
  const sanitized = sanitizeBrowserActivityEventInput({
    kind: "network",
    observedAt: "2026-07-27T00:00:00.000Z",
    target: {
      url: "https://example.test/page?session=target-secret#fragment",
      title: "Example",
      tabId: 42,
    },
    summary: {
      method: "get",
      url: "https://example.test/api?access_token=secret&query=value#fragment",
      message: "Authorization: Bearer highly-sensitive-token",
      source: {
        url: "https://example.test/app.js?build=private#source",
        lineNumber: 12,
        columnNumber: 4,
      },
    },
  });

  assert.equal(JSON.stringify(sanitized).includes("secret"), false);
  assert.equal(sanitized.target?.url.includes("#"), false);
  assert.match(
    sanitized.target?.url ?? "",
    /session=(?:\[REDACTED\]|%5Bredacted%5D|%5BREDACTED%5D)/,
  );
  assert.equal(JSON.stringify(sanitized).includes("highly-sensitive-token"), false);
  assert.equal(sanitized.summary.method, "GET");
  assert.equal(sanitized.summary.url?.includes("#"), false);
  assert.match(
    sanitized.summary.url ?? "",
    /access_token=(?:\[REDACTED\]|%5BREDACTED%5D|%5Bredacted%5D)/,
  );
});

test("browser activity stream is sequence ordered and capacity bounded", () => {
  let now = Date.parse("2026-07-27T00:00:00.000Z");
  const hub = new BrowserStateHub(() => now++);
  const sessionId = "activity-test";
  hub.setActivityActive(true, sessionId);

  for (
    let index = 0;
    index < BROWSER_ACTIVITY_EVENT_LIMITS.dom + 5;
    index += 1
  ) {
    hub.addBrowserActivityEvent(
      {
        kind: "dom",
        summary: { fromRevision: index, toRevision: index + 1, added: 1 },
      },
      sessionId,
    );
  }

  const stream = hub.activityStreamPayload(sessionId);
  assert.equal(stream.active, true);
  assert.match(stream.streamId, /^activity-/);
  assert.equal(stream.events.length, BROWSER_ACTIVITY_EVENT_LIMITS.dom);
  assert.equal(stream.droppedEvents, 5);
  assert.equal(
    stream.latestSequence,
    BROWSER_ACTIVITY_EVENT_LIMITS.dom + 5,
  );
  assert.equal(stream.retainedFromSequence, 6);
  assert.equal(
    stream.retainedToSequence,
    BROWSER_ACTIVITY_EVENT_LIMITS.dom + 5,
  );
  assert.equal(
    Object.values(stream.retentionLimits).reduce(
      (total, limit) => total + limit,
      0,
    ),
    BROWSER_ACTIVITY_EVENT_LIMIT,
  );
});

test("browser activity stream keeps its owning Tab and ignores other Tab events", () => {
  const hub = new BrowserStateHub();
  const sessionId = "activity-target";
  hub.setCurrentTab(
    {
      url: "https://example.test/first",
      title: "First",
      targetId: "41",
      tabId: 41,
    },
    sessionId,
  );
  hub.setActivityActive(true, sessionId);
  hub.setCurrentTab(
    {
      url: "https://example.test/second",
      title: "Second",
      targetId: "42",
      tabId: 42,
    },
    sessionId,
  );

  const ignored = hub.addBrowserActivityEvent(
    {
      kind: "dom",
      target: {
        url: "https://example.test/second",
        title: "Second",
        targetId: "42",
        tabId: 42,
      },
      summary: { added: 1 },
    },
    sessionId,
  );
  const accepted = hub.addBrowserActivityEvent(
    {
      kind: "dom",
      target: {
        url: "https://example.test/first",
        title: "First",
        targetId: "41",
        tabId: 41,
      },
      summary: { added: 1 },
    },
    sessionId,
  );

  const stream = hub.activityStreamPayload(sessionId);
  assert.equal(ignored, undefined);
  assert.equal(accepted?.sequence, 1);
  assert.equal(stream.target?.tabId, 41);
  assert.equal(stream.latestSequence, 1);
});

test("browser activity digest advances a sequence cursor and collapses noisy Network events", () => {
  const hub = new BrowserStateHub();
  const sessionId = "activity-digest";
  hub.setActivityActive(true, sessionId);
  for (let index = 0; index < 8; index += 1) {
    hub.addBrowserActivityEvent(
      {
        kind: "network",
        summary: {
          method: "GET",
          url: "https://example.test/heartbeat?token=secret",
          resourceType: "Fetch",
          status: 200,
        },
      },
      sessionId,
    );
  }
  hub.addBrowserActivityEvent(
    {
      kind: "navigation",
      summary: {
        url: "https://example.test/checkout?token=secret",
        reason: "history-state-updated",
      },
    },
    sessionId,
  );
  hub.addBrowserActivityEvent(
    {
      kind: "dom",
      summary: { added: 4, removed: 1, attributes: 2 },
    },
    sessionId,
  );

  const digest = buildBrowserActivityDigest(
    hub.activityStreamPayload(sessionId),
    0,
    5,
  );

  assert.equal(digest.nextSequence, 10);
  assert.equal(digest.nextCursor.streamId, digest.streamId);
  assert.equal(digest.cursorStatus, "ok");
  assert.equal(digest.observedEvents, 10);
  assert.equal(digest.network.requests, 8);
  assert.equal(digest.network.groups.length, 1);
  assert.equal(digest.network.groups[0]?.count, 8);
  assert.equal(digest.network.groups[0]?.heartbeatLike, true);
  assert.equal(digest.domChanges.added, 4);
  assert.equal(digest.notableEvents[0]?.kind, "navigation");
  assert.equal(JSON.stringify(digest).includes("secret"), false);
  assert.equal(
    buildBrowserActivityDigest(
      hub.activityStreamPayload(sessionId),
      digest.nextSequence,
    ).observedEvents,
    0,
  );
});

test("a handful of repeated reload requests are not classified as heartbeat traffic", () => {
  const hub = new BrowserStateHub();
  const sessionId = "activity-reload-requests";
  hub.setActivityActive(true, sessionId);
  for (let index = 0; index < 5; index += 1) {
    hub.addBrowserActivityEvent(
      {
        kind: "network",
        summary: {
          method: "GET",
          url: "https://example.test/sign/captcha",
          resourceType: "XHR",
          status: 200,
        },
      },
      sessionId,
    );
  }

  const digest = buildBrowserActivityDigest(
    hub.activityStreamPayload(sessionId),
    0,
  );

  assert.equal(digest.network.groups[0]?.count, 5);
  assert.equal(digest.network.groups[0]?.heartbeatLike, false);
  assert.equal(digest.network.collapsedRequests, 0);
});

test("browser activity digest detects restarted streams instead of returning a false empty window", () => {
  const hub = new BrowserStateHub();
  const sessionId = "activity-restart";
  hub.setActivityActive(true, sessionId);
  const oldStream = hub.activityStreamPayload(sessionId);
  hub.addBrowserActivityEvent(
    {
      kind: "dom",
      summary: {
        added: 1,
        domSamples: [
          {
            changeType: "added",
            selector: "#checkout",
            text: "Checkout",
          },
        ],
      },
    },
    sessionId,
  );
  hub.setActivityActive(true, sessionId);
  hub.addBrowserActivityEvent(
    {
      kind: "navigation",
      summary: { url: "https://example.test/new", reason: "reload" },
    },
    sessionId,
  );
  const restarted = hub.activityStreamPayload(sessionId);
  const digest = buildBrowserActivityDigest(
    restarted,
    oldStream.latestSequence,
    20,
    oldStream.streamId,
  );

  assert.notEqual(restarted.streamId, oldStream.streamId);
  assert.equal(digest.cursorStatus, "stream_restarted");
  assert.equal(digest.observedEvents, 1);
  assert.equal(digest.nextCursor.streamId, restarted.streamId);
});

test("browser activity digest reports dropped events and omitted network groups", () => {
  const hub = new BrowserStateHub();
  const sessionId = "activity-loss";
  hub.setActivityActive(true, sessionId);
  const streamId = hub.activityStreamPayload(sessionId).streamId;
  for (
    let index = 0;
    index < BROWSER_ACTIVITY_EVENT_LIMITS.network + 20;
    index += 1
  ) {
    hub.addBrowserActivityEvent(
      {
        kind: "network",
        summary: {
          method: "POST",
          url: `https://example.test/api/${index}`,
          status: index % 5 === 0 ? 500 : 200,
        },
      },
      sessionId,
    );
  }
  const digest = buildBrowserActivityDigest(
    hub.activityStreamPayload(sessionId),
    0,
    20,
    streamId,
  );

  assert.equal(digest.cursorStatus, "events_dropped");
  assert.equal(digest.missedEvents, 20);
  assert.equal(
    digest.network.totalGroups,
    BROWSER_ACTIVITY_EVENT_LIMITS.network,
  );
  assert.equal(digest.network.returnedGroups, 12);
  assert.equal(
    digest.network.omittedGroups,
    BROWSER_ACTIVITY_EVENT_LIMITS.network - 12,
  );
});

test("Network floods cannot evict retained navigation, DOM, or Console evidence", () => {
  const hub = new BrowserStateHub();
  const sessionId = "activity-kind-isolation";
  hub.setActivityActive(true, sessionId);
  hub.addBrowserActivityEvent(
    {
      kind: "navigation",
      summary: {
        url: "https://example.test/logout",
        reason: "document-request",
      },
    },
    sessionId,
  );
  hub.addBrowserActivityEvent(
    {
      kind: "dom",
      summary: { removed: 5, reason: "logout-view-unmounted" },
    },
    sessionId,
  );
  hub.addBrowserActivityEvent(
    {
      kind: "console",
      summary: { level: "warning", message: "session expired" },
    },
    sessionId,
  );
  for (
    let index = 0;
    index < BROWSER_ACTIVITY_EVENT_LIMITS.network + 50;
    index += 1
  ) {
    hub.addBrowserActivityEvent(
      {
        kind: "network",
        summary: {
          method: "GET",
          url: `https://example.test/api/noise/${index}`,
          resourceType: "Fetch",
          status: 200,
        },
      },
      sessionId,
    );
  }

  const stream = hub.activityStreamPayload(sessionId);
  assert.equal(
    stream.events.filter((event) => event.kind === "network").length,
    BROWSER_ACTIVITY_EVENT_LIMITS.network,
  );
  assert.equal(
    stream.events.some(
      (event) =>
        event.kind === "navigation" &&
        event.summary.url === "https://example.test/logout",
    ),
    true,
  );
  assert.equal(stream.events.some((event) => event.kind === "dom"), true);
  assert.equal(stream.events.some((event) => event.kind === "console"), true);

  const digest = buildBrowserActivityDigest(stream, 0, 20, stream.streamId);
  assert.equal(digest.cursorStatus, "events_dropped");
  assert.equal(digest.missedEvents, 50);
  assert.equal(
    digest.notableEvents.some(
      (event) =>
        event.kind === "navigation" &&
        event.summary.url === "https://example.test/logout",
    ),
    true,
  );
});

test("browser activity digest reports transport queue loss without counting the marker as a request", () => {
  const hub = new BrowserStateHub();
  const sessionId = "activity-transport-loss";
  const target = {
    url: "https://example.test/page",
    title: "Example",
    targetId: "9",
    tabId: 9,
  };
  hub.setCurrentTab(target, sessionId);
  hub.setActivityActive(true, sessionId, target);
  hub.addBrowserActivityEvent(
    {
      kind: "network",
      target,
      summary: {
        reason: "transport-queue-overflow",
        transportDroppedEvents: 27,
      },
    },
    sessionId,
  );
  hub.addBrowserActivityEvent(
    {
      kind: "network",
      target,
      summary: {
        method: "POST",
        url: "https://example.test/api/save",
        resourceType: "XHR",
        status: 200,
      },
    },
    sessionId,
  );

  const digest = buildBrowserActivityDigest(
    hub.activityStreamPayload(sessionId),
    0,
  );

  assert.equal(digest.transportDroppedEvents.network, 27);
  assert.equal(digest.network.requests, 1);
  assert.equal(digest.counts.network, 1);
  assert.equal(
    digest.notableEvents.some(
      (event) => event.summary.reason === "transport-queue-overflow",
    ),
    true,
  );
});

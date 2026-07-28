import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_ACTIVITY_EVENT_LIMIT,
  sanitizeBrowserActivityEventInput,
} from "../src/shared/browserActivity";
import { BrowserStateHub } from "../src/mcp/browserStateHub";

test("browser activity sanitizes URLs and sensitive console text", () => {
  const sanitized = sanitizeBrowserActivityEventInput({
    kind: "network",
    observedAt: "2026-07-27T00:00:00.000Z",
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

  for (let index = 0; index < BROWSER_ACTIVITY_EVENT_LIMIT + 5; index += 1) {
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
  assert.equal(stream.events.length, BROWSER_ACTIVITY_EVENT_LIMIT);
  assert.equal(stream.droppedEvents, 5);
  assert.equal(stream.latestSequence, BROWSER_ACTIVITY_EVENT_LIMIT + 5);
  assert.equal(stream.retainedFromSequence, 6);
  assert.equal(stream.retainedToSequence, BROWSER_ACTIVITY_EVENT_LIMIT + 5);
});

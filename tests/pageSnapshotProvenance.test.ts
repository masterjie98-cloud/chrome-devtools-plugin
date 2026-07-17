import assert from "node:assert/strict";
import test from "node:test";
import {
  clearTargetNavigationState,
  getTargetNavigationState,
} from "../src/background/targetNavigation";
import type { PageSnapshot, PageSnapshotTarget } from "../src/shared/dom";
import { attachPageSnapshotProvenance } from "../src/shared/pageSnapshotProvenance";
import { sanitizePageSnapshotForMcp } from "../src/shared/wsProtocol";

const pageSnapshot: PageSnapshot = {
  url: "https://example.test/child",
  title: "Child document",
  origin: "https://example.test",
  capturedAt: "2026-07-13T01:00:00.000Z",
  visibleText: "fixture",
  domSummary: [],
  nodeCount: 0,
  truncated: false,
};

const target: PageSnapshotTarget = {
  url: "https://stale.example/",
  title: "Stale title",
  targetId: "tab-7",
  tabId: 7,
  windowId: 2,
  frameId: 5,
  documentId: "document-child",
  navigationId: "navigation-2",
  revision: 2,
};

test("page snapshot provenance binds the exact dispatched target", () => {
  const result = attachPageSnapshotProvenance(
    pageSnapshot,
    target,
    "2026-07-13T01:00:00.010Z",
  );

  assert.equal(result.provenance?.source, "chrome-content-script");
  assert.equal(result.provenance?.observedAt, "2026-07-13T01:00:00.010Z");
  assert.equal(result.provenance?.target.tabId, 7);
  assert.equal(result.provenance?.target.frameId, 5);
  assert.equal(result.provenance?.target.documentId, "document-child");
  assert.equal(result.provenance?.target.navigationId, "navigation-2");
  assert.equal(result.provenance?.target.revision, 2);
  assert.equal(result.provenance?.target.url, pageSnapshot.url);
  assert.equal(result.provenance?.target.title, pageSnapshot.title);
});

test("page snapshot provenance is sanitized before daemon and MCP storage", () => {
  const result = sanitizePageSnapshotForMcp(
    attachPageSnapshotProvenance(
      {
        ...pageSnapshot,
        url: "https://example.test/child?access_token=secret",
      },
      {
        ...target,
        targetId: "tab\n7",
        navigationId: "navigation\n2",
      },
    ),
  );

  assert.equal(result.provenance?.target.targetId.includes("\n"), false);
  assert.equal(result.provenance?.target.navigationId.includes("\n"), false);
  assert.equal(result.provenance?.target.url.includes("secret"), false);
  assert.match(result.provenance?.target.url ?? "", /REDACTED/);
  assert.equal(result.provenance?.target.revision, 2);
});

test("target navigation revision is stable until navigation and resets on tab close", () => {
  clearTargetNavigationState(91);
  const first = getTargetNavigationState(91, false);
  assert.deepEqual(getTargetNavigationState(91, false), first);

  const navigated = getTargetNavigationState(91, true);
  assert.equal(navigated.revision, first.revision + 1);
  assert.notEqual(navigated.navigationId, first.navigationId);

  clearTargetNavigationState(91);
  assert.equal(getTargetNavigationState(91, false).revision, 0);
});

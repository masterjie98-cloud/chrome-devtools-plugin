import assert from "node:assert/strict";
import test from "node:test";
import {
  paginateSemanticSnapshot,
  type SemanticSnapshotCandidate,
} from "../src/shared/semanticSnapshot";

test("semantic snapshots provide stable refs and cursor pagination", () => {
  const candidates = [
    candidate("button", "Save", "#save"),
    candidate("textbox", "Email", "#email"),
    candidate("link", "Help", "#help"),
  ];
  const first = paginateSemanticSnapshot(
    candidates,
    { limit: 2 },
    "https://example.test/page",
    false,
  );

  assert.deepEqual(first.nodes.map((node) => node.ref), ["s1", "s2"]);
  assert.deepEqual(
    first.nodes.map((node) => node.targetRef),
    [
      `sr1_${first.fingerprint}_s1`,
      `sr1_${first.fingerprint}_s2`,
    ],
  );
  assert.equal(first.pagination.hasMore, true);
  assert.equal(first.pagination.returnedCount, 2);
  assert.equal(first.pagination.collectedCount, 3);
  assert.equal(first.pagination.totalKnown, true);
  assert.match(first.pagination.nextCursor ?? "", /^ss1_[a-f0-9]{8}_2$/);

  const second = paginateSemanticSnapshot(
    candidates,
    { cursor: first.pagination.nextCursor, limit: 2 },
    "https://example.test/page",
    false,
  );
  assert.deepEqual(second.nodes.map((node) => node.ref), ["s3"]);
  assert.equal(second.pagination.hasMore, false);
  assert.equal(second.pagination.nextCursor, undefined);
});

test("semantic snapshot cursors fail closed after a semantic page change", () => {
  const candidates = [candidate("button", "Save", "#save")];
  const first = paginateSemanticSnapshot(
    candidates,
    { limit: 1 },
    "https://example.test/page",
    false,
  );
  const cursor = `ss1_${first.fingerprint}_0`;

  assert.throws(
    () =>
      paginateSemanticSnapshot(
        [candidate("button", "Delete", "#save")],
        { cursor, limit: 1 },
        "https://example.test/page",
        false,
      ),
    /STALE_SNAPSHOT_CURSOR/,
  );
  assert.throws(
    () =>
      paginateSemanticSnapshot(
        candidates,
        { cursor: "not-a-cursor", limit: 1 },
        "https://example.test/page",
        false,
      ),
    /SNAPSHOT_CURSOR_INVALID/,
  );
});

test("semantic snapshot reports when collection stopped at its source cap", () => {
  const result = paginateSemanticSnapshot(
    [candidate("heading", "Title", "h1")],
    {},
    "https://example.test/page",
    true,
  );
  assert.equal(result.pagination.totalKnown, false);
  assert.equal(result.stats.sourceTruncated, true);
});

function candidate(
  role: string,
  name: string,
  selector: string,
): SemanticSnapshotCandidate {
  return {
    role,
    name,
    selector,
    tagName: role === "heading" ? "h1" : "div",
    bounds: { x: 0, y: 0, width: 100, height: 30 },
  };
}

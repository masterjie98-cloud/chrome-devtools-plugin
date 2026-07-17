import assert from "node:assert/strict";
import test from "node:test";
import { paginateCollection } from "../src/shared/collectionPagination";

test("collection pagination returns stable pages and bounded metadata", () => {
  const items = Array.from({ length: 5 }, (_, index) => ({ id: index + 1 }));
  const first = paginateCollection(items, { limit: 2 }, options());
  assert.deepEqual(first.items, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(
    {
      offset: first.pagination.offset,
      returnedCount: first.pagination.returnedCount,
      totalCount: first.pagination.totalCount,
      hasMore: first.pagination.hasMore,
    },
    { offset: 0, returnedCount: 2, totalCount: 5, hasMore: true },
  );
  assert.match(
    first.pagination.nextCursor ?? "",
    /^cp1_test_[a-f0-9]{8}_5_2$/,
  );

  const second = paginateCollection(
    items,
    { limit: 2, cursor: first.pagination.nextCursor },
    options(),
  );
  assert.deepEqual(second.items, [{ id: 3 }, { id: 4 }]);
  assert.equal(second.pagination.offset, 2);
});

test("collection cursors fail closed after collection or kind changes", () => {
  const first = paginateCollection(["a", "b", "c"], { limit: 1 }, options());
  assert.throws(
    () =>
      paginateCollection(
        ["a", "changed", "c"],
        { cursor: first.pagination.nextCursor },
        options(),
      ),
    /STALE_PAGINATION_CURSOR/,
  );
  assert.throws(
    () =>
      paginateCollection(
        ["a", "b", "c"],
        { cursor: first.pagination.nextCursor },
        { ...options(), kind: "other" },
      ),
    /PAGINATION_CURSOR_INVALID/,
  );
  assert.throws(
    () => paginateCollection(["a"], { cursor: "bad" }, options()),
    /PAGINATION_CURSOR_INVALID/,
  );
});

test("collection cursors keep the first-page snapshot when items append", () => {
  const first = paginateCollection(["a", "b", "c"], { limit: 1 }, options());
  const second = paginateCollection(
    ["a", "b", "c", "new"],
    { cursor: first.pagination.nextCursor, limit: 2 },
    options(),
  );

  assert.deepEqual(second.items, ["b", "c"]);
  assert.equal(second.pagination.totalCount, 3);
  assert.equal(second.pagination.hasMore, false);
});

test("collection pagination rejects out-of-range limits", () => {
  assert.throws(
    () => paginateCollection([], { limit: 0 }, options()),
    /from 1 to 3/,
  );
  assert.throws(
    () => paginateCollection([], { limit: 4 }, options()),
    /from 1 to 3/,
  );
});

function options() {
  return {
    kind: "test",
    sourceKey: "session-a",
    defaultLimit: 2,
    maxLimit: 3,
  };
}

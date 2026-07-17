export interface CollectionPageInput {
  cursor?: string;
  limit?: number;
}

export interface CollectionPagination {
  version: "collection-page-v1";
  kind: string;
  fingerprint: string;
  offset: number;
  limit: number;
  returnedCount: number;
  totalCount: number;
  hasMore: boolean;
  nextCursor?: string;
}

export interface CollectionPage<T> {
  items: T[];
  pagination: CollectionPagination;
}

export interface PaginateCollectionOptions {
  kind: string;
  sourceKey: string;
  defaultLimit: number;
  maxLimit: number;
}

export function paginateCollection<T>(
  items: readonly T[],
  input: CollectionPageInput,
  options: PaginateCollectionOptions,
): CollectionPage<T> {
  assertPaginationKind(options.kind);
  const limit = normalizeLimit(
    input.limit,
    options.defaultLimit,
    options.maxLimit,
  );
  const cursor = input.cursor
    ? parseCollectionCursor(input.cursor, options.kind)
    : undefined;
  const snapshotLength = cursor?.snapshotLength ?? items.length;
  if (snapshotLength > items.length) {
    throw new Error(
      `STALE_PAGINATION_CURSOR: the ${options.kind} collection was truncated; request its first page again.`,
    );
  }
  const snapshotItems = items.slice(0, snapshotLength);
  const fingerprint = fingerprintCollection(
    options.kind,
    options.sourceKey,
    snapshotItems,
  );
  if (cursor && cursor.fingerprint !== fingerprint) {
    throw new Error(
      `STALE_PAGINATION_CURSOR: the ${options.kind} collection changed; request its first page again.`,
    );
  }
  const offset = cursor?.offset ?? 0;
  if (offset > snapshotLength) {
    throw new Error(
      `PAGINATION_CURSOR_INVALID: ${options.kind} cursor offset is outside the snapshot.`,
    );
  }
  const end = Math.min(snapshotLength, offset + limit);
  const pageItems = snapshotItems.slice(offset, end);
  const hasMore = end < snapshotLength;
  return {
    items: pageItems,
    pagination: {
      version: "collection-page-v1",
      kind: options.kind,
      fingerprint,
      offset,
      limit,
      returnedCount: pageItems.length,
      totalCount: snapshotLength,
      hasMore,
      ...(hasMore
        ? {
            nextCursor: createCollectionCursor(
              options.kind,
              fingerprint,
              snapshotLength,
              end,
            ),
          }
        : {}),
    },
  };
}

export function fingerprintCollection(
  kind: string,
  sourceKey: string,
  items: readonly unknown[],
): string {
  assertPaginationKind(kind);
  let hash = 0x811c9dc5;
  const value = `${kind}\n${sourceKey}\n${stableStringify(items)}`;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function createCollectionCursor(
  kind: string,
  fingerprint: string,
  snapshotLength: number,
  offset: number,
): string {
  return `cp1_${kind}_${fingerprint}_${snapshotLength}_${offset}`;
}

function parseCollectionCursor(
  cursor: string,
  expectedKind: string,
): { fingerprint: string; snapshotLength: number; offset: number } {
  const match =
    /^cp1_([a-z][a-z0-9-]{0,31})_([a-f0-9]{8})_(\d{1,6})_(\d{1,6})$/.exec(
    cursor,
  );
  if (!match || match[1] !== expectedKind) {
    throw new Error(
      `PAGINATION_CURSOR_INVALID: use nextCursor returned by the ${expectedKind} collection.`,
    );
  }
  const snapshotLength = Number(match[3]);
  const offset = Number(match[4]);
  if (
    !Number.isSafeInteger(snapshotLength) ||
    snapshotLength < 0 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > snapshotLength
  ) {
    throw new Error(
      `PAGINATION_CURSOR_INVALID: ${expectedKind} cursor bounds are invalid.`,
    );
  }
  return {
    fingerprint: match[2]!,
    snapshotLength,
    offset,
  };
}

function normalizeLimit(
  value: number | undefined,
  defaultLimit: number,
  maxLimit: number,
): number {
  if (
    !Number.isSafeInteger(defaultLimit) ||
    defaultLimit < 1 ||
    !Number.isSafeInteger(maxLimit) ||
    maxLimit < defaultLimit
  ) {
    throw new Error("Invalid collection pagination limits.");
  }
  if (value === undefined) {
    return defaultLimit;
  }
  if (!Number.isSafeInteger(value) || value < 1 || value > maxLimit) {
    throw new Error(`Pagination limit must be an integer from 1 to ${maxLimit}.`);
  }
  return value;
}

function assertPaginationKind(kind: string): void {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(kind)) {
    throw new Error(`Invalid collection pagination kind: ${kind}`);
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${stableStringify(entry)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

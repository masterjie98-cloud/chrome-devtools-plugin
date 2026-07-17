export interface SemanticSnapshotInput {
  cursor?: string;
  limit?: number;
}

export type SemanticCheckedState = boolean | "mixed";

export interface SemanticSnapshotNode {
  ref: string;
  role: string;
  name: string;
  selector: string;
  tagName: string;
  description?: string;
  href?: string;
  disabled?: boolean;
  checked?: SemanticCheckedState;
  pressed?: SemanticCheckedState;
  expanded?: boolean;
  selected?: boolean;
  required?: boolean;
  readOnly?: boolean;
  focused?: boolean;
  level?: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export type SemanticSnapshotCandidate = Omit<SemanticSnapshotNode, "ref">;

export interface SemanticSnapshotCollection {
  version: "semantic-snapshot-v1";
  fingerprint: string;
  nodes: SemanticSnapshotNode[];
  pagination: {
    offset: number;
    limit: number;
    returnedCount: number;
    collectedCount: number;
    totalKnown: boolean;
    hasMore: boolean;
    nextCursor?: string;
  };
  stats: {
    sourceTruncated: boolean;
    outputChars: number;
  };
}

export const DEFAULT_SEMANTIC_SNAPSHOT_LIMIT = 50;
export const MAX_SEMANTIC_SNAPSHOT_LIMIT = 100;

export function paginateSemanticSnapshot(
  candidates: SemanticSnapshotCandidate[],
  input: SemanticSnapshotInput,
  sourceKey: string,
  sourceTruncated: boolean,
): SemanticSnapshotCollection {
  const limit = normalizeLimit(input.limit);
  const fingerprint = fingerprintSemanticSnapshot(sourceKey, candidates);
  const offset = input.cursor
    ? parseSnapshotCursor(input.cursor, fingerprint, candidates.length)
    : 0;
  const end = Math.min(candidates.length, offset + limit);
  const nodes = candidates.slice(offset, end).map((node, index) => ({
    ...node,
    ref: `s${offset + index + 1}`,
  }));
  const hasMore = end < candidates.length;
  const base: Omit<SemanticSnapshotCollection, "stats"> = {
    version: "semantic-snapshot-v1",
    fingerprint,
    nodes,
    pagination: {
      offset,
      limit,
      returnedCount: nodes.length,
      collectedCount: candidates.length,
      totalKnown: !sourceTruncated,
      hasMore,
      nextCursor: hasMore ? createSnapshotCursor(fingerprint, end) : undefined,
    },
  };
  return {
    ...base,
    stats: {
      sourceTruncated,
      outputChars: JSON.stringify(base).length,
    },
  };
}

export function fingerprintSemanticSnapshot(
  sourceKey: string,
  candidates: SemanticSnapshotCandidate[],
): string {
  let hash = 0x811c9dc5;
  const value = `${sourceKey}\n${candidates
    .map((node) =>
      [
        node.role,
        node.name,
        node.selector,
        node.description,
        node.href,
        node.disabled,
        node.checked,
        node.pressed,
        node.expanded,
        node.selected,
        node.required,
        node.readOnly,
      ].join("\u001f"),
    )
    .join("\n")}`;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function createSnapshotCursor(fingerprint: string, offset: number): string {
  return `ss1_${fingerprint}_${offset}`;
}

function parseSnapshotCursor(
  cursor: string,
  expectedFingerprint: string,
  candidateCount: number,
): number {
  const match = /^ss1_([a-f0-9]{8})_(\d{1,6})$/.exec(cursor);
  if (!match) {
    throw new Error("SNAPSHOT_CURSOR_INVALID: use nextCursor from browser_snapshot.");
  }
  if (match[1] !== expectedFingerprint) {
    throw new Error(
      "STALE_SNAPSHOT_CURSOR: the page semantic structure changed; request the first page again.",
    );
  }
  const offset = Number(match[2]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > candidateCount) {
    throw new Error("SNAPSHOT_CURSOR_INVALID: cursor offset is outside the snapshot.");
  }
  return offset;
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SEMANTIC_SNAPSHOT_LIMIT;
  }
  return Math.min(
    MAX_SEMANTIC_SNAPSHOT_LIMIT,
    Math.max(1, Math.round(value)),
  );
}

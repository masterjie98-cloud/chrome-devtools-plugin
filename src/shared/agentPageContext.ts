import type { PageSnapshot } from "./dom";
import type { SemanticSnapshotCollection } from "./semanticSnapshot";
import type { ActiveTabSnapshot } from "./wsProtocol";

export function toAgentPageSnapshot(
  value: unknown,
  target?: Partial<Pick<ActiveTabSnapshot, "url" | "title">>,
): PageSnapshot | undefined {
  if (isPageSnapshot(value)) {
    return value;
  }
  if (!isSemanticSnapshot(value)) {
    return undefined;
  }

  const url = target?.url ?? "";
  const title = target?.title ?? "";
  return {
    url,
    title,
    origin: safeOrigin(url),
    capturedAt: new Date().toISOString(),
    visibleText: value.nodes
      .flatMap((node) => [node.name, node.description, node.value])
      .filter((text): text is string => Boolean(text?.trim()))
      .join("\n")
      .slice(0, 20_000),
    domSummary: value.nodes.map((node) => ({
      tagName: node.tagName,
      selector: node.selector,
      role: node.role || undefined,
      ariaLabel: node.name || undefined,
      text: node.description || node.value || node.name || undefined,
      childElementCount: 0,
    })),
    nodeCount: value.pagination.collectedCount,
    truncated: value.stats.sourceTruncated || value.pagination.hasMore,
    mode: "interactive",
    sourceVisited: value.pagination.collectedCount,
    sourceLimit: value.pagination.limit,
    semanticSnapshot: value,
  };
}

function isPageSnapshot(value: unknown): value is PageSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.url === "string" &&
    typeof value.title === "string" &&
    typeof value.capturedAt === "string" &&
    typeof value.visibleText === "string" &&
    Array.isArray(value.domSummary)
  );
}

function isSemanticSnapshot(value: unknown): value is SemanticSnapshotCollection {
  return (
    isRecord(value) &&
    value.version === "semantic-snapshot-v1" &&
    Array.isArray(value.nodes) &&
    isRecord(value.pagination) &&
    isRecord(value.stats)
  );
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

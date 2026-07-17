import type { PageSnapshot, PageSnapshotTarget } from "./dom";

export function attachPageSnapshotProvenance(
  pageSnapshot: PageSnapshot,
  target: PageSnapshotTarget,
  observedAt = new Date().toISOString(),
): PageSnapshot {
  return {
    ...pageSnapshot,
    provenance: {
      source: "chrome-content-script",
      observedAt,
      target: {
        ...target,
        url: pageSnapshot.url,
        title: pageSnapshot.title,
      },
    },
  };
}

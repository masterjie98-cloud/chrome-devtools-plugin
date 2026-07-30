export interface NetworkRetentionCandidate {
  requestId: string;
  method: string;
  resourceType?: string;
  status?: number;
  failed?: boolean;
  finished?: boolean;
}

export function selectNetworkRequestToEvict(
  candidates: readonly NetworkRetentionCandidate[],
): string | undefined {
  let selected: NetworkRetentionCandidate | undefined;
  let selectedPriority = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const priority = networkRequestRetentionPriority(candidate);
    if (priority < selectedPriority) {
      selected = candidate;
      selectedPriority = priority;
    }
  }

  return selected?.requestId;
}

export function networkRequestRetentionPriority(
  request: NetworkRetentionCandidate,
): number {
  const method = request.method.toUpperCase();
  const resourceType = request.resourceType;
  let priority = 0;

  if (!request.finished) {
    priority += 1;
  }
  if (resourceType === "XHR" || resourceType === "Fetch") {
    priority += 4;
  }
  if (resourceType === "Document") {
    priority += 8;
  }
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    priority += 12;
  }
  if (request.failed || (request.status ?? 0) >= 400) {
    priority += 16;
  } else if ((request.status ?? 0) >= 300) {
    priority += 6;
  }

  return priority;
}

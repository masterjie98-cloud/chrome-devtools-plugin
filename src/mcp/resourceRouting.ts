import { createHash } from "node:crypto";
import type { ActiveTabSnapshot, DaemonStateResourceKey } from "../shared/wsProtocol";

export const RESOURCE_TARGET_KEY_PATTERN = /^t1_[a-f0-9]{32}$/;
export const RESOURCE_SESSION_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export interface ResourceSessionSummary {
  sessionId: string;
  selected: boolean;
  resourceTargetKey: string | null;
}

export function createResourceTargetKey(
  target: ActiveTabSnapshot | null | undefined,
): string | null {
  if (!isExactResourceTarget(target)) {
    return null;
  }
  const canonical = JSON.stringify({
    targetId: target.targetId,
    tabId: target.tabId,
    windowId: target.windowId ?? null,
    frameId: target.frameId,
    documentId: target.documentId,
    navigationId: target.navigationId,
    revision: target.revision,
    url: target.url,
  });
  return `t1_${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
}

export function createSessionResourceUri(
  sessionId: string,
  resourceName: string,
): string {
  return `ai-devtools://session/${sessionId}/${resourceName}`;
}

export function createTargetResourceUri(
  sessionId: string,
  targetKey: string,
  resourceName: string,
): string {
  return `ai-devtools://session/${sessionId}/target/${targetKey}/${resourceName}`;
}

export function parseResourceSessionSummaries(
  value: unknown,
): ResourceSessionSummary[] {
  if (!isRecord(value) || !Array.isArray(value.sessions)) {
    return [];
  }
  return value.sessions.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.sessionId !== "string" ||
      !RESOURCE_SESSION_ID_PATTERN.test(entry.sessionId)
    ) {
      return [];
    }
    const resourceTargetKey =
      typeof entry.resourceTargetKey === "string" &&
      RESOURCE_TARGET_KEY_PATTERN.test(entry.resourceTargetKey)
        ? entry.resourceTargetKey
        : null;
    return [
      {
        sessionId: entry.sessionId,
        selected: entry.selected === true,
        resourceTargetKey,
      },
    ];
  });
}

export function assertTargetResourcePayload(
  stateKey: DaemonStateResourceKey,
  payload: unknown,
  expectedTargetKey: string,
): void {
  if (!RESOURCE_TARGET_KEY_PATTERN.test(expectedTargetKey)) {
    throw new Error(
      "RESOURCE_TARGET_INVALID: use a URI returned by resources/list for the selected target.",
    );
  }
  const target = resourcePayloadTarget(stateKey, payload);
  const actualTargetKey = createResourceTargetKey(target);
  if (!actualTargetKey) {
    throw new Error(
      "RESOURCE_TARGET_INCOMPLETE: current state lacks an exact tab/frame/document/navigation binding; refresh the page and retry.",
    );
  }
  if (actualTargetKey !== expectedTargetKey) {
    throw new Error(
      "STALE_CONTEXT: resource URI belongs to a different or older browser target; list resources again.",
    );
  }
}

export function assertResourceSessionSelection(
  selectedSessionId: string | undefined,
  requestedSessionId: string,
): void {
  if (!selectedSessionId) {
    throw new Error(
      "RESOURCE_SESSION_UNBOUND: call browser_list_sessions and browser_set_session before reading state resources.",
    );
  }
  if (selectedSessionId !== requestedSessionId) {
    throw new Error(
      "ROLE_FORBIDDEN: resource session does not match this MCP adapter's selected session.",
    );
  }
}

export function withResourceBinding(
  payload: unknown,
  binding: {
    scope: "session" | "target";
    sessionId: string;
    targetKey?: string;
  },
): Record<string, unknown> {
  return {
    ...(isRecord(payload) ? payload : { value: payload }),
    resourceBinding: binding,
  };
}

function isExactResourceTarget(
  value: ActiveTabSnapshot | null | undefined,
): value is ActiveTabSnapshot & {
  targetId: string;
  tabId: number;
  frameId: number;
  documentId: string;
  navigationId: string;
  revision: number;
} {
  return Boolean(
    value &&
      typeof value.targetId === "string" &&
      value.targetId.length > 0 &&
      Number.isInteger(value.tabId) &&
      Number.isInteger(value.frameId) &&
      typeof value.documentId === "string" &&
      value.documentId.length > 0 &&
      typeof value.navigationId === "string" &&
      value.navigationId.length > 0 &&
      Number.isInteger(value.revision) &&
      typeof value.url === "string" &&
      value.url.length > 0,
  );
}

function resourcePayloadTarget(
  stateKey: DaemonStateResourceKey,
  payload: unknown,
): ActiveTabSnapshot | null {
  if (!isRecord(payload)) {
    return null;
  }
  if (stateKey === "activeTab") {
    return asActiveTab(payload.value);
  }
  if (stateKey === "selectedElement" || stateKey === "contextDigest") {
    return asActiveTab(payload.activeTab);
  }
  if (stateKey === "pageContext") {
    const pageContext = isRecord(payload.value) ? payload.value : undefined;
    const provenance =
      pageContext && isRecord(pageContext.provenance)
        ? pageContext.provenance
        : undefined;
    return provenance && isRecord(provenance.target)
      ? asActiveTab(provenance.target)
      : null;
  }
  return null;
}

function asActiveTab(value: unknown): ActiveTabSnapshot | null {
  if (
    !isRecord(value) ||
    typeof value.url !== "string" ||
    typeof value.title !== "string"
  ) {
    return null;
  }
  return value as unknown as ActiveTabSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

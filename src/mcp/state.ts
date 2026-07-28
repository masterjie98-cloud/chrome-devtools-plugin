import {
  browserStateHub,
  type BrowserStateSnapshot,
} from "./browserStateHub";
import type { DaemonStateResourceKey } from "../shared/wsProtocol";

export type BrowserStateResourceKey = DaemonStateResourceKey;

type SnapshotResourceKey = Exclude<
  BrowserStateResourceKey,
  | "collaborationWorkspace"
  | "contextDigest"
  | "selectedElement"
  | "activityStream"
>;

export function getBrowserStateSnapshot(
  sessionId?: string,
): BrowserStateSnapshot {
  return browserStateHub.snapshot(sessionId);
}

export function readBrowserStateResource(
  key: BrowserStateResourceKey,
  sessionId?: string,
): unknown {
  if (key === "selectedElement") {
    return readSelectedElementResource(sessionId);
  }

  if (key === "contextDigest") {
    return readContextDigestResource(sessionId);
  }

  if (key === "collaborationWorkspace") {
    return browserStateHub.collaborationWorkspacePayload(sessionId);
  }

  if (key === "activityStream") {
    return browserStateHub.activityStreamPayload(sessionId);
  }

  return browserStateHub.resourcePayload(key as SnapshotResourceKey, sessionId);
}

export function readSelectedElementResource(sessionId?: string): unknown {
  return browserStateHub.selectedElementPayload(sessionId);
}

export function readContextDigestResource(sessionId?: string): unknown {
  return browserStateHub.contextDigestPayload(sessionId);
}

export function toResourceJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

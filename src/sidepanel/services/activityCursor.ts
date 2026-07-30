import {
  MCP_TOOL_NAMES,
  normalizeMcpToolName,
} from "../../shared/mcpTools";
import type { BrowserActivityCursor } from "../../shared/browserActivity";

export type ActivityCursorUpdate =
  | { kind: "set"; cursor: BrowserActivityCursor }
  | { kind: "clear" };

export function shouldDeferActivityCursorUpdate(toolName: string): boolean {
  return (
    normalizeMcpToolName(toolName) === MCP_TOOL_NAMES.BROWSER_DEBUG_ACTIVITY
  );
}

export function shouldCommitDeferredActivityCursor(
  agentStatus: "completed" | "blocked" | "failed" | "cancelled",
): boolean {
  return agentStatus === "completed";
}

export function getActivityCursorUpdate(
  toolName: string,
  data: unknown,
): ActivityCursorUpdate | undefined {
  const normalizedName = normalizeMcpToolName(toolName);
  if (normalizedName === MCP_TOOL_NAMES.BROWSER_ACTIVITY_STOP) {
    return { kind: "clear" };
  }
  if (!isRecord(data)) {
    return undefined;
  }
  if (normalizedName === MCP_TOOL_NAMES.BROWSER_ACTIVITY_START) {
    const cursor = toActivityCursor(data.activityCursor);
    return cursor === undefined ? undefined : { kind: "set", cursor };
  }
  if (normalizedName === MCP_TOOL_NAMES.BROWSER_DEBUG_ACTIVITY) {
    const activity = data.activity;
    if (!isRecord(activity)) {
      return undefined;
    }
    const cursor =
      toActivityCursor(activity.nextCursor) ??
      toLegacyActivityCursor(activity.nextSequence, activity.streamId);
    return cursor === undefined ? undefined : { kind: "set", cursor };
  }
  return undefined;
}

function toActivityCursor(value: unknown): BrowserActivityCursor | undefined {
  if (
    !isRecord(value) ||
    typeof value.streamId !== "string" ||
    !value.streamId.trim() ||
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 0
  ) {
    return undefined;
  }
  return { streamId: value.streamId, sequence: value.sequence };
}

function toLegacyActivityCursor(
  sequence: unknown,
  streamId: unknown,
): BrowserActivityCursor | undefined {
  return typeof streamId === "string" &&
    streamId.trim() &&
    typeof sequence === "number" &&
    Number.isSafeInteger(sequence) &&
    sequence >= 0
    ? { streamId, sequence }
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

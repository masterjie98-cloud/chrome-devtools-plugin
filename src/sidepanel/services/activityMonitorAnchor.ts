import type { BrowserActivityCursor } from "../../shared/browserActivity";
import {
  MCP_TOOL_NAMES,
  normalizeMcpToolName,
} from "../../shared/mcpTools";
import type { ChatMessage } from "../types";

export function findActivityMonitorAnchorMessageId(
  messages: readonly ChatMessage[],
  cursor: BrowserActivityCursor,
): string | undefined {
  let latestStartMessageId: string | undefined;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      !message ||
      message.role !== "tool" ||
      normalizeMcpToolName(message.toolName ?? "") !==
        MCP_TOOL_NAMES.BROWSER_ACTIVITY_START
    ) {
      continue;
    }

    latestStartMessageId ??= message.id;
    if (readActivityStreamId(message.content) === cursor.streamId) {
      return message.id;
    }
  }

  return latestStartMessageId;
}

function readActivityStreamId(content: string): string | undefined {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.activityCursor)) {
      return undefined;
    }
    const streamId = parsed.activityCursor.streamId;
    return typeof streamId === "string" && streamId.trim()
      ? streamId
      : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

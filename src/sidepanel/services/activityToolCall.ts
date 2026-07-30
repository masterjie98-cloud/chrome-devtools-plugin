import {
  MCP_TOOL_NAMES,
  normalizeMcpToolName,
} from "../../shared/mcpTools";
import type { AiRequestedToolCall } from "./aiClient";
import type { BrowserActivityCursor } from "../../shared/browserActivity";

export function isIncrementalActivitySummaryRequest(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  const mentionsMonitor =
    /(?:监听|监控|增量|游标|aftersequence|activitycursor)/i.test(normalized) ||
    /\b(?:monitor|watch|tracked|incremental)\b/i.test(normalized);
  const asksForChanges =
    /(?:变化|发生了什么|刚才|后续|之后|以来|摘要)/.test(normalized) ||
    /\b(?:what changed|what happened|changes?|activity|since)\b/i.test(
      normalized,
    );
  return mentionsMonitor && asksForChanges;
}

export function applyIncrementalActivityCursor(
  toolCalls: readonly AiRequestedToolCall[],
  input: string,
  savedCursor: BrowserActivityCursor | undefined,
): AiRequestedToolCall[] {
  if (!isIncrementalActivitySummaryRequest(input)) {
    return [...toolCalls];
  }
  const cursor = isActivityCursor(savedCursor) ? savedCursor : undefined;
  return toolCalls.map((toolCall) => {
    if (
      normalizeMcpToolName(toolCall.name) !==
      MCP_TOOL_NAMES.BROWSER_DEBUG_ACTIVITY
    ) {
      return toolCall;
    }
    const args = {
      ...toolCall.arguments,
      afterSequence: cursor?.sequence ?? 0,
      ...(cursor ? { afterStreamId: cursor.streamId } : {}),
    };
    return {
      ...toolCall,
      arguments: args,
      rawArguments: JSON.stringify(args),
    };
  });
}

function isActivityCursor(value: unknown): value is BrowserActivityCursor {
  return (
    typeof value === "object" &&
    value !== null &&
    "streamId" in value &&
    typeof value.streamId === "string" &&
    value.streamId.length > 0 &&
    "sequence" in value &&
    typeof value.sequence === "number" &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0
  );
}

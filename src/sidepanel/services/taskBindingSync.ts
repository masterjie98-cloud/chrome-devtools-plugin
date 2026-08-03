import { MCP_TOOL_NAMES } from "../../shared/mcpTools";
import type { ExecutionTaskBinding } from "../types";

interface TaskBindingSyncBridge {
  startPluginConversation: (conversationId: string) => void;
  callMcpTool: (
    toolName: string,
    args: Record<string, unknown>,
    options?: {
      signal?: AbortSignal;
      skipTaskContext?: boolean;
      taskContext?: {
        taskId: string;
        conversationId?: string;
        target?: { tabId: number; targetId?: string };
        egressDestinations: string[];
      };
    },
  ) => Promise<unknown>;
}

interface TaskBindingSyncOptions {
  signal?: AbortSignal;
  attempts?: number;
  delay?: (attempt: number) => Promise<void>;
}

export async function synchronizeMcpTaskBinding(
  bridge: TaskBindingSyncBridge,
  binding: ExecutionTaskBinding,
  options: TaskBindingSyncOptions = {},
): Promise<void> {
  const attempts = Math.max(1, Math.min(12, options.attempts ?? 10));
  const delay =
    options.delay ??
    ((attempt: number) =>
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, Math.min(100, 25 + attempt * 10));
      }));

  bridge.startPluginConversation(binding.conversationId);
  let lastStatus: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw options.signal.reason instanceof Error
        ? options.signal.reason
        : new DOMException("Agent request aborted.", "AbortError");
    }
    if (attempt > 0) {
      await delay(attempt);
    }
    lastStatus = await bridge.callMcpTool(
      MCP_TOOL_NAMES.BROWSER_STATUS,
      {},
      {
        signal: options.signal,
        taskContext: {
          taskId: binding.taskId,
          conversationId: binding.conversationId,
          target: {
            tabId: binding.target.tabId,
            targetId: binding.target.targetId,
          },
          egressDestinations: [],
        },
      },
    );
    if (mcpStatusMatchesTaskBinding(lastStatus, binding)) {
      return;
    }
  }

  throw new Error(
    `STALE_CONTEXT: conversation and target binding did not synchronize before tool execution (${describeBindingMismatch(
      lastStatus,
      binding,
    )}).`,
  );
}

export function mcpStatusMatchesTaskBinding(
  status: unknown,
  binding: ExecutionTaskBinding,
): boolean {
  if (!isRecord(status)) {
    return false;
  }
  const activeTab = status.activeTab;
  if (!isRecord(activeTab) || activeTab.tabId !== binding.target.tabId) {
    return false;
  }
  return (
    binding.target.targetId === undefined ||
    activeTab.targetId === binding.target.targetId
  );
}

function describeBindingMismatch(
  status: unknown,
  binding: ExecutionTaskBinding,
): string {
  if (!isRecord(status)) {
    return "status";
  }
  const mismatches: string[] = [];
  const activeTab = status.activeTab;
  if (!isRecord(activeTab) || activeTab.tabId !== binding.target.tabId) {
    mismatches.push("tabId");
  }
  if (
    binding.target.targetId !== undefined &&
    (!isRecord(activeTab) || activeTab.targetId !== binding.target.targetId)
  ) {
    mismatches.push("targetId");
  }
  return mismatches.join(",") || "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

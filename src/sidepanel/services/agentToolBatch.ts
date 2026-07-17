import { getToolPolicy, requiresToolApproval } from "../../shared/toolPolicy";
import type { AiRequestedToolCall } from "./aiClient";

type AgentToolBatchStopPredicate<T> = (
  result: T,
  call: AiRequestedToolCall,
  index: number,
) => boolean;

type AgentToolBatchSkippedResultFactory<T> = (
  call: AiRequestedToolCall,
  blockedBy: AiRequestedToolCall,
  index: number,
) => T;

export type AgentToolBatchExecutionOptions<T> =
  | {
      shouldStopAfter?: undefined;
      createSkippedResult?: undefined;
    }
  | {
      shouldStopAfter: AgentToolBatchStopPredicate<T>;
      createSkippedResult: AgentToolBatchSkippedResultFactory<T>;
    };

export function canExecuteAgentToolBatchInParallel(
  toolCalls: readonly AiRequestedToolCall[],
): boolean {
  return (
    toolCalls.length > 1 &&
    toolCalls.every((call) => {
      const policy = getToolPolicy(call.name, call.arguments);
      return (
        !policy.mutatesBrowser &&
        !policy.openWorld &&
        !requiresToolApproval(call.name, call.arguments)
      );
    })
  );
}

export async function executeAgentToolBatch<T>(
  toolCalls: readonly AiRequestedToolCall[],
  executeOne: (call: AiRequestedToolCall) => Promise<T>,
  options: AgentToolBatchExecutionOptions<T> = {},
): Promise<T[]> {
  if (canExecuteAgentToolBatchInParallel(toolCalls)) {
    return Promise.all(toolCalls.map(executeOne));
  }

  const stopHooks = options.shouldStopAfter ? options : undefined;
  const results: T[] = [];
  let blockedBy: AiRequestedToolCall | undefined;
  for (const [index, call] of toolCalls.entries()) {
    if (blockedBy && stopHooks) {
      results.push(stopHooks.createSkippedResult(call, blockedBy, index));
      continue;
    }

    const result = await executeOne(call);
    results.push(result);
    if (stopHooks?.shouldStopAfter(result, call, index)) {
      blockedBy = call;
    }
  }
  return results;
}

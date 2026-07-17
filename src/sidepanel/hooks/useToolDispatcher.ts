import { useCallback, useState } from "react";
import { MESSAGE_TYPES } from "../../shared/messages";
import { createMessageId, makeRequest, sendRuntimeRequest } from "../../shared/messaging";
import {
  type AnyToolCall,
  type ToolArgumentMap,
  type ToolCall,
  type ToolName,
  type ToolResultMap
} from "../../shared/tools";

export function useToolDispatcher() {
  const [runningTool, setRunningTool] = useState<ToolName | null>(null);

  const runTool = useCallback(
    async <TName extends ToolName>(
      toolName: TName,
      args: ToolArgumentMap[TName]
    ): Promise<ToolResultMap[TName]> => {
      setRunningTool(toolName);
      try {
        const call: ToolCall<TName> = {
          id: createMessageId(),
          toolName,
          args
        } as ToolCall<TName>;
        const response = await sendRuntimeRequest(
          makeRequest("sidepanel", MESSAGE_TYPES.TOOL_CALL, {
            call: call as AnyToolCall
          })
        );

        if (!response.ok) {
          throw new Error(response.error.message);
        }

        return response.payload.data as ToolResultMap[TName];
      } finally {
        setRunningTool(null);
      }
    },
    []
  );

  return {
    runningTool,
    runTool
  };
}

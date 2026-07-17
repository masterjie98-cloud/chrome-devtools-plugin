import { executeToolCall } from "./toolDispatcher";
import type { DevToolsMcpRequest, DevToolsMcpResponse } from "../shared/mcp";
import { TOOL_NAMES, type AnyToolCall } from "../shared/tools";
import { createMessageId } from "../shared/messaging";

export async function handleDevToolsMcpRequest(request: DevToolsMcpRequest): Promise<DevToolsMcpResponse> {
  try {
    switch (request.method) {
      case "take_snapshot": {
        const call: AnyToolCall = {
          id: createMessageId(),
          toolName: TOOL_NAMES.DOM_GET_PAGE_INFO,
          args: request.params ?? {}
        } as AnyToolCall;
        const result = await executeToolCall(call);
        return {
          id: request.id,
          ok: true,
          result
        };
      }
      case "take_screenshot": {
        const call: AnyToolCall = {
          id: createMessageId(),
          toolName: TOOL_NAMES.BROWSER_TAKE_SCREENSHOT,
          args: request.params ?? {}
        } as unknown as AnyToolCall;
        const result = await executeToolCall(call);
        return {
          id: request.id,
          ok: true,
          result
        };
      }
      case "list_console_messages": {
        const call: AnyToolCall = {
          id: createMessageId(),
          toolName: TOOL_NAMES.BROWSER_CONSOLE_MESSAGES,
          args: request.params ?? {}
        } as unknown as AnyToolCall;
        const result = await executeToolCall(call);
        return {
          id: request.id,
          ok: true,
          result
        };
      }
      case "list_network_requests": {
        const call: AnyToolCall = {
          id: createMessageId(),
          toolName: TOOL_NAMES.DEBUGGER_NETWORK_LIST,
          args: request.params ?? {}
        } as unknown as AnyToolCall;
        const result = await executeToolCall(call);
        return {
          id: request.id,
          ok: true,
          result
        };
      }
      case "get_network_request": {
        const call: AnyToolCall = {
          id: createMessageId(),
          toolName: TOOL_NAMES.DEBUGGER_NETWORK_GET,
          args: request.params ?? {}
        } as unknown as AnyToolCall;
        const result = await executeToolCall(call);
        return {
          id: request.id,
          ok: true,
          result
        };
      }
      default:
        return {
          id: request.id,
          ok: false,
          error: "Unsupported MCP method."
        };
    }
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : "MCP request failed."
    };
  }
}

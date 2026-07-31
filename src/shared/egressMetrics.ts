import { MCP_TOOL_NAMES, normalizeMcpToolName } from "./mcpTools";

export type SensitiveEgressClass =
  | "cookies"
  | "storage"
  | "network_metadata"
  | "response_body"
  | "screenshot"
  | "dom"
  | "conversation"
  | "audit_metadata"
  | "page_runtime"
  | "evaluated_page_data"
  | "external_tool"
  | "sensitive_result"
  | "screenshot_artifact"
  | "payload_artifact";

export type EgressDestination = "extension_agent" | "mcp_adapter";

export function serializedEgressPayloadBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function classifySensitiveEgress(
  toolName: string,
): SensitiveEgressClass {
  switch (toolName) {
    case MCP_TOOL_NAMES.BROWSER_COOKIE_LIST:
      return "cookies";
    case MCP_TOOL_NAMES.BROWSER_STORAGE_STATE:
      return "storage";
    case MCP_TOOL_NAMES.BROWSER_NETWORK_GET_RESPONSE_BODY:
      return "response_body";
    case MCP_TOOL_NAMES.BROWSER_NETWORK_REQUESTS:
    case MCP_TOOL_NAMES.BROWSER_NETWORK_LIST_REQUESTS:
    case MCP_TOOL_NAMES.BROWSER_NETWORK_GET_REQUEST:
    case MCP_TOOL_NAMES.BROWSER_PROXY_LIST_HITS:
      return "network_metadata";
    case MCP_TOOL_NAMES.BROWSER_TAKE_SCREENSHOT:
      return "screenshot";
    case MCP_TOOL_NAMES.BROWSER_QUERY_DOM:
      return "dom";
    case MCP_TOOL_NAMES.BROWSER_GET_PLUGIN_CONVERSATION:
    case MCP_TOOL_NAMES.BROWSER_GET_LAST_PLUGIN_MESSAGE:
      return "conversation";
    case MCP_TOOL_NAMES.BROWSER_GET_AUDIT_EVENTS:
      return "audit_metadata";
    case MCP_TOOL_NAMES.BROWSER_CONSOLE_MESSAGES:
      return "page_runtime";
    case MCP_TOOL_NAMES.BROWSER_EVALUATE:
    case MCP_TOOL_NAMES.BROWSER_DEBUGGER_CONTROL:
      return "evaluated_page_data";
    case MCP_TOOL_NAMES.BROWSER_DEBUGGER_BREAKPOINT:
      return "page_runtime";
    default:
      return normalizeMcpToolName(toolName)
        ? "sensitive_result"
        : "external_tool";
  }
}

export function isSensitiveEgressClass(
  value: unknown,
): value is SensitiveEgressClass {
  return (
    value === "cookies" ||
    value === "storage" ||
    value === "network_metadata" ||
    value === "response_body" ||
    value === "screenshot" ||
    value === "dom" ||
    value === "conversation" ||
    value === "audit_metadata" ||
    value === "page_runtime" ||
    value === "evaluated_page_data" ||
    value === "external_tool" ||
    value === "sensitive_result" ||
    value === "screenshot_artifact" ||
    value === "payload_artifact"
  );
}

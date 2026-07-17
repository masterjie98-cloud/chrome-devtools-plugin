export type DevToolsMcpMethod =
  | "take_snapshot"
  | "take_screenshot"
  | "list_console_messages"
  | "list_network_requests"
  | "get_network_request";

export interface DevToolsMcpRequest {
  id: string;
  method: DevToolsMcpMethod;
  params?: Record<string, unknown>;
}

export interface DevToolsMcpResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

import {
  WS_COMMANDS,
  type WsClientRole,
  type WsCommand,
} from "../shared/wsProtocol";

export const CLIENT_HELLO_TIMEOUT_MS = 5_000;
export const PROTOCOL_VIOLATION_WINDOW_MS = 60_000;
export const MAX_PROTOCOL_VIOLATIONS = 3;
export const AUTHENTICATED_IDLE_TIMEOUT_MS = 90_000;
export const IDLE_SWEEP_INTERVAL_MS = 15_000;
export const UNKNOWN_COMMAND_MAX_BYTES = 4 * 1024;

export const INBOUND_MESSAGE_BYTE_LIMITS = {
  [WS_COMMANDS.CLIENT_HELLO]: 4 * 1024,
  [WS_COMMANDS.HEARTBEAT]: 2 * 1024,
  [WS_COMMANDS.ACTIVE_TAB_UPDATED]: 16 * 1024,
  [WS_COMMANDS.ELEMENT_SELECTED]: 128 * 1024,
  [WS_COMMANDS.PLUGIN_CHAT_MESSAGE_CREATED]: 256 * 1024,
  [WS_COMMANDS.PLUGIN_CONVERSATION_STARTED]: 4 * 1024,
  [WS_COMMANDS.SCREENSHOT_CAPTURED]: 8 * 1024 * 1024,
  [WS_COMMANDS.PAGE_CONTEXT_UPDATED]: 2 * 1024 * 1024,
  [WS_COMMANDS.AGENT_SESSION_SYNC]: 512 * 1024,
  [WS_COMMANDS.COLLABORATION_ITEM_UPSERT]: 64 * 1024,
  [WS_COMMANDS.MCP_LIST_TOOLS]: 4 * 1024,
  [WS_COMMANDS.MCP_TOOL_CALL]: 256 * 1024,
  [WS_COMMANDS.STATE_GET]: 4 * 1024,
  [WS_COMMANDS.ARTIFACT_GET]: 4 * 1024,
  [WS_COMMANDS.APPROVAL_RESPONSE]: 4 * 1024,
  [WS_COMMANDS.TASK_GRANT_REVOKE]: 4 * 1024,
  [WS_COMMANDS.REQUEST_CANCEL]: 4 * 1024,
  [WS_COMMANDS.BROWSER_TOOL_CALL]: 512 * 1024,
  [WS_COMMANDS.BROWSER_TOOL_RESULT]: 8 * 1024 * 1024,
} as const satisfies Partial<Record<WsCommand, number>>;

export interface ProtocolViolationState {
  windowStartedAt: number;
  count: number;
}

const ROLE_COMMANDS: Record<WsClientRole, ReadonlySet<WsCommand>> = {
  browser: new Set([
    WS_COMMANDS.HEARTBEAT,
    WS_COMMANDS.ACTIVE_TAB_UPDATED,
    WS_COMMANDS.ELEMENT_SELECTED,
    WS_COMMANDS.SCREENSHOT_CAPTURED,
    WS_COMMANDS.PAGE_CONTEXT_UPDATED,
    WS_COMMANDS.BROWSER_TOOL_RESULT,
  ]),
  plugin: new Set([
    WS_COMMANDS.HEARTBEAT,
    WS_COMMANDS.ACTIVE_TAB_UPDATED,
    WS_COMMANDS.ELEMENT_SELECTED,
    WS_COMMANDS.PLUGIN_CHAT_MESSAGE_CREATED,
    WS_COMMANDS.PLUGIN_CONVERSATION_STARTED,
    WS_COMMANDS.SCREENSHOT_CAPTURED,
    WS_COMMANDS.PAGE_CONTEXT_UPDATED,
    WS_COMMANDS.AGENT_SESSION_SYNC,
    WS_COMMANDS.COLLABORATION_ITEM_UPSERT,
    WS_COMMANDS.MCP_LIST_TOOLS,
    WS_COMMANDS.MCP_TOOL_CALL,
    WS_COMMANDS.REQUEST_CANCEL,
    WS_COMMANDS.BROWSER_TOOL_RESULT,
  ]),
  ui: new Set([
    WS_COMMANDS.HEARTBEAT,
    WS_COMMANDS.ELEMENT_SELECTED,
    WS_COMMANDS.PLUGIN_CHAT_MESSAGE_CREATED,
    WS_COMMANDS.PLUGIN_CONVERSATION_STARTED,
    WS_COMMANDS.SCREENSHOT_CAPTURED,
    WS_COMMANDS.PAGE_CONTEXT_UPDATED,
    WS_COMMANDS.AGENT_SESSION_SYNC,
    WS_COMMANDS.COLLABORATION_ITEM_UPSERT,
    WS_COMMANDS.MCP_LIST_TOOLS,
    WS_COMMANDS.MCP_TOOL_CALL,
    WS_COMMANDS.APPROVAL_RESPONSE,
    WS_COMMANDS.TASK_GRANT_REVOKE,
    WS_COMMANDS.REQUEST_CANCEL,
  ]),
  observer: new Set([
    WS_COMMANDS.HEARTBEAT,
    WS_COMMANDS.MCP_LIST_TOOLS,
  ]),
  mcp: new Set([
    WS_COMMANDS.HEARTBEAT,
    WS_COMMANDS.MCP_LIST_TOOLS,
    WS_COMMANDS.MCP_TOOL_CALL,
    WS_COMMANDS.STATE_GET,
    WS_COMMANDS.ARTIFACT_GET,
    WS_COMMANDS.REQUEST_CANCEL,
  ]),
};

export function isCommandAllowedForRole(
  role: WsClientRole,
  command: WsCommand,
): boolean {
  return ROLE_COMMANDS[role].has(command);
}

export function inboundMessageByteLimit(command: unknown): number {
  return typeof command === "string" &&
    Object.prototype.hasOwnProperty.call(INBOUND_MESSAGE_BYTE_LIMITS, command)
    ? INBOUND_MESSAGE_BYTE_LIMITS[
        command as keyof typeof INBOUND_MESSAGE_BYTE_LIMITS
      ]
    : UNKNOWN_COMMAND_MAX_BYTES;
}

export function utf8MessageByteLength(raw: string): number {
  return new TextEncoder().encode(raw).byteLength;
}

export function consumeProtocolViolation(
  current: ProtocolViolationState | undefined,
  now = Date.now(),
): { state: ProtocolViolationState; shouldClose: boolean } {
  const state =
    !current || now - current.windowStartedAt >= PROTOCOL_VIOLATION_WINDOW_MS
      ? { windowStartedAt: now, count: 1 }
      : { ...current, count: current.count + 1 };
  return {
    state,
    shouldClose: state.count >= MAX_PROTOCOL_VIOLATIONS,
  };
}

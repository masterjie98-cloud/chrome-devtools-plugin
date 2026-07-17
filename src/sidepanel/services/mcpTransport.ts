export const MCP_TRANSPORT_CLOSED = "MCP_TRANSPORT_CLOSED";

export interface McpTransportCloseContext {
  toolName: string;
  closeCode?: number;
  closeReason?: string;
  phase?: "connect" | "in_flight" | "credentials_changed";
}

export class McpToolTransportError extends Error {
  readonly code = MCP_TRANSPORT_CLOSED;
  readonly outcomeUnknown: boolean;
  readonly toolName: string;
  readonly closeCode?: number;
  readonly closeReason?: string;
  readonly phase: NonNullable<McpTransportCloseContext["phase"]>;

  constructor(context: McpTransportCloseContext) {
    const phase = context.phase ?? "in_flight";
    const detail = describeTransportClose(context);
    super(
      `${MCP_TRANSPORT_CLOSED}: 本地工具连接在 ${context.toolName} 返回结果前中断${detail}。`,
    );
    this.name = "McpToolTransportError";
    this.toolName = context.toolName;
    this.closeCode = context.closeCode;
    this.closeReason = normalizeCloseReason(context.closeReason);
    this.phase = phase;
    this.outcomeUnknown = phase !== "connect";
  }
}

export function isMcpToolTransportError(
  error: unknown,
): error is McpToolTransportError {
  return error instanceof McpToolTransportError;
}

function describeTransportClose(context: McpTransportCloseContext): string {
  if (context.phase === "credentials_changed") {
    return "（本地 Bridge 凭据已变更）";
  }
  if (context.phase === "connect") {
    return "（重连未在等待窗口内完成）";
  }

  const reason = normalizeCloseReason(context.closeReason);
  if (reason) {
    return `（WebSocket ${context.closeCode ?? "未知状态"}，${reason}）`;
  }
  if (context.closeCode !== undefined) {
    return `（WebSocket ${context.closeCode}）`;
  }
  return "";
}

function normalizeCloseReason(reason: string | undefined): string | undefined {
  const value = reason?.trim();
  if (!value) {
    return undefined;
  }
  return value.slice(0, 120);
}

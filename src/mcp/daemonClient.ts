import WebSocket from "ws";
import { loadDaemonConfig } from "../daemon/config";
import { createMessageId } from "../shared/messaging";
import {
  MCP_WS_URL,
  WS_COMMANDS,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_PROTOCOL_VERSION,
  type DaemonStateResourceKey,
  type ArtifactGetResultPayload,
  type McpListToolsResultPayload,
  type McpToPluginMessage,
  type McpToolResultPayload,
  type PluginToMcpMessage,
  type StateGetResultPayload,
  type BrowserActivityUpdatedPayload,
} from "../shared/wsProtocol";
import { WS_CLIENT_IDENTITIES } from "../shared/wsClientIdentity";
import { getReconnectDelayMs } from "../shared/reconnectBackoff";
import { getToolPolicy } from "../shared/toolPolicy";
import {
  RUNTIME_BUILD_ID,
  RUNTIME_SCHEMA_HASH,
  parseRuntimeHandshakeFailure,
  runtimeIdentityMismatch,
} from "../shared/runtimeIdentity";
import { ADAPTER_ROUTING_TOOL_NAMES } from "./adapterRoutingTools";
import { COLLABORATION_TOOL_NAMES } from "../shared/collaborationTasks";

interface PendingRequest {
  expectedCommand:
    | typeof WS_COMMANDS.ARTIFACT_GET_RESULT
    | typeof WS_COMMANDS.MCP_LIST_TOOLS_RESULT
    | typeof WS_COMMANDS.MCP_TOOL_RESULT
    | typeof WS_COMMANDS.STATE_GET_RESULT;
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
  cleanup?: () => void;
}

export interface DaemonCallOptions {
  signal?: AbortSignal;
  deadlineAt?: string;
  idempotencyKey?: string;
}

export class DaemonRecoveryError extends Error {
  constructor(
    readonly code:
      | "DAEMON_RECONNECT_FAILED"
      | "UNKNOWN_WRITE_OUTCOME",
    message: string,
    readonly retryable: boolean,
  ) {
    super(`${code}: ${message}`);
    this.name = "DaemonRecoveryError";
  }
}

export class DaemonClient {
  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly adapterInstanceId = createMessageId();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly activityListeners = new Set<
    (payload: BrowserActivityUpdatedPayload) => void
  >();

  constructor(
    private readonly url = process.env.AI_DEVTOOLS_DAEMON_URL ?? MCP_WS_URL,
    private sessionId = process.env.AI_DEVTOOLS_SESSION_ID,
    private readonly configuredBridgeToken = process.env.AI_DEVTOOLS_BRIDGE_TOKEN,
    private readonly heartbeatIntervalMs = WS_HEARTBEAT_INTERVAL_MS,
  ) {}

  async listTools(): Promise<unknown[]> {
    const payload = await this.requestSafeRead(
      () =>
        this.request<McpListToolsResultPayload>(
          WS_COMMANDS.MCP_LIST_TOOLS,
          { includeExternal: true },
          WS_COMMANDS.MCP_LIST_TOOLS_RESULT,
          15_000,
        ),
    );
    if (!payload.ok) {
      throw new Error(payload.error);
    }
    return payload.tools;
  }

  selectedSessionId(): string | undefined {
    return this.sessionId;
  }

  subscribeActivityUpdates(
    listener: (payload: BrowserActivityUpdatedPayload) => void,
  ): () => void {
    this.activityListeners.add(listener);
    return () => this.activityListeners.delete(listener);
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    options: DaemonCallOptions = {},
  ): Promise<unknown> {
    try {
      return await this.callToolOnce(toolName, args, options);
    } catch (error) {
      const normalized = normalizeError(error);
      if (!isDaemonConnectionError(normalized)) {
        throw normalized;
      }

      const policy = getToolPolicy(toolName, args);
      const beforeDispatch = isBeforeDispatchDaemonError(normalized);
      const safeRead =
        (policy.known &&
          policy.policyClass === "safe_read" &&
          policy.idempotent &&
          !policy.requiresApproval) ||
        toolName === COLLABORATION_TOOL_NAMES.WAIT_FOR_TASK_RESULT;

      try {
        await this.waitForReconnect(options.signal);
      } catch (reconnectError) {
        throw new DaemonRecoveryError(
          "DAEMON_RECONNECT_FAILED",
          `local daemon did not recover: ${normalizeError(reconnectError).message}`,
          true,
        );
      }

      if (beforeDispatch || safeRead) {
        return this.callToolOnce(toolName, args, options);
      }

      throw new DaemonRecoveryError(
        "UNKNOWN_WRITE_OUTCOME",
        `the daemon disconnected after ${toolName} may have been dispatched. Re-observe the current browser state before deciding whether to continue; the adapter did not replay this call.`,
        false,
      );
    }
  }

  private async callToolOnce(
    toolName: string,
    args: Record<string, unknown>,
    options: DaemonCallOptions,
  ): Promise<unknown> {
    const deadlineAt = options.deadlineAt;
    const payload = await this.request<McpToolResultPayload>(
      WS_COMMANDS.MCP_TOOL_CALL,
      { call: { toolName, args } },
      WS_COMMANDS.MCP_TOOL_RESULT,
      {
        ...(deadlineAt
          ? { timeoutMs: deadlineTimeoutMs(deadlineAt), deadlineAt }
          : {}),
        idempotencyKey: options.idempotencyKey,
        signal: options.signal,
      },
    );
    if (!payload.ok) {
      throw new Error(payload.error);
    }
    if (
      toolName === ADAPTER_ROUTING_TOOL_NAMES.SET_SESSION &&
      isRecord(payload.data) &&
      typeof payload.data.selectedSessionId === "string"
    ) {
      this.sessionId = payload.data.selectedSessionId;
    }
    return payload.data;
  }

  private async waitForReconnect(signal?: AbortSignal): Promise<void> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      throwIfAborted(signal);
      if (attempt > 0) {
        await waitWithAbort(
          getReconnectDelayMs(attempt - 1, {
            baseDelayMs: 100,
            maxDelayMs: 2_000,
            jitterRatio: 0,
          }),
          signal,
        );
      }
      try {
        await this.ensureConnected();
        return;
      } catch (error) {
        lastError = normalizeError(error);
      }
    }
    throw lastError ?? new Error("Local daemon reconnect failed.");
  }

  async readState(
    key: DaemonStateResourceKey,
    sessionId = this.sessionId,
  ): Promise<unknown> {
    const payload = await this.requestSafeRead(
      () =>
        this.request<StateGetResultPayload>(
          WS_COMMANDS.STATE_GET,
          { key, ...(sessionId ? { sessionId } : {}) },
          WS_COMMANDS.STATE_GET_RESULT,
          10_000,
        ),
    );
    if (!payload.ok) {
      throw new Error(payload.error);
    }
    return payload.data;
  }

  async readArtifact(artifactId: string): Promise<ArtifactGetResultPayload> {
    return this.requestSafeRead(
      () =>
        this.request<ArtifactGetResultPayload>(
          WS_COMMANDS.ARTIFACT_GET,
          { artifactId },
          WS_COMMANDS.ARTIFACT_GET_RESULT,
          15_000,
        ),
    );
  }

  private async requestSafeRead<T>(
    execute: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      return await execute();
    } catch (error) {
      const normalized = normalizeError(error);
      if (!isDaemonConnectionError(normalized)) {
        throw normalized;
      }
      await this.waitForReconnect(signal);
      return execute();
    }
  }

  close(): void {
    this.stopHeartbeat();
    this.rejectPending("Daemon client closed before the response arrived.");
    this.socket?.close();
    this.socket = null;
    this.connecting = null;
  }

  private async request<TPayload>(
    command:
      | typeof WS_COMMANDS.ARTIFACT_GET
      | typeof WS_COMMANDS.MCP_LIST_TOOLS
      | typeof WS_COMMANDS.MCP_TOOL_CALL
      | typeof WS_COMMANDS.STATE_GET,
    payload: Record<string, unknown>,
    expectedCommand: PendingRequest["expectedCommand"],
    options: {
      timeoutMs?: number;
      deadlineAt?: string;
      idempotencyKey?: string;
      signal?: AbortSignal;
    } | number,
  ): Promise<TPayload> {
    const normalizedOptions =
      typeof options === "number" ? { timeoutMs: options } : options;
    throwIfAborted(normalizedOptions.signal);
    await this.ensureConnected();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Local daemon is not connected at ${this.url}.`);
    }

    const requestId = createMessageId();
    const message = {
      requestId,
      command,
      sentAt: new Date().toISOString(),
      ...(normalizedOptions.deadlineAt
        ? { deadlineAt: normalizedOptions.deadlineAt }
        : {}),
      ...(normalizedOptions.idempotencyKey
        ? {
            idempotencyKey: `${this.adapterInstanceId}:${normalizedOptions.idempotencyKey}`,
          }
        : {}),
      payload,
    } as PluginToMcpMessage;

    return new Promise<TPayload>((resolve, reject) => {
      const timeout =
        normalizedOptions.timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              const pending = this.pending.get(requestId);
              pending?.cleanup?.();
              this.pending.delete(requestId);
              reject(new Error(`REQUEST_DEADLINE_EXCEEDED: ${command}`));
              this.sendCancel(socket, requestId, "Adapter deadline exceeded.");
            }, normalizedOptions.timeoutMs);

      const abort = () => {
        const pending = this.pending.get(requestId);
        if (!pending) {
          return;
        }
        clearPendingTimeout(pending);
        pending.cleanup?.();
        this.pending.delete(requestId);
        pending.reject(createAbortError());
        this.sendCancel(socket, requestId, "MCP client cancelled the request.");
      };
      normalizedOptions.signal?.addEventListener("abort", abort, { once: true });

      this.pending.set(requestId, {
        expectedCommand,
        resolve: (value) => resolve(value as TPayload),
        reject,
        timeout,
        cleanup: normalizedOptions.signal
          ? () => normalizedOptions.signal?.removeEventListener("abort", abort)
          : undefined,
      });
      socket.send(JSON.stringify(message), (error) => {
        if (!error) {
          return;
        }
        const pending = this.pending.get(requestId);
        if (!pending) {
          return;
        }
        clearPendingTimeout(pending);
        pending.cleanup?.();
        this.pending.delete(requestId);
        pending.reject(error);
      });
    });
  }

  private sendCancel(
    socket: WebSocket,
    targetRequestId: string,
    reason: string,
  ): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const message: PluginToMcpMessage = {
      requestId: createMessageId(),
      command: WS_COMMANDS.REQUEST_CANCEL,
      sentAt: new Date().toISOString(),
      payload: { targetRequestId, reason },
    };
    socket.send(JSON.stringify(message));
  }

  private ensureConnected(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url, {
        maxPayload: 8 * 1024 * 1024,
      });
      this.socket = socket;
      let settled = false;
      let handshakeTimeout: ReturnType<typeof setTimeout> | undefined;

      const failConnection = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        if (handshakeTimeout) {
          clearTimeout(handshakeTimeout);
        }
        if (this.socket === socket) {
          this.socket = null;
        }
        socket.close();
        reject(error);
      };

      const finishConnection = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (handshakeTimeout) {
          clearTimeout(handshakeTimeout);
        }
        resolve();
      };

      socket.once("open", async () => {
        socket.on("message", (raw) => {
          const rawText = raw.toString();
          const handshakeFailure = parseDaemonHandshakeFailure(rawText);
          if (handshakeFailure) {
            failConnection(new Error(handshakeFailure));
            return;
          }
          const message = parseDaemonMessage(rawText);
          if (message?.command === WS_COMMANDS.SERVER_WELCOME) {
            if (message.payload.protocolVersion !== WS_PROTOCOL_VERSION) {
              failConnection(
                new Error(
                  `PROTOCOL_VERSION_UNSUPPORTED: adapter requires version ${WS_PROTOCOL_VERSION}, daemon sent ${message.payload.protocolVersion}.`,
                ),
              );
              return;
            }
            const identityMismatch = runtimeIdentityMismatch(message.payload);
            if (identityMismatch) {
              failConnection(
                new Error(
                  `${identityMismatch === "buildId" ? "BUILD_ID_MISMATCH" : "SCHEMA_HASH_MISMATCH"}: adapter=${identityMismatch === "buildId" ? RUNTIME_BUILD_ID : RUNTIME_SCHEMA_HASH}, daemon=${message.payload[identityMismatch]}. Restart the daemon and MCP client, then reload the Chrome extension.`,
                ),
              );
              return;
            }
            if (message.payload.assignedRole !== "mcp") {
              failConnection(
                new Error(
                  `ROLE_FORBIDDEN: daemon assigned ${message.payload.assignedRole}, expected mcp.`,
                ),
              );
              return;
            }
            this.startHeartbeat(socket);
            finishConnection();
            return;
          }
          this.handleMessage(raw.toString());
        });
        socket.on("close", () => {
          this.stopHeartbeat();
          if (this.socket === socket) {
            this.socket = null;
          }
          this.connecting = null;
          this.rejectPending("Local daemon disconnected before the response arrived.");
          failConnection(
            new Error(
              "DAEMON_PROTOCOL_MISMATCH_SUSPECTED: the local daemon closed before SERVER_WELCOME. Stop any older daemon instance, start the daemon from this package, then reopen the MCP client and reload the Chrome extension.",
            ),
          );
        });
        socket.on("error", () => {
          // The close handler owns cleanup after the connection is established.
        });

        let bridgeToken: string;
        try {
          bridgeToken =
            this.configuredBridgeToken ??
            (await loadDaemonConfig()).bridgeToken;
        } catch (error) {
          failConnection(
            error instanceof Error
              ? error
              : new Error("Failed to load local daemon credentials."),
          );
          return;
        }

        const hello: PluginToMcpMessage = {
          requestId: createMessageId(),
          command: WS_COMMANDS.CLIENT_HELLO,
          sentAt: new Date().toISOString(),
          payload: {
            protocolVersion: WS_PROTOCOL_VERSION,
            buildId: RUNTIME_BUILD_ID,
            schemaHash: RUNTIME_SCHEMA_HASH,
            clientRole: WS_CLIENT_IDENTITIES.CODEX_STDIO_ADAPTER.assignedRole,
            clientName: WS_CLIENT_IDENTITIES.CODEX_STDIO_ADAPTER.clientName,
            bridgeToken,
            ...(this.sessionId ? { sessionId: this.sessionId } : {}),
          },
        };
        socket.send(JSON.stringify(hello), (error) => {
          if (error) {
            failConnection(error);
            return;
          }
          if (settled) {
            return;
          }
          handshakeTimeout = setTimeout(() => {
            failConnection(
              new Error(
                `DAEMON_PROTOCOL_MISMATCH_SUSPECTED: daemon did not send SERVER_WELCOME for version ${WS_PROTOCOL_VERSION}. Stop any older daemon instance, start the daemon from this package, then reopen the MCP client and reload the Chrome extension.`,
              ),
            );
          }, 5_000);
        });
      });
      socket.once("error", (error) => {
        if (socket.readyState !== WebSocket.OPEN) {
          failConnection(error);
        }
      });
    }).finally(() => {
      this.connecting = null;
    });

    return this.connecting;
  }

  private handleMessage(raw: string): void {
    let message: McpToPluginMessage;
    try {
      message = JSON.parse(raw) as McpToPluginMessage;
    } catch {
      return;
    }

    if (message.command === WS_COMMANDS.BROWSER_ACTIVITY_UPDATED) {
      for (const listener of this.activityListeners) {
        listener(message.payload);
      }
      return;
    }

    if (
      message.command !== WS_COMMANDS.MCP_LIST_TOOLS_RESULT &&
      message.command !== WS_COMMANDS.MCP_TOOL_RESULT &&
      message.command !== WS_COMMANDS.ARTIFACT_GET_RESULT &&
      message.command !== WS_COMMANDS.STATE_GET_RESULT
    ) {
      return;
    }

    const pending = this.pending.get(message.requestId);
    if (!pending || pending.expectedCommand !== message.command) {
      return;
    }
    clearPendingTimeout(pending);
    pending.cleanup?.();
    this.pending.delete(message.requestId);
    pending.resolve(message.payload);
  }

  private rejectPending(reason: string): void {
    for (const [requestId, pending] of this.pending) {
      clearPendingTimeout(pending);
      pending.cleanup?.();
      pending.reject(new Error(reason));
      this.pending.delete(requestId);
    }
  }

  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      const message: PluginToMcpMessage = {
        requestId: createMessageId(),
        command: WS_COMMANDS.HEARTBEAT,
        sentAt: new Date().toISOString(),
        payload: { ...(this.sessionId ? { sessionId: this.sessionId } : {}) },
      };
      socket.send(JSON.stringify(message));
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDaemonMessage(raw: string): McpToPluginMessage | null {
  try {
    return JSON.parse(raw) as McpToPluginMessage;
  } catch {
    return null;
  }
}

export function parseDaemonHandshakeFailure(raw: string): string | undefined {
  return parseRuntimeHandshakeFailure(raw);
}

function deadlineTimeoutMs(deadlineAt: string): number {
  const parsed = Date.parse(deadlineAt);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid deadlineAt: ${deadlineAt}`);
  }
  return Math.max(1, parsed - Date.now());
}

function clearPendingTimeout(pending: PendingRequest): void {
  if (pending.timeout !== undefined) {
    clearTimeout(pending.timeout);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createAbortError(): Error {
  const error = new Error("REQUEST_CANCELLED: MCP client cancelled the request.");
  error.name = "AbortError";
  return error;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isDaemonConnectionError(error: Error): boolean {
  return /(?:Local daemon|daemon client|ECONNREFUSED|WebSocket|socket|connection).*(?:closed|disconnected|connect|response|refused)|ECONNREFUSED/i.test(
    error.message,
  );
}

function isBeforeDispatchDaemonError(error: Error): boolean {
  return /(?:ECONNREFUSED|not connected|protocol negotiation|did not send SERVER_WELCOME|RUNTIME_VERSION_MISMATCH|DAEMON_PROTOCOL_MISMATCH_SUSPECTED|Failed to load local daemon credentials)/i.test(
    error.message,
  );
}

function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(createAbortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

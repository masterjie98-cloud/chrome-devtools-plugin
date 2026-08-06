import type { PageSnapshot } from "../../shared/dom";
import type { AgentSessionSnapshot } from "../../shared/agentSession";
import type { AiContextUsageSnapshot } from "../../shared/aiContextUsage";
import type {
  DaemonAgentBudgetDecisionPayload,
  DaemonAgentCompletionResult,
  DaemonAgentEventPayload,
  DaemonAgentStartPayload,
  DaemonAgentToolMessage,
} from "../../shared/daemonAgent";
import type {
  AgentRunBudgetExtensionDecision,
  AgentRunBudgetExtensionRequest,
} from "../../shared/agentRunBudget";
import {
  daemonAgentResultFromSession,
  toDaemonAgentMessages,
} from "../../shared/daemonAgent";
import {
  sanitizeCollaborationItemInput,
  type CollaborationItemInput,
} from "../../shared/collaborationWorkspace";
import { createMessageId } from "../../shared/messaging";
import { getReconnectDelayMs } from "../../shared/reconnectBackoff";
import { getInstallationId } from "../../shared/extensionIdentity";
import {
  getBridgeToken,
  subscribeBridgeTokenChanges,
} from "../../shared/bridgeCredentials";
import {
  MCP_WS_URL,
  WS_COMMANDS,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_PROTOCOL_VERSION,
  sanitizeActiveTabForMcp,
  sanitizeElementForMcp,
  sanitizePageSnapshotForMcp,
  sanitizeScreenshotForMcp,
  type ActiveTabSnapshot,
  type ApprovalCancelledPayload,
  type ApprovalRequestPayload,
  type ApprovalResponsePayload,
  type BrowserToolResultPayload,
  type ElementSelectedPayload,
  type McpAvailableTool,
  type McpListToolsResultPayload,
  type McpToolResultPayload,
  type McpToolCallPayload,
  type LocalUpdateCheckResultPayload,
  type LocalUpdateResultPayload,
  type LocalServiceStatusResultPayload,
  type LocalServiceSetResultPayload,
  type ExternalMcpResultPayload,
  type McpToPluginMessage,
  type PluginChatMessageSnapshot,
  type PluginToMcpMessage,
  type ScreenshotSnapshot,
} from "../../shared/wsProtocol";
import type {
  ExternalMcpServerConfig,
  ExternalMcpServerSummary,
} from "../../shared/externalMcp";
import { WS_CLIENT_IDENTITIES } from "../../shared/wsClientIdentity";
import {
  RUNTIME_BUILD_ID,
  RUNTIME_SCHEMA_HASH,
  parseFailedProtocolAck,
  parseRuntimeHandshakeFailure,
  runtimeIdentityMismatch,
} from "../../shared/runtimeIdentity";
import { toAbortError } from "./abortError";
import { McpToolTransportError } from "./mcpTransport";

type ApprovalHandlerResult = Pick<ApprovalResponsePayload, "approved" | "rememberForTask">;
type ApprovalHandler = (
  request: ApprovalRequestPayload,
) => Promise<ApprovalHandlerResult>;
type ApprovalCancellationHandler = (
  cancellation: ApprovalCancelledPayload,
) => void;

const MCP_CONNECT_WAIT_MS = 6_000;
const DAEMON_AGENT_START_TIMEOUT_MS = 15_000;
const DAEMON_AGENT_CANCEL_RETRY_MS = 4_000;

interface McpCallOptions {
  signal?: AbortSignal;
  idempotencyKey?: string;
  deadlineAt?: string;
  waitForApproval?: boolean;
  skipTaskContext?: boolean;
  taskContext?: McpToolCallPayload["taskContext"];
}

interface DaemonAgentHandlers {
  onVisibleContent: (content: string) => void;
  onStatusUpdate?: (status?: string) => void;
  onSessionUpdate?: (session: AgentSessionSnapshot) => void;
  onToolMessage?: (message: DaemonAgentToolMessage) => void;
  onContextUsage?: (report: AiContextUsageSnapshot) => void;
  onBudgetExtensionRequest?: (
    request: AgentRunBudgetExtensionRequest & {
      budgetRequestId: string;
      runId: string;
      conversationId: string;
    },
  ) => Promise<AgentRunBudgetExtensionDecision>;
  onBudgetExtensionCancelled?: (budgetRequestId: string) => void;
}

interface ActiveDaemonAgentRun {
  conversationId: string;
  handlers: DaemonAgentHandlers;
  resolve: (value: DaemonAgentCompletionResult) => void;
  reject: (error: Error) => void;
  cleanup?: () => void;
  signal?: AbortSignal;
  pendingBudgetRequestId?: string;
  cancelRequestId?: string;
  cancelReason?: string;
  cancelRetryTimer?: number;
  terminalError?: Error;
}

interface McpBridgeOptions {
  daemonAgentStartTimeoutMs?: number;
  daemonAgentCancelRetryMs?: number;
}

export class McpBridge {
  private socket: WebSocket | null = null;
  private authenticatedSocket: WebSocket | null = null;
  private connectionId: string | null = null;
  private queue: PluginToMcpMessage[] = [];
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private lastConnectionFailure: string | null = null;
  private heartbeatTimer: number | null = null;
  private approvalHandler: ApprovalHandler | null = null;
  private approvalCancellationHandler: ApprovalCancellationHandler | null = null;
  private cancelledApprovalIds = new Set<string>();
  private taskContext: McpToolCallPayload["taskContext"] | null = null;
  private pendingMcpToolCalls = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout?: number;
      toolName: string;
      cleanup?: () => void;
    }
  >();
  private pendingMcpToolListRequests = new Map<
    string,
    {
      resolve: (value: McpAvailableTool[]) => void;
      reject: (error: Error) => void;
      timeout: number;
    }
  >();
  private pendingLocalUpdateChecks = new Map<
    string,
    {
      resolve: (value: LocalUpdateCheckResultPayload) => void;
      reject: (error: Error) => void;
      timeout: number;
    }
  >();
  private pendingLocalUpdates = new Map<
    string,
    {
      resolve: (value: LocalUpdateResultPayload) => void;
      reject: (error: Error) => void;
      timeout: number;
    }
  >();
  private pendingLocalServiceStatus = new Map<
    string,
    {
      resolve: (value: LocalServiceStatusResultPayload) => void;
      reject: (error: Error) => void;
      timeout: number;
    }
  >();
  private pendingLocalServiceSet = new Map<
    string,
    {
      resolve: (value: LocalServiceSetResultPayload) => void;
      reject: (error: Error) => void;
      timeout: number;
    }
  >();
  private pendingExternalMcpRequests = new Map<
    string,
    {
      resolve: (value: ExternalMcpResultPayload) => void;
      reject: (error: Error) => void;
      timeout: number;
    }
  >();
  private pendingDaemonAgentStarts = new Map<
    string,
    {
      runId: string;
      reject: (error: Error) => void;
      timeout: number;
    }
  >();
  private pendingDaemonAgentCancels = new Map<
    string,
    {
      runId: string;
      timeout: number;
    }
  >();
  private activeDaemonAgentRuns = new Map<string, ActiveDaemonAgentRun>();
  private readonly daemonAgentStartTimeoutMs: number;
  private readonly daemonAgentCancelRetryMs: number;

  constructor(options: McpBridgeOptions = {}) {
    this.daemonAgentStartTimeoutMs =
      options.daemonAgentStartTimeoutMs ?? DAEMON_AGENT_START_TIMEOUT_MS;
    this.daemonAgentCancelRetryMs =
      options.daemonAgentCancelRetryMs ?? DAEMON_AGENT_CANCEL_RETRY_MS;
    subscribeBridgeTokenChanges(() => {
      const previousSocket = this.socket;
      this.rejectPendingMcpToolCalls((toolName) =>
        new McpToolTransportError({
          toolName,
          phase: "credentials_changed",
        }),
      );
      this.socket = null;
      this.authenticatedSocket = null;
      this.connectionId = null;
      this.stopHeartbeat();
      this.resetDaemonAgentCancelRequestsForReconnect();
      previousSocket?.close();
      this.connect();
    });
  }

  connect(): void {
    if (typeof WebSocket === "undefined") {
      return;
    }
    if (
      this.socket?.readyState === WebSocket.OPEN ||
      this.socket?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    this.socket = new WebSocket(MCP_WS_URL);
    this.authenticatedSocket = null;
    this.connectionId = null;
    const socket = this.socket;
    socket.addEventListener("open", () => {
      void this.handleOpen(socket);
    });
    socket.addEventListener("message", (event) => {
      void this.handleServerMessage(event.data, socket);
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.authenticatedSocket = null;
      this.connectionId = null;
      this.stopHeartbeat();
      this.rejectPendingMcpToolCalls(
        (toolName) =>
          new McpToolTransportError({
            toolName,
            closeCode: event.code,
            closeReason: event.reason,
            phase: "in_flight",
          }),
      );
      this.rejectPendingMcpToolListRequests(
        "MCP tool list connection closed before a result was returned.",
      );
      this.rejectPendingExternalMcpRequests("外部 MCP 连接已中断，请重试。");
      this.resetDaemonAgentCancelRequestsForReconnect();
      this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      if (this.socket !== socket) {
        return;
      }
      this.stopHeartbeat();
      this.connectionId = null;
      // Browsers dispatch a close event after a WebSocket error. Keep the
      // pending calls until that event so the close code/reason is not lost.
      this.scheduleReconnect();
    });
  }

  private async handleOpen(socket: WebSocket): Promise<void> {
    try {
      await this.sendClientHello(
        socket,
        WS_CLIENT_IDENTITIES.CHROME_SIDEPANEL.assignedRole,
        WS_CLIENT_IDENTITIES.CHROME_SIDEPANEL.clientName,
      );
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
    } catch {
      this.socket?.close();
    }
  }

  setApprovalHandler(handler: ApprovalHandler | null): void {
    this.approvalHandler = handler;
  }

  setApprovalCancellationHandler(
    handler: ApprovalCancellationHandler | null,
  ): void {
    this.approvalCancellationHandler = handler;
  }

  getConnectionId(): string | null {
    return this.authenticatedSocket === this.socket &&
      this.socket?.readyState === WebSocket.OPEN
      ? this.connectionId
      : null;
  }

  isConnected(): boolean {
    return (
      this.authenticatedSocket === this.socket &&
      this.socket?.readyState === WebSocket.OPEN
    );
  }

  async checkLocalUpdate(): Promise<LocalUpdateCheckResultPayload> {
    await this.waitUntilOpen();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Daemon 未连接，无法检查更新。");
    }
    const requestId = createMessageId();
    const message: PluginToMcpMessage = {
      requestId,
      command: WS_COMMANDS.LOCAL_UPDATE_CHECK,
      sentAt: new Date().toISOString(),
      payload: {},
    };
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pendingLocalUpdateChecks.delete(requestId);
        reject(new Error("检查更新超时。"));
      }, 60_000);
      this.pendingLocalUpdateChecks.set(requestId, { resolve, reject, timeout });
      this.socket?.send(JSON.stringify(message));
    });
  }

  async runLocalUpdate(): Promise<LocalUpdateResultPayload> {
    await this.waitUntilOpen();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Daemon 未连接，无法执行更新。");
    }
    const requestId = createMessageId();
    const message: PluginToMcpMessage = {
      requestId,
      command: WS_COMMANDS.LOCAL_UPDATE,
      sentAt: new Date().toISOString(),
      payload: {},
    };
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pendingLocalUpdates.delete(requestId);
        reject(new Error("本地更新超时（可能仍在后台执行，请稍后重载扩展并检查 daemon）。"));
      }, 16 * 60_000);
      this.pendingLocalUpdates.set(requestId, { resolve, reject, timeout });
      this.socket?.send(JSON.stringify(message));
    });
  }

  async getLocalServiceStatus(): Promise<LocalServiceStatusResultPayload> {
    await this.waitUntilOpen();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Daemon 未连接，无法查询开机自启状态。");
    }
    const requestId = createMessageId();
    const message: PluginToMcpMessage = {
      requestId,
      command: WS_COMMANDS.LOCAL_SERVICE_STATUS,
      sentAt: new Date().toISOString(),
      payload: {},
    };
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pendingLocalServiceStatus.delete(requestId);
        reject(new Error("查询开机自启状态超时。"));
      }, 30_000);
      this.pendingLocalServiceStatus.set(requestId, {
        resolve,
        reject,
        timeout,
      });
      this.socket?.send(JSON.stringify(message));
    });
  }

  async setLocalServiceAutostart(
    enabled: boolean,
  ): Promise<LocalServiceSetResultPayload> {
    await this.waitUntilOpen();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Daemon 未连接，无法修改开机自启。");
    }
    const requestId = createMessageId();
    const message: PluginToMcpMessage = {
      requestId,
      command: WS_COMMANDS.LOCAL_SERVICE_SET,
      sentAt: new Date().toISOString(),
      payload: { enabled },
    };
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pendingLocalServiceSet.delete(requestId);
        reject(new Error("修改开机自启超时。"));
      }, 60_000);
      this.pendingLocalServiceSet.set(requestId, { resolve, reject, timeout });
      this.socket?.send(JSON.stringify(message));
    });
  }

  async listExternalMcpServers(): Promise<ExternalMcpServerSummary[]> {
    return this.requestExternalMcp({
      requestId: createMessageId(),
      command: WS_COMMANDS.EXTERNAL_MCP_LIST,
      sentAt: new Date().toISOString(),
      payload: {},
    });
  }

  async upsertExternalMcpServer(
    server: ExternalMcpServerConfig,
  ): Promise<ExternalMcpServerSummary[]> {
    return this.requestExternalMcp({
      requestId: createMessageId(),
      command: WS_COMMANDS.EXTERNAL_MCP_UPSERT,
      sentAt: new Date().toISOString(),
      payload: { server },
    });
  }

  async removeExternalMcpServer(
    serverId: string,
  ): Promise<ExternalMcpServerSummary[]> {
    return this.requestExternalMcp({
      requestId: createMessageId(),
      command: WS_COMMANDS.EXTERNAL_MCP_REMOVE,
      sentAt: new Date().toISOString(),
      payload: { serverId },
    });
  }

  async setExternalMcpServerEnabled(
    serverId: string,
    enabled: boolean,
  ): Promise<ExternalMcpServerSummary[]> {
    return this.requestExternalMcp({
      requestId: createMessageId(),
      command: WS_COMMANDS.EXTERNAL_MCP_SET_ENABLED,
      sentAt: new Date().toISOString(),
      payload: { serverId, enabled },
    });
  }

  async setExternalMcpServerReadOnlyTrust(
    serverId: string,
    trusted: boolean,
  ): Promise<ExternalMcpServerSummary[]> {
    return this.requestExternalMcp({
      requestId: createMessageId(),
      command: WS_COMMANDS.EXTERNAL_MCP_SET_READ_ONLY_TRUST,
      sentAt: new Date().toISOString(),
      payload: { serverId, trusted },
    });
  }

  async setExternalMcpServerAutoApprove(
    serverId: string,
    enabled: boolean,
  ): Promise<ExternalMcpServerSummary[]> {
    return this.requestExternalMcp({
      requestId: createMessageId(),
      command: WS_COMMANDS.EXTERNAL_MCP_SET_AUTO_APPROVE,
      sentAt: new Date().toISOString(),
      payload: { serverId, enabled },
    });
  }

  async setExternalMcpToolPolicy(
    serverId: string,
    toolName: string,
    patch: { enabled?: boolean; approval?: "inherit" | "ask" | "auto" },
  ): Promise<ExternalMcpServerSummary[]> {
    return this.requestExternalMcp({
      requestId: createMessageId(),
      command: WS_COMMANDS.EXTERNAL_MCP_SET_TOOL_POLICY,
      sentAt: new Date().toISOString(),
      payload: { serverId, toolName, ...patch },
    });
  }

  async testExternalMcpServer(
    serverId: string,
  ): Promise<ExternalMcpServerSummary[]> {
    return this.requestExternalMcp({
      requestId: createMessageId(),
      command: WS_COMMANDS.EXTERNAL_MCP_TEST,
      sentAt: new Date().toISOString(),
      payload: { serverId },
    });
  }

  private async requestExternalMcp(
    message: Extract<
      PluginToMcpMessage,
      {
        command:
          | typeof WS_COMMANDS.EXTERNAL_MCP_LIST
          | typeof WS_COMMANDS.EXTERNAL_MCP_UPSERT
          | typeof WS_COMMANDS.EXTERNAL_MCP_REMOVE
          | typeof WS_COMMANDS.EXTERNAL_MCP_SET_ENABLED
          | typeof WS_COMMANDS.EXTERNAL_MCP_SET_READ_ONLY_TRUST
          | typeof WS_COMMANDS.EXTERNAL_MCP_SET_AUTO_APPROVE
          | typeof WS_COMMANDS.EXTERNAL_MCP_SET_TOOL_POLICY
          | typeof WS_COMMANDS.EXTERNAL_MCP_TEST;
      }
    >,
  ): Promise<ExternalMcpServerSummary[]> {
    await this.waitUntilOpen();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Daemon 未连接，无法管理外部 MCP。");
    }
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pendingExternalMcpRequests.delete(message.requestId);
        reject(new Error("外部 MCP 操作超时。"));
      }, 65_000);
      this.pendingExternalMcpRequests.set(message.requestId, {
        resolve: (payload) => {
          if (payload.ok) {
            resolve(payload.servers);
          } else {
            reject(new Error(payload.error));
          }
        },
        reject,
        timeout,
      });
      this.socket?.send(JSON.stringify(message));
    });
  }

  setTaskContext(
    taskId: string,
    egressDestinations: string[],
    binding?: {
      conversationId: string;
      target: { tabId: number; targetId?: string };
    },
  ): void {
    this.taskContext = taskId.trim()
      ? {
          taskId: taskId.trim(),
          ...(binding
            ? {
                conversationId: binding.conversationId,
                target: binding.target,
              }
            : {}),
          egressDestinations: [...new Set(egressDestinations)].sort(),
        }
      : null;
  }

  revokeTaskGrant(taskId: string, reason: string): void {
    if (!taskId.trim()) {
      return;
    }
    this.send({
      requestId: createMessageId(),
      command: WS_COMMANDS.TASK_GRANT_REVOKE,
      sentAt: new Date().toISOString(),
      payload: { taskId: taskId.trim(), reason },
    });
  }

  async callMcpTool(
    toolName: string,
    args: Record<string, unknown>,
    options: McpCallOptions = {},
  ): Promise<unknown> {
    if (options.signal?.aborted) {
      throw browserAbortError(options.signal);
    }
    await this.waitUntilOpen(toolName);
    if (options.signal?.aborted) {
      throw browserAbortError(options.signal);
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("MCP Server 未连接，请先启动 ws://127.0.0.1:17321。");
    }

    const requestId = createMessageId();
    const deadlineAt =
      options.deadlineAt ??
      (options.waitForApproval
        ? undefined
        : new Date(Date.now() + 120_000).toISOString());
    const deadlineTimeout = deadlineAt
      ? Date.parse(deadlineAt) - Date.now()
      : undefined;
    if (
      deadlineTimeout !== undefined &&
      (!Number.isFinite(deadlineTimeout) || deadlineTimeout <= 0)
    ) {
      throw new Error(
        `REQUEST_DEADLINE_EXCEEDED: invalid or expired deadline for ${toolName}`,
      );
    }
    const message: PluginToMcpMessage = {
      requestId,
      command: WS_COMMANDS.MCP_TOOL_CALL,
      sentAt: new Date().toISOString(),
      ...(deadlineAt ? { deadlineAt } : {}),
      ...(options.idempotencyKey
        ? { idempotencyKey: options.idempotencyKey }
        : {}),
      payload: {
        call: {
          toolName,
          args,
        },
        ...(!options.skipTaskContext &&
        (options.taskContext ?? this.taskContext)
          ? { taskContext: options.taskContext ?? this.taskContext ?? undefined }
          : {}),
      },
    };

    return new Promise((resolve, reject) => {
      const timeout =
        deadlineTimeout === undefined
          ? undefined
          : window.setTimeout(() => {
              const pending = this.pendingMcpToolCalls.get(requestId);
              pending?.cleanup?.();
              this.pendingMcpToolCalls.delete(requestId);
              reject(new Error(`REQUEST_DEADLINE_EXCEEDED: ${toolName}`));
              this.sendRequestCancel(
                requestId,
                "Sidepanel MCP deadline exceeded.",
              );
            }, deadlineTimeout);

      const abort = () => {
        const pending = this.pendingMcpToolCalls.get(requestId);
        if (!pending) {
          return;
        }
        if (pending.timeout !== undefined) {
          window.clearTimeout(pending.timeout);
        }
        pending.cleanup?.();
        this.pendingMcpToolCalls.delete(requestId);
        pending.reject(browserAbortError(options.signal));
        this.sendRequestCancel(requestId, "Agent cancelled the MCP request.");
      };
      options.signal?.addEventListener("abort", abort, { once: true });

      this.pendingMcpToolCalls.set(requestId, {
        resolve,
        reject,
        timeout,
        toolName,
        cleanup: options.signal
          ? () => options.signal?.removeEventListener("abort", abort)
          : undefined,
      });
      this.socket?.send(JSON.stringify(message));
    });
  }

  async runDaemonAgentSession(
    payload: DaemonAgentStartPayload,
    handlers: DaemonAgentHandlers,
    signal?: AbortSignal,
  ): Promise<DaemonAgentCompletionResult> {
    if (signal?.aborted) {
      throw browserAbortError(signal);
    }
    await this.waitUntilOpen();
    if (signal?.aborted) {
      throw browserAbortError(signal);
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Daemon 未连接，无法启动后台 Agent。");
    }
    if (this.activeDaemonAgentRuns.has(payload.runId)) {
      throw new Error(`AGENT_RUN_DUPLICATE: ${payload.runId}`);
    }
    const requestId = createMessageId();
    const wirePayload: DaemonAgentStartPayload = {
      ...payload,
      messages: toDaemonAgentMessages(payload.messages),
    };
    const message: PluginToMcpMessage = {
      requestId,
      command: WS_COMMANDS.DAEMON_AGENT_START,
      sentAt: new Date().toISOString(),
      payload: wirePayload,
    };

    return new Promise((resolve, reject) => {
      const abort = () => {
        this.markDaemonAgentStartAccepted(payload.runId);
        this.requestDaemonAgentCancellation(
          payload.runId,
          "Sidepanel requested cancellation.",
        );
      };
      signal?.addEventListener("abort", abort, { once: true });
      const cleanup = signal
        ? () => signal.removeEventListener("abort", abort)
        : undefined;
      this.activeDaemonAgentRuns.set(payload.runId, {
        conversationId: payload.conversationId,
        handlers,
        resolve,
        reject,
        cleanup,
        signal,
      });
      const timeout = window.setTimeout(() => {
        this.pendingDaemonAgentStarts.delete(requestId);
        const active = this.activeDaemonAgentRuns.get(payload.runId);
        if (!active) {
          return;
        }
        active.terminalError = new Error(
          "启动 daemon Agent 超时；已请求 daemon 取消并核对旧任务状态。",
        );
        this.requestDaemonAgentCancellation(
          payload.runId,
          "Daemon Agent start acknowledgement timed out.",
        );
      }, this.daemonAgentStartTimeoutMs);
      this.pendingDaemonAgentStarts.set(requestId, {
        runId: payload.runId,
        reject,
        timeout,
      });
      this.socket?.send(JSON.stringify(message));
    });
  }

  cancelDaemonAgentRun(
    runId: string,
    conversationId: string,
    reason = "Sidepanel requested cancellation.",
  ): void {
    const active = this.activeDaemonAgentRuns.get(runId);
    if (active?.conversationId === conversationId) {
      this.markDaemonAgentStartAccepted(runId);
      this.requestDaemonAgentCancellation(runId, reason);
      return;
    }
    this.send({
      requestId: createMessageId(),
      command: WS_COMMANDS.DAEMON_AGENT_CANCEL,
      sentAt: new Date().toISOString(),
      payload: { runId, conversationId, reason },
    });
  }

  private requestDaemonAgentCancellation(runId: string, reason: string): void {
    const active = this.activeDaemonAgentRuns.get(runId);
    if (!active || active.cancelRequestId) {
      return;
    }
    active.cancelReason = reason;
    if (active.cancelRetryTimer !== undefined) {
      window.clearTimeout(active.cancelRetryTimer);
      active.cancelRetryTimer = undefined;
    }
    const requestId = createMessageId();
    active.cancelRequestId = requestId;
    const timeout = window.setTimeout(() => {
      this.pendingDaemonAgentCancels.delete(requestId);
      const current = this.activeDaemonAgentRuns.get(runId);
      if (!current || current.cancelRequestId !== requestId) {
        return;
      }
      current.cancelRequestId = undefined;
      if (this.isConnected()) {
        this.requestDaemonAgentCancellation(
          runId,
          current.cancelReason ?? reason,
        );
      }
    }, this.daemonAgentCancelRetryMs);
    this.pendingDaemonAgentCancels.set(requestId, { runId, timeout });
    this.send({
      requestId,
      command: WS_COMMANDS.DAEMON_AGENT_CANCEL,
      sentAt: new Date().toISOString(),
      payload: {
        runId,
        conversationId: active.conversationId,
        reason,
      },
    });
  }

  private resetDaemonAgentCancelRequestsForReconnect(): void {
    const staleRequestIds = new Set(this.pendingDaemonAgentCancels.keys());
    for (const pending of this.pendingDaemonAgentCancels.values()) {
      window.clearTimeout(pending.timeout);
      const active = this.activeDaemonAgentRuns.get(pending.runId);
      if (active) {
        active.cancelRequestId = undefined;
      }
    }
    this.pendingDaemonAgentCancels.clear();
    for (const active of this.activeDaemonAgentRuns.values()) {
      if (active.cancelRetryTimer !== undefined) {
        window.clearTimeout(active.cancelRetryTimer);
        active.cancelRetryTimer = undefined;
      }
    }
    this.queue = this.queue.filter(
      (message) =>
        message.command !== WS_COMMANDS.DAEMON_AGENT_CANCEL ||
        !staleRequestIds.has(message.requestId),
    );
  }

  private reconcileDaemonAgentCancellations(): void {
    for (const [runId, active] of this.activeDaemonAgentRuns) {
      if (!active.cancelReason || active.cancelRequestId) {
        continue;
      }
      this.requestDaemonAgentCancellation(runId, active.cancelReason);
    }
  }

  private settleDaemonAgentRun(
    runId: string,
    result?: DaemonAgentCompletionResult,
    error?: Error,
  ): void {
    const active = this.activeDaemonAgentRuns.get(runId);
    if (!active) {
      return;
    }
    this.markDaemonAgentStartAccepted(runId);
    for (const [requestId, pending] of this.pendingDaemonAgentCancels) {
      if (pending.runId !== runId) {
        continue;
      }
      window.clearTimeout(pending.timeout);
      this.pendingDaemonAgentCancels.delete(requestId);
    }
    if (active.cancelRetryTimer !== undefined) {
      window.clearTimeout(active.cancelRetryTimer);
    }
    if (active.pendingBudgetRequestId) {
      active.handlers.onBudgetExtensionCancelled?.(
        active.pendingBudgetRequestId,
      );
    }
    active.cleanup?.();
    this.activeDaemonAgentRuns.delete(runId);
    const terminalError = active.terminalError ?? error;
    if (terminalError) {
      active.reject(terminalError);
      return;
    }
    if (result) {
      active.resolve(result);
      return;
    }
    active.reject(
      browserAbortError(active.signal),
    );
  }

  private sendRequestCancel(targetRequestId: string, reason: string): void {
    this.send({
      requestId: createMessageId(),
      command: WS_COMMANDS.REQUEST_CANCEL,
      sentAt: new Date().toISOString(),
      payload: { targetRequestId, reason },
    });
  }

  async listMcpTools(options: {
    includeLocal?: boolean;
    includeExternal?: boolean;
    externalServerIds?: string[];
  } = {}): Promise<McpAvailableTool[]> {
    await this.waitUntilOpen();

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("MCP Server 未连接，请先启动 ws://127.0.0.1:17321。");
    }

    const requestId = createMessageId();
    const message: PluginToMcpMessage = {
      requestId,
      command: WS_COMMANDS.MCP_LIST_TOOLS,
      sentAt: new Date().toISOString(),
      payload: {
        includeLocal: options.includeLocal ?? true,
        includeExternal: options.includeExternal ?? true,
        ...(options.externalServerIds?.length
          ? { externalServerIds: options.externalServerIds }
          : {}),
      },
    };

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pendingMcpToolListRequests.delete(requestId);
        reject(new Error("MCP tool list timed out."));
      }, 15000);

      this.pendingMcpToolListRequests.set(requestId, {
        resolve,
        reject,
        timeout,
      });

      this.socket?.send(JSON.stringify(message));
    });
  }

  sendElementSelected(payload: ElementSelectedPayload): void {
    this.send({
      requestId: createMessageId(),
      command: WS_COMMANDS.ELEMENT_SELECTED,
      sentAt: new Date().toISOString(),
      payload: {
        activeTab: sanitizeActiveTabForMcp(payload.activeTab),
        selectedElement: sanitizeElementForMcp(payload.selectedElement),
      },
    });
  }

  sendPluginChatMessage(message: PluginChatMessageSnapshot): void {
    this.send({
      requestId: createMessageId(),
      command: WS_COMMANDS.PLUGIN_CHAT_MESSAGE_CREATED,
      sentAt: new Date().toISOString(),
      payload: {
        message,
      },
    });
  }

  startPluginConversation(conversationId: string): void {
    this.send({
      requestId: createMessageId(),
      command: WS_COMMANDS.PLUGIN_CONVERSATION_STARTED,
      sentAt: new Date().toISOString(),
      payload: {
        conversationId,
        startedAt: new Date().toISOString(),
      },
    });
  }

  sendAgentSession(session: AgentSessionSnapshot): void {
    this.send({
      requestId: createMessageId(),
      command: WS_COMMANDS.AGENT_SESSION_SYNC,
      sentAt: new Date().toISOString(),
      payload: {
        session,
      },
    });
  }

  sendCollaborationItem(item: CollaborationItemInput): void {
    this.send({
      requestId: createMessageId(),
      command: WS_COMMANDS.COLLABORATION_ITEM_UPSERT,
      sentAt: new Date().toISOString(),
      payload: { item: sanitizeCollaborationItemInput(item) },
    });
  }

  sendPageContext(
    activeTab: ActiveTabSnapshot,
    pageContext: PageSnapshot,
  ): void {
    this.send({
      requestId: createMessageId(),
      command: WS_COMMANDS.PAGE_CONTEXT_UPDATED,
      sentAt: new Date().toISOString(),
      payload: {
        activeTab: sanitizeActiveTabForMcp(activeTab),
        pageContext: sanitizePageSnapshotForMcp(pageContext),
      },
    });
  }

  sendScreenshot(screenshot: ScreenshotSnapshot): void {
    this.send({
      requestId: createMessageId(),
      command: WS_COMMANDS.SCREENSHOT_CAPTURED,
      sentAt: new Date().toISOString(),
      payload: {
        screenshot: sanitizeScreenshotForMcp(screenshot),
      },
    });
  }

  private send(message: PluginToMcpMessage): void {
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      this.authenticatedSocket === this.socket
    ) {
      this.socket.send(JSON.stringify(message));
      return;
    }

    this.queue.push(message);
    this.queue = this.queue.slice(-50);
    this.connect();
  }

  private async sendClientHello(
    socket: WebSocket,
    clientRole: "ui" | "observer",
    clientName?: string,
  ): Promise<void> {
    const [installationId, bridgeToken] = await Promise.all([
      getInstallationId(),
      getBridgeToken(),
    ]);
    if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const message: PluginToMcpMessage = {
      requestId: createMessageId(),
      command: WS_COMMANDS.CLIENT_HELLO,
      sentAt: new Date().toISOString(),
      payload: {
        protocolVersion: WS_PROTOCOL_VERSION,
        buildId: RUNTIME_BUILD_ID,
        schemaHash: RUNTIME_SCHEMA_HASH,
        clientRole,
        clientName,
        installationId,
        sessionId: installationId,
        bridgeToken,
      },
    };
    socket.send(JSON.stringify(message));
  }

  private async handleServerMessage(
    raw: unknown,
    socket: WebSocket,
  ): Promise<void> {
    const failedAck = parseFailedProtocolAck(raw);
    if (failedAck) {
      const pendingStart = this.pendingDaemonAgentStarts.get(
        failedAck.requestId,
      );
      if (pendingStart) {
        window.clearTimeout(pendingStart.timeout);
        this.pendingDaemonAgentStarts.delete(failedAck.requestId);
        const error = new Error(
          `Daemon Agent 启动请求被拒绝：${failedAck.error}`,
        );
        if (this.activeDaemonAgentRuns.has(pendingStart.runId)) {
          this.settleDaemonAgentRun(pendingStart.runId, undefined, error);
        } else {
          pendingStart.reject(error);
        }
        return;
      }
    }
    const handshakeFailure = parseRuntimeHandshakeFailure(raw);
    if (handshakeFailure) {
      this.lastConnectionFailure = handshakeFailure;
      return;
    }
    const message = parseServerMessage(raw);
    if (!message) {
      return;
    }

    if (message.command === WS_COMMANDS.SERVER_WELCOME) {
      const identityMismatch = runtimeIdentityMismatch(message.payload);
      if (
        this.socket !== socket ||
        message.payload.protocolVersion !== WS_PROTOCOL_VERSION ||
        identityMismatch !== undefined ||
        message.payload.assignedRole !== "ui"
      ) {
        socket.close(1002, "PROTOCOL_NEGOTIATION_FAILED");
        return;
      }
      this.reconnectAttempt = 0;
      this.lastConnectionFailure = null;
      this.authenticatedSocket = socket;
      this.connectionId = message.payload.connectionId;
      this.startHeartbeat(socket, message.payload.sessionId);
      this.flushQueue();
      this.reconcileDaemonAgentCancellations();
      return;
    }

    if (message.command === WS_COMMANDS.MCP_TOOL_RESULT) {
      this.resolveMcpToolCall(message.requestId, message.payload);
      return;
    }

    if (message.command === WS_COMMANDS.DAEMON_AGENT_START_RESULT) {
      const pending = this.pendingDaemonAgentStarts.get(message.requestId);
      if (pending) {
        window.clearTimeout(pending.timeout);
        this.pendingDaemonAgentStarts.delete(message.requestId);
        if (!message.payload.ok) {
          const error = new Error(message.payload.error);
          if (this.activeDaemonAgentRuns.has(pending.runId)) {
            this.settleDaemonAgentRun(pending.runId, undefined, error);
          } else {
            pending.reject(error);
          }
        }
      }
      return;
    }

    if (message.command === WS_COMMANDS.DAEMON_AGENT_CANCEL_RESULT) {
      this.handleDaemonAgentCancelResult(
        message.requestId,
        message.payload,
      );
      return;
    }

    if (message.command === WS_COMMANDS.DAEMON_AGENT_EVENT) {
      this.handleDaemonAgentEvent(message.payload);
      return;
    }

    if (message.command === WS_COMMANDS.AGENT_SESSION_SYNC) {
      this.handleDaemonAgentSessionSync(message.payload.session);
      return;
    }

    if (message.command === WS_COMMANDS.MCP_LIST_TOOLS_RESULT) {
      this.resolveMcpToolListRequest(message.requestId, message.payload);
      return;
    }

    if (message.command === WS_COMMANDS.EXTERNAL_MCP_RESULT) {
      const pending = this.pendingExternalMcpRequests.get(message.requestId);
      if (pending) {
        window.clearTimeout(pending.timeout);
        this.pendingExternalMcpRequests.delete(message.requestId);
        pending.resolve(message.payload);
      }
      return;
    }

    if (message.command === WS_COMMANDS.LOCAL_UPDATE_CHECK_RESULT) {
      const pending = this.pendingLocalUpdateChecks.get(message.requestId);
      if (pending) {
        window.clearTimeout(pending.timeout);
        this.pendingLocalUpdateChecks.delete(message.requestId);
        pending.resolve(message.payload);
      }
      return;
    }

    if (message.command === WS_COMMANDS.LOCAL_UPDATE_RESULT) {
      const pending = this.pendingLocalUpdates.get(message.requestId);
      if (pending) {
        window.clearTimeout(pending.timeout);
        this.pendingLocalUpdates.delete(message.requestId);
        pending.resolve(message.payload);
      }
      return;
    }

    if (message.command === WS_COMMANDS.LOCAL_SERVICE_STATUS_RESULT) {
      const pending = this.pendingLocalServiceStatus.get(message.requestId);
      if (pending) {
        window.clearTimeout(pending.timeout);
        this.pendingLocalServiceStatus.delete(message.requestId);
        pending.resolve(message.payload);
      }
      return;
    }

    if (message.command === WS_COMMANDS.LOCAL_SERVICE_SET_RESULT) {
      const pending = this.pendingLocalServiceSet.get(message.requestId);
      if (pending) {
        window.clearTimeout(pending.timeout);
        this.pendingLocalServiceSet.delete(message.requestId);
        pending.resolve(message.payload);
      }
      return;
    }

    if (message.command === WS_COMMANDS.APPROVAL_REQUEST) {
      this.enqueueApproval(message.payload);
      return;
    }

    if (message.command === WS_COMMANDS.APPROVAL_CANCELLED) {
      this.cancelledApprovalIds.add(message.payload.approvalId);
      this.approvalCancellationHandler?.(message.payload);
      return;
    }

    if (message.command === WS_COMMANDS.BROWSER_TOOL_CALL) {
      await this.executeBrowserToolForServer(message);
    }
  }

  private enqueueApproval(request: ApprovalRequestPayload): void {
    void this.resolveApprovalRequest(request)
      .catch(() => undefined);
  }

  private handleDaemonAgentEvent(event: DaemonAgentEventPayload): void {
    this.markDaemonAgentStartAccepted(event.runId);
    const active = this.activeDaemonAgentRuns.get(event.runId);
    if (!active || active.conversationId !== event.conversationId) {
      return;
    }
    switch (event.kind) {
      case "visible_content":
        active.handlers.onVisibleContent(event.content);
        return;
      case "status":
        active.handlers.onStatusUpdate?.(event.status);
        return;
      case "session":
        active.handlers.onSessionUpdate?.(event.session);
        return;
      case "tool_message":
        active.handlers.onToolMessage?.(event.message);
        return;
      case "context_usage":
        active.handlers.onContextUsage?.(event.report);
        return;
      case "budget_request":
        void this.resolveDaemonAgentBudgetRequest(event);
        return;
      case "completed":
        this.settleDaemonAgentRun(event.runId, event.result);
        return;
      case "failed":
        this.settleDaemonAgentRun(
          event.runId,
          undefined,
          new Error(event.error),
        );
        return;
    }
  }

  private handleDaemonAgentCancelResult(
    requestId: string,
    payload: Extract<
      McpToPluginMessage,
      { command: typeof WS_COMMANDS.DAEMON_AGENT_CANCEL_RESULT }
    >["payload"],
  ): void {
    const pending = this.pendingDaemonAgentCancels.get(requestId);
    if (!pending || pending.runId !== payload.runId) {
      return;
    }
    window.clearTimeout(pending.timeout);
    this.pendingDaemonAgentCancels.delete(requestId);
    const active = this.activeDaemonAgentRuns.get(payload.runId);
    if (!active || active.conversationId !== payload.conversationId) {
      return;
    }
    if (active.cancelRequestId === requestId) {
      active.cancelRequestId = undefined;
    }
    this.markDaemonAgentStartAccepted(payload.runId);
    if (payload.session) {
      this.handleDaemonAgentSessionSync(payload.session);
    }
    const current = this.activeDaemonAgentRuns.get(payload.runId);
    if (!current) {
      return;
    }
    if (!payload.accepted) {
      this.settleDaemonAgentRun(payload.runId);
      return;
    }
    current.cancelRetryTimer = window.setTimeout(() => {
      const latest = this.activeDaemonAgentRuns.get(payload.runId);
      if (!latest) {
        return;
      }
      latest.cancelRetryTimer = undefined;
      this.requestDaemonAgentCancellation(
        payload.runId,
        latest.cancelReason ?? "Sidepanel requested cancellation.",
      );
    }, this.daemonAgentCancelRetryMs);
  }

  private async resolveDaemonAgentBudgetRequest(
    event: Extract<DaemonAgentEventPayload, { kind: "budget_request" }>,
  ): Promise<void> {
    const active = this.activeDaemonAgentRuns.get(event.runId);
    if (!active || active.conversationId !== event.conversationId) {
      return;
    }
    const handler = active.handlers.onBudgetExtensionRequest;
    if (!handler) {
      this.cancelDaemonAgentRun(
        event.runId,
        event.conversationId,
        "Agent reached a safety budget but no confirmation UI is available.",
      );
      return;
    }
    active.pendingBudgetRequestId = event.budgetRequestId;
    const decision = await handler({
      ...event.request,
      budgetRequestId: event.budgetRequestId,
      runId: event.runId,
      conversationId: event.conversationId,
    });
    const current = this.activeDaemonAgentRuns.get(event.runId);
    if (!current || current !== active) {
      return;
    }
    if (current.pendingBudgetRequestId !== event.budgetRequestId) {
      return;
    }
    current.pendingBudgetRequestId = undefined;
    const payload: DaemonAgentBudgetDecisionPayload = {
      runId: event.runId,
      conversationId: event.conversationId,
      budgetRequestId: event.budgetRequestId,
      decision,
    };
    this.send({
      requestId: createMessageId(),
      command: WS_COMMANDS.DAEMON_AGENT_BUDGET_DECISION,
      sentAt: new Date().toISOString(),
      payload,
    });
  }

  private handleDaemonAgentSessionSync(session: AgentSessionSnapshot): void {
    const active = this.activeDaemonAgentRuns.get(session.id);
    if (!active) {
      return;
    }
    this.markDaemonAgentStartAccepted(session.id);
    active.handlers.onSessionUpdate?.(session);
    if (session.visibleContent) {
      active.handlers.onVisibleContent(session.visibleContent);
    }
    const result = daemonAgentResultFromSession(session);
    if (!result) {
      return;
    }
    this.settleDaemonAgentRun(session.id, result);
  }

  private markDaemonAgentStartAccepted(runId: string): void {
    for (const [requestId, pending] of this.pendingDaemonAgentStarts) {
      if (pending.runId !== runId) {
        continue;
      }
      window.clearTimeout(pending.timeout);
      this.pendingDaemonAgentStarts.delete(requestId);
    }
  }

  private async resolveApprovalRequest(
    request: ApprovalRequestPayload,
  ): Promise<void> {
    if (this.cancelledApprovalIds.delete(request.approvalId)) {
      return;
    }
    let decision: ApprovalHandlerResult = { approved: false };
    try {
      decision = this.approvalHandler
        ? await this.approvalHandler(request)
        : { approved: false };
    } catch {
      decision = { approved: false };
    }
    if (this.cancelledApprovalIds.delete(request.approvalId)) {
      return;
    }
    this.send({
      requestId: request.approvalId,
      command: WS_COMMANDS.APPROVAL_RESPONSE,
      sentAt: new Date().toISOString(),
      payload: {
        approvalId: request.approvalId,
        ...decision,
        respondedAt: new Date().toISOString(),
      },
    });
  }

  private resolveMcpToolListRequest(
    requestId: string,
    payload: McpListToolsResultPayload,
  ): void {
    const pending = this.pendingMcpToolListRequests.get(requestId);
    if (!pending) {
      return;
    }

    this.pendingMcpToolListRequests.delete(requestId);
    if (pending.timeout !== undefined) {
      window.clearTimeout(pending.timeout);
    }

    if (payload.ok) {
      pending.resolve(payload.tools);
      return;
    }

    pending.reject(new Error(payload.error));
  }

  private resolveMcpToolCall(
    requestId: string,
    payload: McpToolResultPayload,
  ): void {
    const pending = this.pendingMcpToolCalls.get(requestId);
    if (!pending) {
      return;
    }

    this.pendingMcpToolCalls.delete(requestId);
    if (pending.timeout !== undefined) {
      window.clearTimeout(pending.timeout);
    }
    pending.cleanup?.();

    if (payload.ok) {
      pending.resolve(payload.data);
      return;
    }

    pending.reject(new Error(payload.error));
  }

  private async executeBrowserToolForServer(
    message: Extract<
      McpToPluginMessage,
      { command: typeof WS_COMMANDS.BROWSER_TOOL_CALL }
    >,
  ): Promise<void> {
    this.sendBrowserToolResult(message.requestId, {
      ok: false,
      errorCode: "ROLE_FORBIDDEN",
      error:
        "Sidepanel UI cannot execute daemon browser calls; the background browser executor must validate the execution grant.",
    });
  }

  private sendBrowserToolResult(
    requestId: string,
    payload: BrowserToolResultPayload,
  ): void {
    this.send({
      requestId,
      command: WS_COMMANDS.BROWSER_TOOL_RESULT,
      sentAt: new Date().toISOString(),
      payload,
    });
  }

  private waitUntilOpen(toolName?: string): Promise<void> {
    this.connect();
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      this.authenticatedSocket === this.socket
    ) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const tick = () => {
        if (
          this.socket?.readyState === WebSocket.OPEN &&
          this.authenticatedSocket === this.socket
        ) {
          resolve();
          return;
        }

        if (Date.now() - startedAt > MCP_CONNECT_WAIT_MS) {
          reject(
            this.lastConnectionFailure
              ? new Error(this.lastConnectionFailure)
              : toolName
              ? new McpToolTransportError({ toolName, phase: "connect" })
              : new Error(
                  "MCP Server 未连接，请先启动 ws://127.0.0.1:17321。",
                ),
          );
          return;
        }

        window.setTimeout(tick, 60);
      };

      tick();
    });
  }

  private flushQueue(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    for (const message of this.queue) {
      this.socket.send(JSON.stringify(message));
    }
    this.queue = [];
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }

    const delayMs = getReconnectDelayMs(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private startHeartbeat(socket: WebSocket, sessionId?: string): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (
        this.socket !== socket ||
        this.authenticatedSocket !== socket ||
        socket.readyState !== WebSocket.OPEN
      ) {
        return;
      }
      const message: PluginToMcpMessage = {
        requestId: createMessageId(),
        command: WS_COMMANDS.HEARTBEAT,
        sentAt: new Date().toISOString(),
        payload: { ...(sessionId ? { sessionId } : {}) },
      };
      socket.send(JSON.stringify(message));
    }, WS_HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private rejectPendingMcpToolCalls(
    createError: (toolName: string) => Error,
  ): void {
    for (const [requestId, pending] of this.pendingMcpToolCalls.entries()) {
      if (pending.timeout !== undefined) {
        window.clearTimeout(pending.timeout);
      }
      pending.cleanup?.();
      pending.reject(createError(pending.toolName));
      this.pendingMcpToolCalls.delete(requestId);
    }
  }

  private rejectPendingMcpToolListRequests(message: string): void {
    for (const [
      requestId,
      pending,
    ] of this.pendingMcpToolListRequests.entries()) {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error(message));
      this.pendingMcpToolListRequests.delete(requestId);
    }
  }

  private rejectPendingExternalMcpRequests(message: string): void {
    for (const [requestId, pending] of this.pendingExternalMcpRequests) {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error(message));
      this.pendingExternalMcpRequests.delete(requestId);
    }
  }
}

function parseServerMessage(raw: unknown): McpToPluginMessage | null {
  try {
    const parsed = JSON.parse(String(raw)) as Partial<McpToPluginMessage>;
    if (
      typeof parsed.requestId === "string" &&
      typeof parsed.command === "string" &&
      "payload" in parsed &&
      (parsed.command === WS_COMMANDS.MCP_LIST_TOOLS_RESULT ||
        parsed.command === WS_COMMANDS.SERVER_WELCOME ||
        parsed.command === WS_COMMANDS.MCP_TOOL_RESULT ||
        parsed.command === WS_COMMANDS.EXTERNAL_MCP_RESULT ||
        parsed.command === WS_COMMANDS.LOCAL_UPDATE_CHECK_RESULT ||
        parsed.command === WS_COMMANDS.LOCAL_UPDATE_RESULT ||
        parsed.command === WS_COMMANDS.LOCAL_SERVICE_STATUS_RESULT ||
        parsed.command === WS_COMMANDS.LOCAL_SERVICE_SET_RESULT ||
        parsed.command === WS_COMMANDS.AGENT_SESSION_SYNC ||
        parsed.command === WS_COMMANDS.DAEMON_AGENT_START_RESULT ||
        parsed.command === WS_COMMANDS.DAEMON_AGENT_CANCEL_RESULT ||
        parsed.command === WS_COMMANDS.DAEMON_AGENT_EVENT ||
        parsed.command === WS_COMMANDS.APPROVAL_REQUEST ||
        parsed.command === WS_COMMANDS.APPROVAL_CANCELLED ||
        parsed.command === WS_COMMANDS.BROWSER_TOOL_CALL ||
        parsed.command === WS_COMMANDS.BROWSER_TOOL_RESULT)
    ) {
      return parsed as McpToPluginMessage;
    }
    return null;
  } catch {
    return null;
  }
}

export const mcpBridge = new McpBridge();

function browserAbortError(signal: AbortSignal | undefined): Error {
  return toAbortError(
    signal,
    "REQUEST_CANCELLED: Agent cancelled the MCP request.",
  );
}

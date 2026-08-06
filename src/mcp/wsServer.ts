import { spawn, spawnSync } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { PageSnapshot, ScreenshotCaptureResult } from "../shared/dom";
import type { AgentSessionSnapshot } from "../shared/agentSession";
import type {
  DaemonAgentEventPayload,
  DaemonAgentStartPayload,
} from "../shared/daemonAgent";
import { createMessageId } from "../shared/messaging";
import {
  isExposedMcpToolName,
  MCP_TOOL_NAMES,
  normalizeMcpToolName,
} from "../shared/mcpTools";
import {
  normalizeToolCall,
  validateToolCall,
  type AnyToolCall,
} from "../shared/tools";
import {
  getToolPolicy,
  type ToolCapability,
  type ToolPolicy,
  type ToolPolicyClass,
} from "../shared/toolPolicy";
import { isDirectMcpStateResource } from "../shared/mcpResources";
import {
  createExecutionGrant,
  hashExecutionArguments,
  EXECUTION_GRANT_VERSION,
  type ExecutionGrantClaims,
} from "../shared/executionGrant";
import {
  assertMcpExecutorBoundary,
  getInternalToolEffect,
  type InternalMutationScope,
} from "../shared/mcpExecutionPolicy";
import { redactApprovalArguments } from "../shared/sensitiveData";
import {
  classifySensitiveEgress,
  serializedEgressPayloadBytes,
  type EgressDestination,
} from "../shared/egressMetrics";
import {
  WS_COMMANDS,
  WS_PROTOCOL_VERSION,
  type ClientHelloPayload,
  type ApprovalResponsePayload,
  type WsClientRole,
  type McpAvailableTool,
  type McpListToolsResultPayload,
  type ExternalMcpResultPayload,
  normalizeBrowserToolResultData,
  type StateGetResultPayload,
  type BrowserToolResultPayload,
  type McpToolResultPayload,
  type ArtifactGetResultPayload,
  type ActiveTabSnapshot,
  type McpToPluginMessage,
  type McpWsAck,
} from "../shared/wsProtocol";
import type {
  ExternalMcpServerConfig,
  ExternalMcpServerSummary,
} from "../shared/externalMcp";
import { isExternalMcpToolName } from "../shared/externalMcp";
import {
  RUNTIME_BUILD_ID,
  RUNTIME_SCHEMA_HASH,
} from "../shared/runtimeIdentity";
import {
  executeMcpToolData,
  listRuntimeMcpTools,
  parseMcpToolArgs,
} from "./toolRuntime";
import { browserStateHub } from "./browserStateHub";
import { readBrowserStateResource } from "./state";
import {
  ExecutionBroker,
  ExecutionBrokerError,
  protocolErrorCode,
} from "../daemon/executionBroker";
import { executeWithExternalCancellation } from "../daemon/externalCancellation";
import { ArtifactStore } from "../daemon/artifacts/store";
import { externalizeLargeJsonResult } from "../daemon/artifacts/externalize";
import { DaemonStateStore } from "../daemon/store/stateStore";
import type { RedactedAuditEvent } from "../daemon/store/stateStore";
import {
  checkLocalUpdate,
  resolveProjectRootFromDaemon,
  runLocalUpdate,
} from "../daemon/localUpdate";
import {
  getLocalServiceStatus,
  setLocalServiceAutostart,
} from "../daemon/localService";
import {
  DaemonAgentRunner,
  type DaemonAgentToolRequest,
} from "../daemon/agentRunner";
import {
  pluginToMcpMessageSchema,
  type ValidPluginToMcpMessage,
} from "./wsSchemas";
import {
  CLIENT_HELLO_TIMEOUT_MS,
  AUTHENTICATED_IDLE_TIMEOUT_MS,
  IDLE_SWEEP_INTERVAL_MS,
  INBOUND_MESSAGE_BYTE_LIMITS,
  MAX_PROTOCOL_VIOLATIONS,
  PROTOCOL_VIOLATION_WINDOW_MS,
  consumeProtocolViolation,
  isCommandAllowedForRole,
  inboundMessageByteLimit,
  utf8MessageByteLength,
  type ProtocolViolationState,
} from "./protocolPolicy";
import {
  ADAPTER_ROUTING_AVAILABLE_TOOLS,
  ADAPTER_ROUTING_TOOL_NAMES,
  isAdapterRoutingToolName,
  parseAdapterRoutingToolArgs,
} from "./adapterRoutingTools";
import {
  COLLABORATION_TOOL_NAMES,
  MCP_COLLABORATION_AVAILABLE_TOOLS,
  SIDEPANEL_COLLABORATION_AVAILABLE_TOOLS,
  isCollaborationToolName,
  parseClaimCollaborationTaskArgs,
  parseCancelCollaborationTaskArgs,
  parseCompleteCollaborationTaskArgs,
  parseDelegateCollaborationTaskArgs,
  parsePublishCollaborationItemArgs,
  parseUpdateCollaborationTaskArgs,
  parseWaitForCollaborationResultArgs,
} from "./collaborationTools";
import {
  claimCollaborationTask,
  cancelCollaborationTask,
  completeCollaborationTask,
  delegateCollaborationTask,
  updateCollaborationTask,
  waitForCollaborationTaskResult,
} from "./collaborationTaskRuntime";
import { resolveWsClientIdentity } from "../shared/wsClientIdentity";
import { wsClientNameForRole } from "../shared/wsClientIdentity";
import {
  TASK_CAPABILITY_GRANT_TTL_MS,
  TASK_CAPABILITY_GRANT_VERSION,
  approvalModeNeedsDecision,
  isTaskGrantEligiblePolicy,
  matchesTaskCapabilityGrant,
  normalizeHttpOrigin,
  normalizeStrings,
  type TaskCapabilityGrant,
} from "../shared/taskCapabilityGrant";
import {
  getTaskExecutionBindingMismatch,
  getTaskTargetSelectionMismatch,
  resolveTaskBindingConversationId,
} from "../shared/taskExecutionBinding";

export interface PluginWebSocketServer {
  close: () => Promise<void>;
  ready: () => Promise<{ host: string; port: number }>;
  connectedClients: () => number;
  connectedPluginClients: () => number;
  callBrowserTool: (
    call: AnyToolCall,
    options?: BrowserToolCallOptions,
  ) => Promise<unknown>;
}

export interface BrowserToolCallOptions {
  signal?: AbortSignal;
  deadlineAt?: string;
  idempotencyKey?: string;
  authorization?: AuthorizationReceipt;
}

interface ToolTaskContext {
  taskId: string;
  conversationId?: string;
  target?: {
    tabId: number;
    targetId?: string;
  };
  egressDestinations: string[];
}

interface AuthorizationReceipt {
  requesterRequestId: string;
  requesterConnectionId: string;
  sessionId: string;
  sourceMcpToolName: string;
  policyClass: ToolPolicyClass;
  mutatesBrowser: boolean;
  revision: number;
  target?: ActiveTabSnapshot;
  approvalRequired: boolean;
  approvalId?: string;
  expiresAt: string;
  pageEffectDispatchAttempted?: boolean;
  timing: {
    transportMs: number;
  };
}

type BrowserToolCaller = (
  call: AnyToolCall,
  options?: BrowserToolCallOptions,
) => Promise<unknown>;

export interface AdditionalMcpToolBackend {
  listTools: (options?: { serverIds?: string[] }) => Promise<McpAvailableTool[]>;
  callTool: (
    toolName: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>;
  getToolPolicy?: (
    toolName: string,
    args: Record<string, unknown>,
  ) => ToolPolicy | undefined;
  getToolOrigin?: (
    toolName: string,
  ) =>
    | {
        externalMcpServerId: string;
        externalMcpServerName: string;
        externalMcpToolName: string;
      }
    | undefined;
  listServers?: ExternalMcpManagementBackend["listServers"];
  upsertServer?: ExternalMcpManagementBackend["upsertServer"];
  removeServer?: ExternalMcpManagementBackend["removeServer"];
  setServerEnabled?: ExternalMcpManagementBackend["setServerEnabled"];
  setServerReadOnlyTrust?: ExternalMcpManagementBackend["setServerReadOnlyTrust"];
  setServerAutoApprove?: ExternalMcpManagementBackend["setServerAutoApprove"];
  setToolPolicy?: ExternalMcpManagementBackend["setToolPolicy"];
  testServer?: ExternalMcpManagementBackend["testServer"];
}

export interface ExternalMcpManagementBackend {
  listServers: () => ExternalMcpServerSummary[];
  upsertServer: (
    server: ExternalMcpServerConfig,
  ) => Promise<ExternalMcpServerSummary[]>;
  removeServer: (serverId: string) => Promise<ExternalMcpServerSummary[]>;
  setServerEnabled: (
    serverId: string,
    enabled: boolean,
  ) => Promise<ExternalMcpServerSummary[]>;
  setServerReadOnlyTrust: (
    serverId: string,
    trusted: boolean,
  ) => Promise<ExternalMcpServerSummary[]>;
  setServerAutoApprove: (
    serverId: string,
    enabled: boolean,
  ) => Promise<ExternalMcpServerSummary[]>;
  setToolPolicy: (
    serverId: string,
    toolName: string,
    patch: { enabled?: boolean; approval?: "inherit" | "ask" | "auto" },
  ) => Promise<ExternalMcpServerSummary[]>;
  testServer: (serverId: string) => Promise<ExternalMcpServerSummary[]>;
}

type ToolAuthorizer = (
  socket: WebSocket,
  toolName: string,
  args: Record<string, unknown>,
  options?: Pick<BrowserToolCallOptions, "signal" | "deadlineAt"> & {
    requestId?: string;
    taskContext?: ToolTaskContext;
  },
) => Promise<AuthorizationReceipt>;

type ApprovalResolver = (
  socket: WebSocket,
  payload: ApprovalResponsePayload,
) => void;

type DaemonAgentCommandHandler = (
  socket: WebSocket,
  message: ValidPluginToMcpMessage,
) => Promise<boolean>;

interface PendingBrowserToolRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  browserSocket: WebSocket;
  sessionId?: string;
  markTransportComplete: () => void;
  cleanup?: () => void;
}

interface PendingApproval {
  allowedSockets: Set<WebSocket>;
  resolve: (response: ApprovalResponsePayload) => void;
  reject: (error: Error) => void;
  cleanup?: () => void;
}

export interface PluginWebSocketServerOptions {
  bridgeToken?: string;
  allowedExtensionIds?: readonly string[];
  artifactStore?: ArtifactStore;
  stateStore?: DaemonStateStore;
  helloTimeoutMs?: number;
  idleTimeoutMs?: number;
  idleSweepIntervalMs?: number;
  clock?: () => number;
  createId?: () => string;
}

const PROTOCOL_LIMITS = {
  maxFrameBytes: 8 * 1024 * 1024,
  maxInboundMessageBytes: INBOUND_MESSAGE_BYTE_LIMITS,
  maxConnections: 32,
  maxMessagesPerMinute: 300,
  clientHelloTimeoutMs: CLIENT_HELLO_TIMEOUT_MS,
  protocolViolationWindowMs: PROTOCOL_VIOLATION_WINDOW_MS,
  maxProtocolViolations: MAX_PROTOCOL_VIOLATIONS,
  idleTimeoutMs: AUTHENTICATED_IDLE_TIMEOUT_MS,
  maxPendingBrowserTools: 128,
  maxPendingApprovals: 64,
  maxRequestDeadlineMs: 120_000,
} as const;

export function startPluginWebSocketServer(
  port = 17321,
  additionalMcpBackend?: AdditionalMcpToolBackend,
  options: PluginWebSocketServerOptions = {},
): PluginWebSocketServer {
  const clock = options.clock ?? Date.now;
  const createId = options.createId ?? createMessageId;
  const allowedExtensionIds = new Set(
    (options.allowedExtensionIds ?? []).map((extensionId) => {
      const normalized = extensionId.trim().toLowerCase();
      if (!/^[a-p]{32}$/.test(normalized)) {
        throw new Error(
          "allowedExtensionIds contains an invalid Chrome extension ID.",
        );
      }
      return normalized;
    }),
  );
  const nowDate = () => new Date(clock());
  const nowIso = () => nowDate().toISOString();
  const clients = new Set<WebSocket>();
  const clientRoles = new Map<WebSocket, WsClientRole | "unknown">();
  const clientSessionIds = new Map<WebSocket, string>();
  const clientConversationIds = new Map<WebSocket, string>();
  const currentBrowserSockets = new Map<string, WebSocket>();
  const connectionIds = new Map<WebSocket, string>();
  const connectionRates = new Map<
    WebSocket,
    { windowStartedAt: number; messages: number }
  >();
  const protocolViolations = new Map<WebSocket, ProtocolViolationState>();
  const connectionLastActivity = new Map<WebSocket, number>();
  const executionBroker = new ExecutionBroker();
  const daemonAgentRunner = new DaemonAgentRunner();
  const artifactStore = options.artifactStore ?? new ArtifactStore();
  const unsubscribePersistence = options.stateStore
    ? browserStateHub.subscribePersistence((state) => {
        try {
          options.stateStore?.scheduleBrowserState(state);
        } catch (error) {
          console.error(
            `[ai-devtools-daemon] state scheduling failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      })
    : () => undefined;
  const pendingToolRequests = new Map<string, PendingBrowserToolRequest>();
  const pendingApprovals = new Map<string, PendingApproval>();
  const taskCapabilityGrants = new Map<string, TaskCapabilityGrant>();
  let primaryPluginSocket: WebSocket | null = null;
  let primaryBrowserSocket: WebSocket | null = null;
  let resolveReady!: (address: { host: string; port: number }) => void;
  let rejectReady!: (error: Error) => void;
  const readyPromise = new Promise<{ host: string; port: number }>(
    (resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    },
  );
  const wss = new WebSocketServer({
    host: "127.0.0.1",
    port,
    maxPayload: PROTOCOL_LIMITS.maxFrameBytes,
  });
  const cleanupTimer = setInterval(() => {
    browserStateHub.cleanupExpiredSessions();
    cleanupExpiredTaskGrants(taskCapabilityGrants, clock());
    void artifactStore.cleanup().catch((error) => {
      console.error(
        `[ai-devtools-daemon] artifact cleanup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }, 60000);
  const idleTimer = setInterval(() => {
    const now = clock();
    const idleTimeoutMs =
      options.idleTimeoutMs ?? AUTHENTICATED_IDLE_TIMEOUT_MS;
    for (const socket of clients) {
      if (
        (clientRoles.get(socket) ?? "unknown") !== "unknown" &&
        now - (connectionLastActivity.get(socket) ?? now) >= idleTimeoutMs
      ) {
        socket.close(1008, "IDLE_TIMEOUT");
      }
    }
  }, options.idleSweepIntervalMs ?? IDLE_SWEEP_INTERVAL_MS);

  wss.on("connection", (socket, request) => {
    if (clients.size >= PROTOCOL_LIMITS.maxConnections) {
      socket.close(1013, "RATE_LIMITED");
      return;
    }
    clients.add(socket);
    clientRoles.set(socket, "unknown");
    connectionLastActivity.set(socket, clock());
    const connectionId = createId();
    connectionIds.set(socket, connectionId);
    const origin = request.headers.origin;
    const helloTimeout = setTimeout(() => {
      if ((clientRoles.get(socket) ?? "unknown") === "unknown") {
        socket.close(1008, "AUTH_REQUIRED");
      }
    }, options.helloTimeoutMs ?? CLIENT_HELLO_TIMEOUT_MS);

    const reportProtocolViolation = (
      requestId: string,
      error: string,
    ): void => {
      const errorCode = /^[A-Z][A-Z0-9_]{2,}/.exec(error)?.[0] ??
        "PROTOCOL_ERROR";
      console.error(
        `[ai-devtools-daemon] protocol message rejected: role=${
          clientRoles.get(socket) ?? "unknown"
        } code=${errorCode}`,
      );
      sendAck(socket, {
        requestId,
        ok: false,
        receivedAt: nowIso(),
        error,
      });
      const result = consumeProtocolViolation(protocolViolations.get(socket));
      protocolViolations.set(socket, result.state);
      if (result.shouldClose) {
        socket.close(1008, "PROTOCOL_VIOLATION_LIMIT");
      }
    };

    socket.on("message", (raw) => {
      connectionLastActivity.set(socket, clock());
      if (!consumeConnectionMessage(connectionRates, socket)) {
        sendAck(socket, {
          requestId: "rate-limited",
          ok: false,
          receivedAt: nowIso(),
          error: "RATE_LIMITED: too many protocol messages.",
        });
        socket.close(1008, "RATE_LIMITED");
        return;
      }
      handleRawMessage(
        socket,
        raw.toString(),
        clientRoles,
        clientSessionIds,
        (conversationId) => clientConversationIds.set(socket, conversationId),
        () => registerPluginSocket(socket),
        (sessionId) => registerBrowserSocket(socket, sessionId),
        () => replayStateToObserver(socket),
        (message) => broadcastToObservers(socket, message),
        pendingToolRequests,
        taskCapabilityGrants,
        (call, callOptions) =>
          callBrowserTool(call, clientSessionIds.get(socket), callOptions),
        (requestSocket, toolName, args, authorizationOptions) =>
          authorizeTool(requestSocket, toolName, args, authorizationOptions),
        (responseSocket, payload) =>
          resolveApproval(responseSocket, payload),
        origin,
        options.bridgeToken,
        allowedExtensionIds,
        executionBroker,
        connectionId,
        artifactStore,
        options.stateStore,
        reportProtocolViolation,
        additionalMcpBackend,
        (agentSocket, agentMessage) =>
          handleDaemonAgentCommand(agentSocket, agentMessage),
      );
    });

    socket.on("close", () => {
      clearTimeout(helloTimeout);
      clients.delete(socket);
      executionBroker.cancelConnection(
        connectionId,
        "requester connection closed before execution completed.",
      );
      connectionIds.delete(socket);
      clientConversationIds.delete(socket);
      connectionRates.delete(socket);
      protocolViolations.delete(socket);
      connectionLastActivity.delete(socket);
      const role = clientRoles.get(socket);
      const wasPlugin = role === "plugin";
      clientRoles.delete(socket);

      if (primaryPluginSocket === socket) {
        primaryPluginSocket = findLatestPluginSocket();
      }
      if (primaryBrowserSocket === socket) {
        primaryBrowserSocket = findLatestBrowserSocket();
      }

      if (wasPlugin || role === "browser") {
        rejectAllPendingToolRequests(
          pendingToolRequests,
          "Chrome plugin disconnected before the browser tool completed.",
          socket,
        );
      }
      if (wasPlugin || role === "browser") {
        const sessionId = clientSessionIds.get(socket);
        if (role === "browser" && sessionId) {
          if (currentBrowserSockets.get(sessionId) === socket) {
            currentBrowserSockets.delete(sessionId);
          }
          if (!findBrowserSocketForSession(sessionId)) {
            browserStateHub.disconnect("browser", sessionId);
          }
        } else {
          browserStateHub.disconnect("browser", sessionId);
        }
      }
      if (role === "observer" || role === "ui") {
        browserStateHub.disconnect("ui", clientSessionIds.get(socket));
      }
      clientSessionIds.delete(socket);

      if (!findLatestPluginSocket() && !findLatestBrowserSocket()) {
        browserStateHub.disconnect("plugin");
      }
    });

    socket.on("error", () => {
      if (
        clientRoles.get(socket) === "plugin" ||
        clientRoles.get(socket) === "browser"
      ) {
        rejectAllPendingToolRequests(
          pendingToolRequests,
          "Chrome plugin WebSocket connection failed during a browser tool call.",
          socket,
        );
      }
    });
  });

  wss.on("listening", () => {
    const address = wss.address();
    const listeningPort =
      address && typeof address !== "string" ? address.port : port;
    resolveReady({ host: "127.0.0.1", port: listeningPort });
    console.error(
      `[ai-devtools-daemon] WebSocket listening on ws://127.0.0.1:${listeningPort}`,
    );
  });

  wss.on("error", (error) => {
    console.error(
      `[ai-devtools-daemon] WebSocket server error on 127.0.0.1:${port}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    rejectReady(error instanceof Error ? error : new Error(String(error)));
  });

  return {
    ready: () => readyPromise,
    close: async () => {
      daemonAgentRunner.close();
      unsubscribePersistence();
      await new Promise<void>((resolve, reject) => {
        rejectAllPendingToolRequests(
          pendingToolRequests,
          "MCP WebSocket server closed before the browser tool completed.",
        );
        clearInterval(cleanupTimer);
        clearInterval(idleTimer);
        rejectAllPendingApprovals(
          pendingApprovals,
          "Local daemon stopped before approval was resolved.",
        );
        for (const client of clients) {
          client.close();
        }
        wss.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await options.stateStore?.flush();
    },
    connectedClients: () => clients.size,
    connectedPluginClients,
    callBrowserTool: (call, callOptions) =>
      callBrowserTool(call, undefined, callOptions),
  };

  function connectedPluginClients(): number {
    return Array.from(clients).filter(
      (socket) =>
        (clientRoles.get(socket) === "plugin" ||
          clientRoles.get(socket) === "browser") &&
        socket.readyState === socket.OPEN,
    ).length;
  }

  async function callBrowserTool(
    call: AnyToolCall,
    sessionId?: string,
    callOptions: BrowserToolCallOptions = {},
  ): Promise<unknown> {
    throwIfExecutionAborted(callOptions.signal);
    if (pendingToolRequests.size >= PROTOCOL_LIMITS.maxPendingBrowserTools) {
      return Promise.reject(
        new ExecutionBrokerError(
          "RATE_LIMITED",
          "too many pending browser tool requests; retry later.",
        ),
      );
    }
    const normalizedCall = normalizeToolCall(call) ?? call;
    const validationError = validateToolCall(normalizedCall);
    if (validationError) {
      return Promise.reject(new Error(validationError));
    }

    const client = sessionId
      ? findBrowserSocketForSession(sessionId)
      : findLatestBrowserSocket();
    if (!client) {
      return Promise.reject(
        new Error(
          sessionId
            ? `Browser session is not connected: ${sessionId}.`
            : "Browser executor is not connected to ws://127.0.0.1:17321.",
        ),
      );
    }

    const requestId = createId();
    const resolvedSessionId =
      clientSessionIds.get(client) ?? sessionId ?? "default";
    const authorization = callOptions.authorization;
    if (!authorization) {
      throw new ExecutionBrokerError(
        "APPROVAL_REQUIRED",
        "Direct daemon browser execution is disabled; authorize the MCP tool request first.",
      );
    }
    if (authorization.sessionId !== resolvedSessionId) {
      throw new ExecutionBrokerError(
        "STALE_CONTEXT",
        "Authorization session does not match the selected browser executor.",
      );
    }
    assertMcpExecutorBoundary(
      authorization.sourceMcpToolName,
      normalizedCall.toolName,
      authorization.mutatesBrowser,
    );
    const internalEffect = getInternalToolEffect(normalizedCall.toolName);
    const currentSession = browserStateHub.snapshot(resolvedSessionId);
    const trackedAuthorizedTarget = authorization.target?.tabId !== undefined
      ? browserStateHub.targetSnapshot(
          resolvedSessionId,
          authorization.target.tabId,
        ) ?? authorization.target
      : currentSession.currentTab;
    const targetMismatchFields = authorizationTargetMismatchFields(
      authorization.target,
      trackedAuthorizedTarget,
    );
    const followsAuthorizedPageEffect =
      canFollowAuthorizedPageEffectForRead(
        authorization.pageEffectDispatchAttempted === true,
        internalEffect?.mutationScope,
        authorization.target,
        trackedAuthorizedTarget,
      );
    if (targetMismatchFields.length > 0 && !followsAuthorizedPageEffect) {
      throw new ExecutionBrokerError(
        "STALE_CONTEXT",
        `Browser target changed after authorization and before executor dispatch (fields=${targetMismatchFields.join(",")}).`,
      );
    }
    const issuedAt = nowDate();
    const expiresAt = executionGrantExpiry(
      issuedAt,
      authorization.expiresAt,
      callOptions.deadlineAt,
    );
    const executionGrant = await createExecutionGrant(options.bridgeToken ?? "", {
      version: EXECUTION_GRANT_VERSION,
      grantId: createId(),
      browserRequestId: requestId,
      requesterRequestId: authorization.requesterRequestId,
      requesterConnectionId: authorization.requesterConnectionId,
      sessionId: resolvedSessionId,
      sourceMcpToolName: authorization.sourceMcpToolName,
      policyClass: authorization.policyClass,
      mutatesBrowser: authorization.mutatesBrowser,
      toolName: normalizedCall.toolName,
      argumentsSha256: await hashExecutionArguments(normalizedCall.args),
      approvalRequired: authorization.approvalRequired,
      approvalId: authorization.approvalId,
      target: executionGrantTarget(trackedAuthorizedTarget),
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    const message: McpToPluginMessage = {
      requestId,
      command: WS_COMMANDS.BROWSER_TOOL_CALL,
      sentAt: nowIso(),
      ...(callOptions.deadlineAt
        ? { deadlineAt: callOptions.deadlineAt }
        : {}),
      ...(callOptions.idempotencyKey
        ? { idempotencyKey: callOptions.idempotencyKey }
        : {}),
      payload: {
        call: normalizedCall,
        executionGrant,
      },
    };

    const transportStartedAt = Date.now();
    let transportComplete = false;
    const markTransportComplete = () => {
      if (transportComplete) {
        return;
      }
      transportComplete = true;
      authorization.timing.transportMs += Math.max(
        0,
        Date.now() - transportStartedAt,
      );
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = pendingToolRequests.get(requestId);
        pending?.cleanup?.();
        pending?.markTransportComplete();
        pendingToolRequests.delete(requestId);
        reject(
          new ExecutionBrokerError(
            "REQUEST_DEADLINE_EXCEEDED",
            `browser tool deadline exceeded: ${normalizedCall.toolName}`,
          ),
        );
        sendRequestCancel(
          client,
          requestId,
          "Daemon browser-tool deadline exceeded.",
        );
      }, browserTimeoutMs(callOptions.deadlineAt));

      const abort = () => {
        const pending = pendingToolRequests.get(requestId);
        if (!pending) {
          return;
        }
        clearTimeout(pending.timeout);
        pending.cleanup?.();
        pending.markTransportComplete();
        pendingToolRequests.delete(requestId);
        pending.reject(abortReason(callOptions.signal));
        sendRequestCancel(client, requestId, "Daemon request was cancelled.");
      };
      callOptions.signal?.addEventListener("abort", abort, { once: true });

      pendingToolRequests.set(requestId, {
        resolve,
        reject,
        timeout,
        browserSocket: client,
        sessionId: resolvedSessionId,
        markTransportComplete,
        cleanup: callOptions.signal
          ? () => callOptions.signal?.removeEventListener("abort", abort)
          : undefined,
      });
      client.send(JSON.stringify(message));
      if (
        internalEffect?.mutationScope === "page" ||
        internalEffect?.mutationScope === "browser"
      ) {
        authorization.pageEffectDispatchAttempted = true;
      }
    });
  }

  async function authorizeTool(
    requester: WebSocket,
    toolName: string,
    args: Record<string, unknown>,
    authorizationOptions: Pick<
      BrowserToolCallOptions,
      "signal" | "deadlineAt"
    > & { requestId?: string; taskContext?: ToolTaskContext } = {},
  ): Promise<AuthorizationReceipt> {
    throwIfExecutionAborted(authorizationOptions.signal);
    const policy = resolveMcpToolPolicy(
      additionalMcpBackend,
      toolName,
      args,
    );
    const externalMcpOrigin = additionalMcpBackend?.getToolOrigin?.(toolName);
    const requiresBrowserTarget =
      !externalMcpOrigin && !isExternalMcpToolName(toolName);
    const requesterSessionId =
      clientSessionIds.get(requester) ?? browserStateHub.getActiveSession().sessionId;
    if (requiresBrowserTarget) {
      // A restarted daemon can restore an old target before the browser worker
      // publishes its live tab. Give the already-triggered reconnect update a
      // short chance to land before approval is bound to stale persisted state.
      await browserStateHub.waitForCurrentTabAfterBrowserConnect(
        requesterSessionId,
        {
          timeoutMs: 350,
          signal: authorizationOptions.signal,
        },
      );
    }
    const requestedSnapshot = browserStateHub.snapshot(requesterSessionId);
    const requestedRevision = requestedSnapshot.revision;
    const requesterConnectionId =
      connectionIds.get(requester) ?? "unknown-connection";
    const requesterRequestId = authorizationOptions.requestId ?? createId();
    const role = requesterRole(clientRoles.get(requester));
    const clientName = wsClientNameForRole(role);
    const taskContext = authorizationOptions.taskContext ?? {
      taskId: requestedSnapshot.currentConversationId,
      egressDestinations: defaultTaskEgressDestinations(role, clientName),
    };
    const targetSelectionMismatch =
      normalizeMcpToolName(toolName) ===
        MCP_TOOL_NAMES.BROWSER_SET_TARGET_TAB &&
      typeof args.tabId === "number"
        ? getTaskTargetSelectionMismatch(taskContext, args.tabId)
        : null;
    if (targetSelectionMismatch) {
      throw new ExecutionBrokerError(
        "STALE_CONTEXT",
        `Tool task binding cannot select a different browser tab (field=${targetSelectionMismatch}). Ask the user to rebind the conversation or create a new conversation first.`,
      );
    }
    const requestedTarget = requiresBrowserTarget
      ? taskContext.target
        ? browserStateHub.targetSnapshot(
            requesterSessionId,
            taskContext.target.tabId,
          ) ??
          (requestedSnapshot.currentTab?.tabId === taskContext.target.tabId
            ? requestedSnapshot.currentTab
            : undefined)
        : requestedSnapshot.currentTab
      : undefined;
    const taskBindingConversationId = resolveTaskBindingConversationId(
      role,
      clientConversationIds.get(requester),
      requestedSnapshot.currentConversationId,
    );
    const taskBindingMismatch = getTaskExecutionBindingMismatch(
      requiresBrowserTarget
        ? taskContext
        : {
            taskId: taskContext.taskId,
            ...(taskContext.conversationId
              ? { conversationId: taskContext.conversationId }
              : {}),
            egressDestinations: taskContext.egressDestinations,
          },
      taskBindingConversationId,
      requestedTarget,
    );
    if (taskBindingMismatch) {
      throw new ExecutionBrokerError(
        "STALE_CONTEXT",
        `Tool task binding no longer matches the active browser context (field=${taskBindingMismatch}).`,
      );
    }
    const hasMatchingTaskGrant = Array.from(taskCapabilityGrants.values()).some(
      (grant) =>
        matchesTaskCapabilityGrant(grant, {
          taskId: taskContext.taskId,
          sessionId: requesterSessionId,
          requesterRole: role,
          requesterClientName: clientName,
          target: requestedTarget,
          egressDestinations: taskContext.egressDestinations,
          policy,
          now: clock(),
        }),
    );
    if (!approvalModeNeedsDecision(policy.approvalMode, hasMatchingTaskGrant)) {
      return {
        requesterRequestId,
        requesterConnectionId,
        sessionId: requesterSessionId,
        sourceMcpToolName: policy.toolName,
        policyClass: policy.policyClass,
        mutatesBrowser: policy.mutatesBrowser,
        revision: requestedRevision,
        target: requestedTarget,
        approvalRequired: false,
        expiresAt: authorizationExpiry(nowDate()).toISOString(),
        timing: { transportMs: 0 },
      };
    }
    if (requiresBrowserTarget && !requestedTarget) {
      throw new ExecutionBrokerError(
        "STALE_CONTEXT",
        `Tool approval required for ${toolName}, but no browser target is selected.`,
      );
    }

    const approvalSockets = new Set(
      Array.from(clients).filter(
        (client) =>
          clientRoles.get(client) === "ui" &&
          client.readyState === client.OPEN &&
          (clientSessionIds.get(client) ?? "default") === requesterSessionId,
      ),
    );
    if (approvalSockets.size === 0) {
      throw new ExecutionBrokerError(
        "APPROVAL_REQUIRED",
        `Tool approval required for ${toolName}, but no sidepanel UI is connected for session ${requesterSessionId}.`,
      );
    }

    const approvalId = createId();
    if (pendingApprovals.size >= PROTOCOL_LIMITS.maxPendingApprovals) {
      throw new ExecutionBrokerError(
        "RATE_LIMITED",
        "too many pending approvals; resolve an existing request first.",
      );
    }
    const requestedAt = nowDate();
    const message: McpToPluginMessage = {
      requestId: approvalId,
      command: WS_COMMANDS.APPROVAL_REQUEST,
      sentAt: requestedAt.toISOString(),
      payload: {
        approvalId,
        toolName,
        arguments: redactApprovalArguments(args),
        policyClass: policy.policyClass,
        approvalMode: policy.approvalMode,
        capability: policy.capability,
        reason: policy.reason,
        requestedAt: requestedAt.toISOString(),
        sessionId: requesterSessionId,
        revision: requestedRevision,
        requester: {
          role,
          clientName,
          connectionId: requesterConnectionId,
        },
        taskContext: {
          taskId: taskContext.taskId,
          ...(taskContext.conversationId
            ? { conversationId: taskContext.conversationId }
            : {}),
        },
        ...(requestedTarget ? { target: requestedTarget } : {}),
        preview: buildApprovalPreview(toolName, args, policy),
        ...(externalMcpOrigin
          ? {
              externalMcp: {
                serverId: externalMcpOrigin.externalMcpServerId,
                serverName: externalMcpOrigin.externalMcpServerName,
                toolName: externalMcpOrigin.externalMcpToolName,
              },
            }
          : {}),
      },
    };

    await recordAuditEvent(options.stateStore, {
      id: createId(),
      eventType: "approval.requested",
      timestamp: requestedAt.toISOString(),
      requestId: authorizationOptions.requestId ?? approvalId,
      sessionId: requesterSessionId,
      toolName,
      policyClass: policy.policyClass,
      argumentsSha256: hashAuditArguments(args),
      revision: requestedRevision,
    });
    throwIfExecutionAborted(authorizationOptions.signal);

    const approvalResponse = await new Promise<ApprovalResponsePayload>((resolve, reject) => {
      const cleanup = () => {
        authorizationOptions.signal?.removeEventListener("abort", abort);
      };
      const abort = () => {
        const pending = pendingApprovals.get(approvalId);
        if (!pending) {
          return;
        }
        pending.cleanup?.();
        pendingApprovals.delete(approvalId);
        notifyApprovalCancelled(
          approvalId,
          pending,
          "The requesting MCP operation was cancelled.",
        );
        pending.reject(abortReason(authorizationOptions.signal));
      };
      authorizationOptions.signal?.addEventListener("abort", abort, {
        once: true,
      });
      pendingApprovals.set(approvalId, {
        allowedSockets: approvalSockets,
        resolve,
        reject,
        cleanup,
      });
      for (const client of approvalSockets) {
        client.send(JSON.stringify(message));
      }
    });

    if (!approvalResponse.approved) {
      await recordAuditEvent(options.stateStore, {
        id: createId(),
        eventType: "approval.denied",
        timestamp: nowIso(),
        requestId: authorizationOptions.requestId ?? approvalId,
        sessionId: requesterSessionId,
        toolName,
        policyClass: policy.policyClass,
        argumentsSha256: hashAuditArguments(args),
        revision: requestedRevision,
        outcome: "denied",
      });
      throw new ExecutionBrokerError(
        "APPROVAL_DENIED",
        `user denied tool approval: ${toolName}`,
      );
    }

    throwIfExecutionAborted(authorizationOptions.signal);
    let approvedTarget = requestedTarget;
    if (requiresBrowserTarget && requestedTarget) {
      approvedTarget = requestedTarget.tabId !== undefined
        ? browserStateHub.targetSnapshot(
            requesterSessionId,
            requestedTarget.tabId,
          ) ?? requestedTarget
        : browserStateHub.snapshot(requesterSessionId).currentTab;
      const targetMismatchFields = authorizationTargetMismatchFields(
        requestedTarget,
        approvedTarget,
      );
      if (targetMismatchFields.length > 0) {
        throw new ExecutionBrokerError(
          "STALE_CONTEXT",
          `browser target changed while approval was pending (fields=${targetMismatchFields.join(",")}).`,
        );
      }
    }

    if (
      approvalResponse.rememberForTask &&
      isTaskGrantEligiblePolicy(policy) &&
      requestedTarget
    ) {
      const origin = normalizeHttpOrigin(requestedTarget.url);
      const remembered = approvalResponse.rememberForTask;
      if (
        origin &&
        remembered.taskId === taskContext.taskId &&
        (role === "ui" || role === "mcp") &&
        remembered.principals.includes(role) &&
        arraysEqual(
          normalizeStrings(remembered.egressDestinations),
          normalizeStrings(taskContext.egressDestinations),
        )
      ) {
        const grantId = createId();
        const issuedAt = clock();
        taskCapabilityGrants.set(grantId, {
          version: TASK_CAPABILITY_GRANT_VERSION,
          grantId,
          revision: 1,
          taskId: remembered.taskId,
          sessionId: requesterSessionId,
          origin,
          targetId: requestedTarget.targetId,
          tabId: requestedTarget.tabId,
          principals: [...new Set(remembered.principals)],
          requesterClientNames: [clientName],
          egressDestinations: normalizeStrings(remembered.egressDestinations),
          capabilities: standardTaskCapabilities(),
          issuedAt: new Date(issuedAt).toISOString(),
          expiresAt: new Date(
            issuedAt +
              Math.min(
                TASK_CAPABILITY_GRANT_TTL_MS,
                remembered.ttlMs ?? TASK_CAPABILITY_GRANT_TTL_MS,
              ),
          ).toISOString(),
        });
        await recordAuditEvent(options.stateStore, {
          id: createId(),
          eventType: "grant.created",
          timestamp: new Date(issuedAt).toISOString(),
          requestId: requesterRequestId,
          sessionId: requesterSessionId,
          toolName: policy.toolName,
          policyClass: policy.policyClass,
          argumentsSha256: hashAuditArguments({
            grantId,
            taskId: remembered.taskId,
          }),
          revision: requestedRevision,
          outcome: "approved",
        });
      }
    }
    await recordAuditEvent(options.stateStore, {
      id: createId(),
      eventType: "approval.approved",
      timestamp: nowIso(),
      requestId: authorizationOptions.requestId ?? approvalId,
      sessionId: requesterSessionId,
      toolName,
      policyClass: policy.policyClass,
      argumentsSha256: hashAuditArguments(args),
      revision: requestedRevision,
      outcome: "approved",
    });
    return {
      requesterRequestId,
      requesterConnectionId,
      sessionId: requesterSessionId,
      sourceMcpToolName: policy.toolName,
      policyClass: policy.policyClass,
      mutatesBrowser: policy.mutatesBrowser,
      revision: requestedRevision,
      target: approvedTarget,
      approvalRequired: true,
      approvalId,
      expiresAt: authorizationExpiry(nowDate()).toISOString(),
      timing: { transportMs: 0 },
    };
  }

  function resolveApproval(
    socket: WebSocket,
    payload: ApprovalResponsePayload,
  ): void {
    const pending = pendingApprovals.get(payload.approvalId);
    if (!pending || !pending.allowedSockets.has(socket)) {
      return;
    }
    pending.cleanup?.();
    pendingApprovals.delete(payload.approvalId);
    notifyApprovalCancelled(
      payload.approvalId,
      pending,
      "The approval was resolved in another sidepanel.",
      socket,
    );
    pending.resolve(payload);
  }

  function registerPluginSocket(socket: WebSocket): void {
    clientRoles.set(socket, "plugin");
    primaryPluginSocket = socket;
    browserStateHub.connect("plugin", clientSessionIds.get(socket));
  }

  function registerBrowserSocket(socket: WebSocket, sessionId?: string): void {
    clientRoles.set(socket, "browser");
    if (sessionId) {
      clientSessionIds.set(socket, sessionId);
      const previous = currentBrowserSockets.get(sessionId);
      currentBrowserSockets.set(sessionId, socket);
      if (
        previous &&
        previous !== socket &&
        previous.readyState === previous.OPEN
      ) {
        rejectAllPendingToolRequests(
          pendingToolRequests,
          "Browser session reconnected before the browser tool completed.",
          previous,
        );
        previous.close(1008, "SESSION_REPLACED");
      }
    }
    primaryBrowserSocket = socket;
    browserStateHub.connect("browser", sessionId);
  }

  function findLatestPluginSocket(): WebSocket | null {
    if (
      primaryPluginSocket &&
      clientRoles.get(primaryPluginSocket) === "plugin" &&
      primaryPluginSocket.readyState === primaryPluginSocket.OPEN
    ) {
      return primaryPluginSocket;
    }

    for (const socket of Array.from(clients).reverse()) {
      if (
        clientRoles.get(socket) === "plugin" &&
        socket.readyState === socket.OPEN
      ) {
        primaryPluginSocket = socket;
        return socket;
      }
    }

    primaryPluginSocket = null;
    return null;
  }

  function findLatestBrowserSocket(): WebSocket | null {
    if (
      primaryBrowserSocket &&
      clientRoles.get(primaryBrowserSocket) === "browser" &&
      primaryBrowserSocket.readyState === primaryBrowserSocket.OPEN
    ) {
      return primaryBrowserSocket;
    }

    for (const socket of Array.from(clients).reverse()) {
      if (
        clientRoles.get(socket) === "browser" &&
        socket.readyState === socket.OPEN
      ) {
        primaryBrowserSocket = socket;
        return socket;
      }
    }

    primaryBrowserSocket = null;
    return null;
  }

  function findBrowserSocketForSession(sessionId: string): WebSocket | null {
    const current = currentBrowserSockets.get(sessionId);
    if (
      current &&
      clientRoles.get(current) === "browser" &&
      current.readyState === current.OPEN
    ) {
      return current;
    }

    // A browser service worker can briefly leave its previous WebSocket open
    // while the reloaded worker registers a replacement for the same profile.
    // Prefer the newest registration so tool calls never get stuck on that
    // stale-but-still-open socket.
    for (const socket of Array.from(clients).reverse()) {
      if (
        clientRoles.get(socket) === "browser" &&
        clientSessionIds.get(socket) === sessionId &&
        socket.readyState === socket.OPEN
      ) {
        currentBrowserSockets.set(sessionId, socket);
        return socket;
      }
    }
    currentBrowserSockets.delete(sessionId);
    return null;
  }

  function replayStateToObserver(socket: WebSocket): void {
    const sessionId = clientSessionIds.get(socket) ?? "default";
    const state = browserStateHub.snapshot(sessionId);

    if (state.activeTab) {
      sendRawMessage(socket, {
        requestId: createMessageId(),
        command: WS_COMMANDS.ACTIVE_TAB_UPDATED,
        sentAt: new Date().toISOString(),
        payload: {
          activeTab: state.activeTab,
        },
      });
    }

    if (state.activeTab && state.selectedElement) {
      sendRawMessage(socket, {
        requestId: createMessageId(),
        command: WS_COMMANDS.ELEMENT_SELECTED,
        sentAt: new Date().toISOString(),
        payload: {
          activeTab: state.activeTab,
          selectedElement: state.selectedElement,
        },
      });
    }

    for (const message of state.pluginConversation) {
      sendRawMessage(socket, {
        requestId: createMessageId(),
        command: WS_COMMANDS.PLUGIN_CHAT_MESSAGE_CREATED,
        sentAt: new Date().toISOString(),
        payload: {
          message,
        },
      });
    }

    if (state.lastScreenshot) {
      sendRawMessage(socket, {
        requestId: createMessageId(),
        command: WS_COMMANDS.SCREENSHOT_CAPTURED,
        sentAt: new Date().toISOString(),
        payload: {
          screenshot: state.lastScreenshot,
        },
      });
    }

    if (state.activeTab && state.pageContext) {
      sendRawMessage(socket, {
        requestId: createMessageId(),
        command: WS_COMMANDS.PAGE_CONTEXT_UPDATED,
        sentAt: new Date().toISOString(),
        payload: {
          activeTab: state.activeTab,
          pageContext: state.pageContext,
        },
      });
    }

    for (const session of state.agentSessions) {
      sendRawMessage(socket, {
        requestId: createMessageId(),
        command: WS_COMMANDS.AGENT_SESSION_SYNC,
        sentAt: new Date().toISOString(),
        payload: {
          session,
        },
      });
    }

    for (const event of daemonAgentRunner.listPendingBudgetRequests(sessionId)) {
      sendRawMessage(socket, {
        requestId: createMessageId(),
        command: WS_COMMANDS.DAEMON_AGENT_EVENT,
        sentAt: new Date().toISOString(),
        payload: event,
      });
    }

    sendRawMessage(socket, {
      requestId: createMessageId(),
      command: WS_COMMANDS.COLLABORATION_WORKSPACE_UPDATED,
      sentAt: new Date().toISOString(),
      payload: {
        workspace: state.collaborationWorkspace,
      },
    });
    sendRawMessage(socket, {
      requestId: createMessageId(),
      command: WS_COMMANDS.BROWSER_ACTIVITY_UPDATED,
      sentAt: new Date().toISOString(),
      payload: {
        sessionId: state.sessionId,
        streamId: state.activityStream.streamId,
        active: state.activityStream.active,
        latestSequence: state.activityStream.latestSequence,
        target: state.activityStream.target,
      },
    });
  }

  function broadcastToObservers(
    sourceSocket: WebSocket,
    message: ValidPluginToMcpMessage,
  ): void {
    const sourceSessionId = clientSessionIds.get(sourceSocket);
    if (message.command === WS_COMMANDS.BROWSER_ACTIVITY_EVENT) {
      const activityStream =
        browserStateHub.activityStreamPayload(
          sourceSessionId,
          message.payload.event.target?.tabId,
        );
      const update: McpToPluginMessage = {
        requestId: createMessageId(),
        command: WS_COMMANDS.BROWSER_ACTIVITY_UPDATED,
        sentAt: new Date().toISOString(),
        payload: {
          sessionId: sourceSessionId ?? "default",
          streamId: activityStream.streamId,
          active: activityStream.active,
          latestSequence: activityStream.latestSequence,
          target: activityStream.target,
        },
      };
      const payload = JSON.stringify(update);
      for (const socket of clients) {
        if (
          (clientRoles.get(socket) === "mcp" ||
            clientRoles.get(socket) === "observer" ||
            clientRoles.get(socket) === "ui") &&
          clientSessionIds.get(socket) === sourceSessionId &&
          socket.readyState === socket.OPEN
        ) {
          socket.send(payload);
        }
      }
      return;
    }
    const payload = JSON.stringify(message);

    for (const socket of clients) {
      if (socket === sourceSocket) {
        continue;
      }
      if (
        (clientRoles.get(socket) === "observer" ||
          clientRoles.get(socket) === "ui") &&
        clientSessionIds.get(socket) === sourceSessionId &&
        socket.readyState === socket.OPEN
      ) {
        socket.send(payload);
      }
    }
  }

  async function handleDaemonAgentCommand(
    socket: WebSocket,
    message: ValidPluginToMcpMessage,
  ): Promise<boolean> {
    if (message.command === WS_COMMANDS.DAEMON_AGENT_CANCEL) {
      const sessionId = clientSessionIds.get(socket) ?? "default";
      const accepted = daemonAgentRunner.cancel(
        sessionId,
        message.payload.conversationId,
        message.payload.runId,
        message.payload.reason,
      );
      const session = browserStateHub
        .snapshot(sessionId)
        .agentSessions.find(
          (candidate) => candidate.id === message.payload.runId,
        );
      sendRawMessage(socket, {
        requestId: message.requestId,
        command: WS_COMMANDS.DAEMON_AGENT_CANCEL_RESULT,
        sentAt: new Date().toISOString(),
        payload: {
          runId: message.payload.runId,
          conversationId: message.payload.conversationId,
          accepted,
          state: accepted ? "cancelling" : "not_active",
          ...(session ? { session } : {}),
        },
      });
      return true;
    }
    if (message.command === WS_COMMANDS.DAEMON_AGENT_BUDGET_DECISION) {
      const sessionId = clientSessionIds.get(socket) ?? "default";
      daemonAgentRunner.resolveBudgetDecision(sessionId, message.payload);
      return true;
    }
    if (message.command !== WS_COMMANDS.DAEMON_AGENT_START) {
      return false;
    }

    const sessionId = clientSessionIds.get(socket) ?? "default";
    const startPayload = message.payload as unknown as DaemonAgentStartPayload;
    try {
      daemonAgentRunner.start(sessionId, startPayload, {
        executeTool: (request) =>
          executeDaemonAgentTool(
            request,
            startPayload.conversationId,
          ),
        emit: (event) => broadcastDaemonAgentEvent(sessionId, event),
        persistSession: (event) => {
          browserStateHub.setAgentSession(event.session, sessionId);
          broadcastSessionSnapshot(sessionId, event.session);
        },
      });
      sendRawMessage(socket, {
        requestId: message.requestId,
        command: WS_COMMANDS.DAEMON_AGENT_START_RESULT,
        sentAt: new Date().toISOString(),
        payload: {
          ok: true,
          runId: startPayload.runId,
          conversationId: startPayload.conversationId,
          acceptedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      sendRawMessage(socket, {
        requestId: message.requestId,
        command: WS_COMMANDS.DAEMON_AGENT_START_RESULT,
        sentAt: new Date().toISOString(),
        payload: {
          ok: false,
          runId: startPayload.runId,
          conversationId: startPayload.conversationId,
          error: error instanceof Error ? error.message : "Daemon Agent start failed.",
        },
      });
    }
    return true;
  }

  function broadcastDaemonAgentEvent(
    sessionId: string,
    event: DaemonAgentEventPayload,
  ): void {
    const message: McpToPluginMessage = {
      requestId: createMessageId(),
      command: WS_COMMANDS.DAEMON_AGENT_EVENT,
      sentAt: new Date().toISOString(),
      payload: event,
    };
    const serialized = JSON.stringify(message);
    for (const socket of clients) {
      if (
        clientRoles.get(socket) === "ui" &&
        clientSessionIds.get(socket) === sessionId &&
        socket.readyState === socket.OPEN
      ) {
        socket.send(serialized);
      }
    }
  }

  function broadcastSessionSnapshot(
    sessionId: string,
    session: AgentSessionSnapshot,
  ): void {
    const message: McpToPluginMessage = {
      requestId: createMessageId(),
      command: WS_COMMANDS.AGENT_SESSION_SYNC,
      sentAt: new Date().toISOString(),
      payload: { session },
    };
    const serialized = JSON.stringify(message);
    for (const socket of clients) {
      if (
        (clientRoles.get(socket) === "ui" ||
          clientRoles.get(socket) === "observer") &&
        clientSessionIds.get(socket) === sessionId &&
        socket.readyState === socket.OPEN
      ) {
        socket.send(serialized);
      }
    }
  }

  async function executeDaemonAgentTool(
    request: DaemonAgentToolRequest,
    conversationId: string,
  ): Promise<unknown> {
    let result: McpToolResultPayload | undefined;
    const syntheticSocket = {
      OPEN: 1,
      readyState: 1,
      send: (raw: string) => {
        const message = JSON.parse(raw) as McpToPluginMessage;
        if (message.command === WS_COMMANDS.MCP_TOOL_RESULT) {
          result = message.payload;
        }
      },
    } as unknown as WebSocket;
    const connectionId = `daemon-agent:${request.runId}`;
    const requestId = `daemon-agent:${request.runId}:${request.toolCallId}`.slice(0, 200);
    clientRoles.set(syntheticSocket, "ui");
    clientSessionIds.set(syntheticSocket, request.sessionId);
    clientConversationIds.set(syntheticSocket, conversationId);
    connectionIds.set(syntheticSocket, connectionId);
    try {
      const taskContext: ToolTaskContext = {
        taskId: request.executionBinding?.taskId ?? conversationId,
        conversationId,
        ...(request.executionBinding
          ? {
              target: {
                tabId: request.executionBinding.target.tabId,
                targetId: request.executionBinding.target.targetId,
              },
            }
          : {}),
        egressDestinations: request.egressDestinations,
      };
      await executeWithExternalCancellation({
        signal: request.signal,
        createPreCancelledError: () =>
          new ExecutionBrokerError(
            "REQUEST_CANCELLED",
            "Daemon Agent tool request was cancelled before execution.",
          ),
        cancel: () => {
          executionBroker.cancel(
            connectionId,
            requestId,
            request.signal.reason instanceof Error
              ? request.signal.reason.message
              : "Daemon Agent tool request cancelled.",
          );
        },
        start: () =>
          isCollaborationToolName(request.toolName)
            ? handleCollaborationTool(
                syntheticSocket,
                requestId,
                request.toolName,
                request.args,
                request.sessionId,
                (message) => {
                  const serialized = JSON.stringify(message);
                  for (const socket of clients) {
                    if (
                      clientRoles.get(socket) === "ui" &&
                      clientSessionIds.get(socket) === request.sessionId &&
                      socket.readyState === socket.OPEN
                    ) {
                      socket.send(serialized);
                    }
                  }
                },
                {
                  actor: "extension_agent",
                  clientId: connectionId,
                  executionBroker,
                  connectionId,
                },
              )
            : handlePluginRequestedMcpTool(
                syntheticSocket,
                requestId,
                request.toolName,
                request.args,
                (call, options) =>
                  callBrowserTool(call, request.sessionId, options),
                authorizeTool,
                executionBroker,
                connectionId,
                request.sessionId,
                undefined,
                requestId,
                artifactStore,
                false,
                options.stateStore,
                "extension_agent",
                taskContext,
                additionalMcpBackend,
              ),
      });
      if (!result) {
        throw new Error(`Daemon Agent tool ${request.toolName} returned no protocol result.`);
      }
      if (!result.ok) {
        throw new Error(result.error);
      }
      return result.data;
    } finally {
      clientRoles.delete(syntheticSocket);
      clientSessionIds.delete(syntheticSocket);
      clientConversationIds.delete(syntheticSocket);
      connectionIds.delete(syntheticSocket);
    }
  }
}

function handleRawMessage(
  socket: WebSocket,
  raw: string,
  clientRoles: Map<WebSocket, WsClientRole | "unknown">,
  clientSessionIds: Map<WebSocket, string>,
  setClientConversationId: (conversationId: string) => void,
  registerPluginSocket: () => void,
  registerBrowserSocket: (sessionId?: string) => void,
  replayStateToObserver: () => void,
  broadcastToObservers: (message: ValidPluginToMcpMessage) => void,
  pendingToolRequests: Map<string, PendingBrowserToolRequest>,
  taskCapabilityGrants: Map<string, TaskCapabilityGrant>,
  callBrowserTool: BrowserToolCaller,
  authorizeTool: ToolAuthorizer,
  resolveApproval: ApprovalResolver,
  origin: string | undefined,
  bridgeToken: string | undefined,
  allowedExtensionIds: ReadonlySet<string>,
  executionBroker: ExecutionBroker,
  connectionId: string,
  artifactStore: ArtifactStore,
  stateStore: DaemonStateStore | undefined,
  reportProtocolViolation: (requestId: string, error: string) => void,
  additionalMcpBackend?: AdditionalMcpToolBackend,
  handleDaemonAgentCommand?: DaemonAgentCommandHandler,
): void {
  const parsedJson = safeJsonParse(raw);
  if (!parsedJson.ok) {
    reportProtocolViolation("invalid-json", parsedJson.error);
    return;
  }

  const untrustedRequestId =
    typeof parsedJson.value === "object" &&
    parsedJson.value !== null &&
    "requestId" in parsedJson.value &&
    typeof parsedJson.value.requestId === "string" &&
    parsedJson.value.requestId.length > 0 &&
    parsedJson.value.requestId.length <= 200
      ? parsedJson.value.requestId
      : "invalid-request";
  const untrustedCommand =
    typeof parsedJson.value === "object" &&
    parsedJson.value !== null &&
    "command" in parsedJson.value
      ? parsedJson.value.command
      : undefined;
  const messageBytes = utf8MessageByteLength(raw);
  const messageByteLimit = inboundMessageByteLimit(untrustedCommand);
  if (messageBytes > messageByteLimit) {
    const commandLabel =
      typeof untrustedCommand === "string" && untrustedCommand.length <= 100
        ? untrustedCommand
        : "unknown";
    reportProtocolViolation(
      untrustedRequestId,
      `PAYLOAD_TOO_LARGE: ${commandLabel} message is ${messageBytes} bytes; maximum is ${messageByteLimit}.`,
    );
    return;
  }

  const parsed = pluginToMcpMessageSchema.safeParse(parsedJson.value);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const commandLabel =
      typeof untrustedCommand === "string" && untrustedCommand.length <= 100
        ? untrustedCommand
        : "unknown";
    const issuePath = firstIssue?.path
      .map((segment) => String(segment).replace(/[^A-Za-z0-9_-]/g, "_"))
      .join(".") || "root";
    console.error(
      `[ai-devtools-daemon] schema rejection detail: command=${commandLabel} issue=${
        firstIssue?.code ?? "unknown"
      } path=${issuePath}`,
    );
    reportProtocolViolation(
      untrustedRequestId,
      `SCHEMA_INVALID: ${parsed.error.message}`,
    );
    return;
  }

  const currentRole = clientRoles.get(socket) ?? "unknown";
  if (currentRole === "unknown" && parsed.data.command !== WS_COMMANDS.CLIENT_HELLO) {
    sendAck(socket, {
      requestId: parsed.data.requestId,
      ok: false,
      receivedAt: new Date().toISOString(),
      error: "AUTH_REQUIRED: the first frame must be CLIENT_HELLO.",
    });
    socket.close(1008, "AUTH_REQUIRED");
    return;
  }
  let assignedHelloRole: WsClientRole | undefined;
  if (parsed.data.command === WS_COMMANDS.CLIENT_HELLO) {
    if (currentRole !== "unknown") {
      sendAck(socket, {
        requestId: parsed.data.requestId,
        ok: false,
        receivedAt: new Date().toISOString(),
        error: "ROLE_FORBIDDEN: connection role is immutable.",
      });
      socket.close(1008, "ROLE_FORBIDDEN");
      return;
    }
    if (parsed.data.payload.protocolVersion !== WS_PROTOCOL_VERSION) {
      sendAck(socket, {
        requestId: parsed.data.requestId,
        ok: false,
        receivedAt: new Date().toISOString(),
        error: `PROTOCOL_VERSION_UNSUPPORTED: daemon requires version ${WS_PROTOCOL_VERSION}, client sent ${parsed.data.payload.protocolVersion}. Rebuild or update the extension and MCP adapter together.`,
      });
      socket.close(1002, "PROTOCOL_VERSION_UNSUPPORTED");
      return;
    }
    if (parsed.data.payload.buildId !== RUNTIME_BUILD_ID) {
      sendAck(socket, {
        requestId: parsed.data.requestId,
        ok: false,
        receivedAt: new Date().toISOString(),
        error: `BUILD_ID_MISMATCH: daemon=${RUNTIME_BUILD_ID}, ${parsed.data.payload.clientRole}=${parsed.data.payload.buildId}. Restart the daemon and MCP client, then reload the Chrome extension.`,
      });
      socket.close(1002, "BUILD_ID_MISMATCH");
      return;
    }
    if (parsed.data.payload.schemaHash !== RUNTIME_SCHEMA_HASH) {
      sendAck(socket, {
        requestId: parsed.data.requestId,
        ok: false,
        receivedAt: new Date().toISOString(),
        error: `SCHEMA_HASH_MISMATCH: daemon=${RUNTIME_SCHEMA_HASH}, ${parsed.data.payload.clientRole}=${parsed.data.payload.schemaHash}. Restart the daemon and MCP client, then reload the Chrome extension.`,
      });
      socket.close(1002, "SCHEMA_HASH_MISMATCH");
      return;
    }
    const authentication = authenticateClientHello(
      parsed.data.payload as ClientHelloPayload,
      origin,
      bridgeToken,
      allowedExtensionIds,
    );
    if (!authentication.ok) {
      sendAck(socket, {
        requestId: parsed.data.requestId,
        ok: false,
        receivedAt: new Date().toISOString(),
        error: authentication.error,
      });
      socket.close(1008, "AUTH_INVALID");
      return;
    }
    assignedHelloRole = authentication.assignedRole;
  }

  if (
    currentRole !== "unknown" &&
    parsed.data.command !== WS_COMMANDS.CLIENT_HELLO &&
    !isCommandAllowedForRole(currentRole, parsed.data.command)
  ) {
    reportProtocolViolation(
      parsed.data.requestId,
      `ROLE_FORBIDDEN: ${currentRole} clients cannot send ${parsed.data.command}.`,
    );
    return;
  }

  if (
    currentRole === "ui" &&
    parsed.data.command === WS_COMMANDS.PLUGIN_CONVERSATION_STARTED
  ) {
    setClientConversationId(parsed.data.payload.conversationId.trim());
  } else if (
    currentRole === "ui" &&
    parsed.data.command === WS_COMMANDS.PLUGIN_CHAT_MESSAGE_CREATED &&
    parsed.data.payload.message.conversationId
  ) {
    setClientConversationId(parsed.data.payload.message.conversationId.trim());
  }

  void handlePluginMessage(
    socket,
    parsed.data,
    clientRoles,
    clientSessionIds,
    registerPluginSocket,
    registerBrowserSocket,
    replayStateToObserver,
    broadcastToObservers,
    pendingToolRequests,
    taskCapabilityGrants,
    callBrowserTool,
    authorizeTool,
    resolveApproval,
    executionBroker,
    connectionId,
    artifactStore,
    stateStore,
    assignedHelloRole,
    additionalMcpBackend,
    handleDaemonAgentCommand,
  ).catch((error) => {
    console.error(
      `[ai-devtools-daemon] protocol command failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
  sendAck(socket, {
    requestId: parsed.data.requestId,
    ok: true,
    receivedAt: new Date().toISOString(),
  });
}

type ClientAuthenticationResult =
  | { ok: true; assignedRole: WsClientRole }
  | { ok: false; error: string };

function authenticateClientHello(
  payload: ClientHelloPayload,
  origin: string | undefined,
  expectedBridgeToken: string | undefined,
  allowedExtensionIds: ReadonlySet<string>,
): ClientAuthenticationResult {
  if (
    expectedBridgeToken &&
    !tokensEqual(payload.bridgeToken ?? "", expectedBridgeToken)
  ) {
    return { ok: false, error: "AUTH_INVALID: bridge token is missing or invalid." };
  }

  const identity = resolveWsClientIdentity(payload.clientName);
  if (!identity) {
    return {
      ok: false,
      error: "AUTH_INVALID: clientName is not registered by this daemon build.",
    };
  }
  if (payload.clientRole !== identity.assignedRole) {
    return {
      ok: false,
      error: `ROLE_FORBIDDEN: registered client ${identity.clientName} is assigned ${identity.assignedRole}, not ${payload.clientRole}.`,
    };
  }

  if (identity.transport === "local-process") {
    return origin
      ? {
          ok: false,
          error: "AUTH_INVALID: local-process clients must not connect from a browser Origin.",
        }
      : { ok: true, assignedRole: identity.assignedRole };
  }

  const extensionId = chromeExtensionIdFromOrigin(origin);
  if (!extensionId) {
    return {
      ok: false,
      error: "AUTH_INVALID: Chrome clients require a valid chrome-extension:// Origin.",
    };
  }
  if (
    allowedExtensionIds.size > 0 &&
    !allowedExtensionIds.has(extensionId)
  ) {
    return {
      ok: false,
      error: "AUTH_INVALID: Chrome extension ID is not paired with this daemon.",
    };
  }
  if (
    !payload.installationId?.trim() ||
    !payload.sessionId?.trim() ||
    payload.installationId !== payload.sessionId
  ) {
    return {
      ok: false,
      error: "AUTH_INVALID: Chrome installationId and sessionId must be present and identical.",
    };
  }
  return { ok: true, assignedRole: identity.assignedRole };
}

function tokensEqual(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function chromeExtensionIdFromOrigin(
  origin: string | undefined,
): string | undefined {
  if (!origin) {
    return undefined;
  }
  try {
    const parsed = new URL(origin);
    const extensionId = parsed.hostname.toLowerCase();
    return parsed.protocol === "chrome-extension:" && /^[a-p]{32}$/.test(extensionId)
      ? extensionId
      : undefined;
  } catch {
    return undefined;
  }
}

async function handlePluginMessage(
  socket: WebSocket,
  message: ValidPluginToMcpMessage,
  clientRoles: Map<WebSocket, WsClientRole | "unknown">,
  clientSessionIds: Map<WebSocket, string>,
  registerPluginSocket: () => void,
  registerBrowserSocket: (sessionId?: string) => void,
  replayStateToObserver: () => void,
  broadcastToObservers: (message: ValidPluginToMcpMessage) => void,
  pendingToolRequests: Map<string, PendingBrowserToolRequest>,
  taskCapabilityGrants: Map<string, TaskCapabilityGrant>,
  callBrowserTool: BrowserToolCaller,
  authorizeTool: ToolAuthorizer,
  resolveApproval: ApprovalResolver,
  executionBroker: ExecutionBroker,
  connectionId: string,
  artifactStore: ArtifactStore,
  stateStore: DaemonStateStore | undefined,
  assignedHelloRole: WsClientRole | undefined,
  additionalMcpBackend?: AdditionalMcpToolBackend,
  handleDaemonAgentCommand?: DaemonAgentCommandHandler,
): Promise<void> {
  if (message.command === WS_COMMANDS.CLIENT_HELLO) {
    handleClientHello(
      socket,
      message.payload as ClientHelloPayload,
      clientRoles,
      clientSessionIds,
      registerPluginSocket,
      registerBrowserSocket,
      replayStateToObserver,
      connectionId,
      assignedHelloRole,
    );
    return;
  }

  if (message.command === WS_COMMANDS.HEARTBEAT) {
    browserStateHub.touch(
      message.payload.sessionId ?? clientSessionIds.get(socket),
    );
    return;
  }

  const currentRole = clientRoles.get(socket) ?? "unknown";
  if (message.command === WS_COMMANDS.REQUEST_CANCEL) {
    if (currentRole === "ui" || currentRole === "mcp" || currentRole === "plugin") {
      executionBroker.cancel(
        connectionId,
        message.payload.targetRequestId,
        message.payload.reason,
      );
    }
    return;
  }
  if (message.command === WS_COMMANDS.APPROVAL_RESPONSE) {
    if (currentRole === "ui") {
      resolveApproval(socket, message.payload);
    }
    return;
  }
  if (message.command === WS_COMMANDS.TASK_GRANT_REVOKE) {
    if (currentRole === "ui") {
      const revoked = revokeTaskGrants(
        taskCapabilityGrants,
        clientSessionIds.get(socket) ?? browserStateHub.getActiveSession().sessionId,
        message.payload.taskId,
        message.payload.reason,
        Date.now(),
      );
      if (revoked > 0) {
        await recordAuditEvent(stateStore, {
          id: createMessageId(),
          eventType: "grant.revoked",
          timestamp: new Date().toISOString(),
          requestId: message.requestId,
          sessionId:
            clientSessionIds.get(socket) ??
            browserStateHub.getActiveSession().sessionId,
          toolName: "task_capability_grant",
          policyClass: "task_grant",
          argumentsSha256: hashAuditArguments({
            taskId: message.payload.taskId,
            reason: message.payload.reason,
          }),
          revision: browserStateHub.snapshot(
            clientSessionIds.get(socket) ??
              browserStateHub.getActiveSession().sessionId,
          ).revision,
          outcome: "completed",
        });
      }
    }
    return;
  }
  if (message.command === WS_COMMANDS.ARTIFACT_GET && currentRole !== "mcp") {
    sendArtifactGetResult(socket, message.requestId, {
      ok: false,
      artifactId: message.payload.artifactId,
      error: "ROLE_FORBIDDEN: only MCP adapter connections may read artifacts.",
    });
    return;
  }
  if (currentRole === "unknown") {
    registerPluginSocket();
  } else if (currentRole === "observer") {
    await handleObserverMessage(socket, message, additionalMcpBackend);
    return;
  } else if (currentRole === "ui") {
    if (
      handleDaemonAgentCommand &&
      (await handleDaemonAgentCommand(socket, message))
    ) {
      return;
    }
    await handleUiMessage(
      socket,
      message,
      callBrowserTool,
      authorizeTool,
      executionBroker,
      connectionId,
      clientSessionIds.get(socket),
      artifactStore,
      stateStore,
      broadcastToObservers,
      additionalMcpBackend,
    );
    return;
  } else if (currentRole === "mcp") {
    await handleMcpAdapterMessage(
      socket,
      message,
      clientSessionIds.get(socket),
      callBrowserTool,
      authorizeTool,
      executionBroker,
      connectionId,
      artifactStore,
      stateStore,
      broadcastToObservers,
      additionalMcpBackend,
      (sessionId) => clientSessionIds.set(socket, sessionId),
    );
    return;
  }

  if (await handlePublishedStateMessage(
    message,
    clientSessionIds.get(socket),
    artifactStore,
    broadcastToObservers,
    true,
    currentRole,
  )) {
    return;
  }

  switch (message.command) {
    case WS_COMMANDS.MCP_LIST_TOOLS:
      await handlePluginRequestedMcpToolList(
        socket,
        message.requestId,
        message.payload.includeLocal !== false,
        message.payload.includeExternal !== false,
        additionalMcpBackend,
        SIDEPANEL_COLLABORATION_AVAILABLE_TOOLS,
        message.payload.externalServerIds,
      );
      break;
    case WS_COMMANDS.MCP_TOOL_CALL:
      if (isCollaborationToolName(message.payload.call.toolName)) {
        await handleCollaborationTool(
          socket,
          message.requestId,
          message.payload.call.toolName,
          message.payload.call.args,
          clientSessionIds.get(socket),
          broadcastToObservers,
          {
            actor: "extension_agent",
            clientId: connectionId,
            executionBroker,
            connectionId,
          },
        );
        break;
      }
      await handlePluginRequestedMcpTool(
        socket,
        message.requestId,
        message.payload.call.toolName,
        message.payload.call.args,
        callBrowserTool,
        authorizeTool,
        executionBroker,
        connectionId,
        clientSessionIds.get(socket),
        message.deadlineAt,
        message.idempotencyKey,
        artifactStore,
        false,
        stateStore,
        "extension_agent",
        message.payload.taskContext,
        additionalMcpBackend,
      );
      break;
    case WS_COMMANDS.BROWSER_TOOL_RESULT:
      await resolveBrowserToolResult(
        socket,
        message.requestId,
        message.payload as BrowserToolResultPayload,
        pendingToolRequests,
        artifactStore,
      );
      break;
    case WS_COMMANDS.BROWSER_TOOL_CALL:
      sendBrowserToolResult(socket, message.requestId, {
        ok: false,
        error: "Clients cannot initiate raw browser tool calls; use a registered MCP tool.",
      });
      break;
    default:
      break;
  }
}

async function handlePublishedStateMessage(
  message: ValidPluginToMcpMessage,
  sessionId: string | undefined,
  artifactStore: ArtifactStore,
  broadcastToObservers: (message: ValidPluginToMcpMessage) => void,
  allowActiveTabUpdate: boolean,
  sourceRole: WsClientRole | "unknown",
): Promise<boolean> {
  switch (message.command) {
    case WS_COMMANDS.ACTIVE_TAB_UPDATED:
      if (!allowActiveTabUpdate) {
        return false;
      }
      browserStateHub.setCurrentTab(message.payload.activeTab, sessionId);
      broadcastToObservers(message);
      return true;
    case WS_COMMANDS.ELEMENT_SELECTED:
      browserStateHub.setElementSelected(message.payload, sessionId);
      broadcastToObservers(message);
      return true;
    case WS_COMMANDS.PLUGIN_CHAT_MESSAGE_CREATED:
      browserStateHub.addPluginMessage(message.payload.message, sessionId);
      broadcastToObservers(message);
      return true;
    case WS_COMMANDS.PLUGIN_CONVERSATION_STARTED:
      browserStateHub.startPluginConversation(
        message.payload.conversationId,
        sessionId,
      );
      broadcastToObservers(message);
      return true;
    case WS_COMMANDS.SCREENSHOT_CAPTURED:
      try {
        const effectiveSessionId = sessionId ?? "default";
        const screenshot = await persistScreenshotArtifact(
          message.payload.screenshot,
          effectiveSessionId,
          artifactStore,
        );
        browserStateHub.setLastScreenshot(
          stripScreenshotBytes(screenshot),
          effectiveSessionId,
        );
        broadcastToObservers({
          ...message,
          payload: { screenshot: stripScreenshotBytes(screenshot) },
        });
      } catch (error) {
        console.error(
          `[ai-devtools-daemon] screenshot artifact persistence failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return true;
    case WS_COMMANDS.PAGE_CONTEXT_UPDATED:
      {
        const result = browserStateHub.setPageContextWithResult(
        message.payload.activeTab,
        message.payload.pageContext as PageSnapshot,
        sessionId,
        );
        if (result.accepted) {
          broadcastToObservers(message);
        } else {
          console.error(
            `[ai-devtools-daemon] page context rejected: code=PAGE_CONTEXT_TARGET_MISMATCH role=${sourceRole} sessionBound=${Boolean(sessionId)} fields=${result.mismatchFields.join(",")}`,
          );
        }
      }
      return true;
    case WS_COMMANDS.AGENT_SESSION_SYNC:
      browserStateHub.setAgentSession(message.payload.session, sessionId);
      broadcastToObservers(message);
      return true;
    case WS_COMMANDS.BROWSER_ACTIVITY_EVENT:
      if (message.payload.event.summary.reason === "monitoring-started") {
        browserStateHub.setActivityActive(
          true,
          sessionId,
          message.payload.event.target,
        );
      } else if (
        message.payload.event.summary.reason === "monitoring-stopped"
      ) {
        browserStateHub.setActivityActive(
          false,
          sessionId,
          message.payload.event.target,
        );
      }
      if (
        !browserStateHub.addBrowserActivityEvent(
          message.payload.event,
          sessionId,
        )
      ) {
        return true;
      }
      broadcastToObservers(message);
      return true;
    case WS_COMMANDS.COLLABORATION_ITEM_UPSERT: {
      const result = browserStateHub.upsertCollaborationItem(
        message.payload.item,
        {
          actor: "extension_agent",
          clientId: sourceRole === "unknown" ? undefined : sourceRole,
        },
        sessionId,
        { allowOwnerLastWriteWithoutRevision: true },
      );
      broadcastToObservers({
        requestId: createMessageId(),
        command: WS_COMMANDS.COLLABORATION_WORKSPACE_UPDATED,
        sentAt: new Date().toISOString(),
        payload: result,
      });
      return true;
    }
    default:
      return false;
  }
}

async function handleUiMessage(
  socket: WebSocket,
  message: ValidPluginToMcpMessage,
  callBrowserTool: BrowserToolCaller,
  authorizeTool: ToolAuthorizer,
  executionBroker: ExecutionBroker,
  connectionId: string,
  boundSessionId: string | undefined,
  artifactStore: ArtifactStore,
  stateStore: DaemonStateStore | undefined,
  broadcastToObservers: (message: ValidPluginToMcpMessage) => void,
  additionalMcpBackend?: AdditionalMcpToolBackend,
): Promise<void> {
  if (await handlePublishedStateMessage(
    message,
    boundSessionId,
    artifactStore,
    broadcastToObservers,
    false,
    "ui",
  )) {
    return;
  }

  switch (message.command) {
    case WS_COMMANDS.MCP_LIST_TOOLS:
      await handlePluginRequestedMcpToolList(
        socket,
        message.requestId,
        message.payload.includeLocal !== false,
        message.payload.includeExternal !== false,
        additionalMcpBackend,
        SIDEPANEL_COLLABORATION_AVAILABLE_TOOLS,
        message.payload.externalServerIds,
      );
      break;
    case WS_COMMANDS.MCP_TOOL_CALL:
      if (isCollaborationToolName(message.payload.call.toolName)) {
        await handleCollaborationTool(
          socket,
          message.requestId,
          message.payload.call.toolName,
          message.payload.call.args,
          boundSessionId,
          broadcastToObservers,
          {
            actor: "extension_agent",
            clientId: connectionId,
            executionBroker,
            connectionId,
          },
        );
        break;
      }
      await handlePluginRequestedMcpTool(
        socket,
        message.requestId,
        message.payload.call.toolName,
        message.payload.call.args,
        callBrowserTool,
        authorizeTool,
        executionBroker,
        connectionId,
        boundSessionId,
        message.deadlineAt,
        message.idempotencyKey,
        artifactStore,
        false,
        stateStore,
        "extension_agent",
        message.payload.taskContext,
        additionalMcpBackend,
      );
      break;
    case WS_COMMANDS.EXTERNAL_MCP_LIST:
    case WS_COMMANDS.EXTERNAL_MCP_UPSERT:
    case WS_COMMANDS.EXTERNAL_MCP_REMOVE:
    case WS_COMMANDS.EXTERNAL_MCP_SET_ENABLED:
    case WS_COMMANDS.EXTERNAL_MCP_SET_READ_ONLY_TRUST:
    case WS_COMMANDS.EXTERNAL_MCP_SET_AUTO_APPROVE:
    case WS_COMMANDS.EXTERNAL_MCP_SET_TOOL_POLICY:
    case WS_COMMANDS.EXTERNAL_MCP_TEST:
      await handleExternalMcpManagement(
        socket,
        message,
        additionalMcpBackend,
      );
      break;
    case WS_COMMANDS.BROWSER_TOOL_CALL:
      sendBrowserToolResult(socket, message.requestId, {
        ok: false,
        error: "UI clients must invoke registered MCP tools, not raw browser tools.",
      });
      break;
    case WS_COMMANDS.LOCAL_UPDATE_CHECK:
      await handleLocalUpdateCheck(socket, message.requestId);
      break;
    case WS_COMMANDS.LOCAL_UPDATE:
      await handleLocalUpdateRun(socket, message.requestId);
      break;
    case WS_COMMANDS.LOCAL_SERVICE_STATUS:
      await handleLocalServiceStatus(socket, message.requestId);
      break;
    case WS_COMMANDS.LOCAL_SERVICE_SET:
      await handleLocalServiceSet(
        socket,
        message.requestId,
        message.payload.enabled,
      );
      break;
    default:
      break;
  }
}

async function handleObserverMessage(
  socket: WebSocket,
  message: ValidPluginToMcpMessage,
  additionalMcpBackend?: AdditionalMcpToolBackend,
): Promise<void> {
  switch (message.command) {
    case WS_COMMANDS.MCP_LIST_TOOLS:
      await handlePluginRequestedMcpToolList(
        socket,
        message.requestId,
        message.payload.includeLocal !== false,
        message.payload.includeExternal !== false,
        additionalMcpBackend,
        [],
        message.payload.externalServerIds,
      );
      break;
    case WS_COMMANDS.MCP_TOOL_CALL:
      sendMcpToolResult(socket, message.requestId, {
        ok: false,
        toolName: message.payload.call.toolName,
        error: "Observer clients cannot initiate MCP tool calls.",
      });
      break;
    case WS_COMMANDS.BROWSER_TOOL_CALL:
      sendBrowserToolResult(socket, message.requestId, {
        ok: false,
        error: "Observer clients cannot initiate browser tool calls.",
      });
      break;
    default:
      break;
  }
}

async function handleMcpAdapterMessage(
  socket: WebSocket,
  message: ValidPluginToMcpMessage,
  boundSessionId: string | undefined,
  callBrowserTool: BrowserToolCaller,
  authorizeTool: ToolAuthorizer,
  executionBroker: ExecutionBroker,
  connectionId: string,
  artifactStore: ArtifactStore,
  stateStore: DaemonStateStore | undefined,
  broadcastToObservers: (message: ValidPluginToMcpMessage) => void,
  additionalMcpBackend?: AdditionalMcpToolBackend,
  setBoundSessionId?: (sessionId: string) => void,
): Promise<void> {
  switch (message.command) {
    case WS_COMMANDS.MCP_LIST_TOOLS:
      await handlePluginRequestedMcpToolList(
        socket,
        message.requestId,
        message.payload.includeLocal !== false,
        message.payload.includeExternal !== false,
        additionalMcpBackend,
        [
          ...ADAPTER_ROUTING_AVAILABLE_TOOLS,
          ...MCP_COLLABORATION_AVAILABLE_TOOLS,
        ],
        message.payload.externalServerIds,
      );
      break;
    case WS_COMMANDS.MCP_TOOL_CALL:
      if (isAdapterRoutingToolName(message.payload.call.toolName)) {
        await handleAdapterRoutingTool(
          socket,
          message.requestId,
          message.payload.call.toolName,
          message.payload.call.args,
          boundSessionId,
          setBoundSessionId,
        );
        break;
      }
      if (isCollaborationToolName(message.payload.call.toolName)) {
        await handleCollaborationTool(
          socket,
          message.requestId,
          message.payload.call.toolName,
          message.payload.call.args,
          boundSessionId,
          broadcastToObservers,
          {
            actor: "mcp_agent",
            clientId: connectionId,
            executionBroker,
            connectionId,
          },
        );
        break;
      }
      await handlePluginRequestedMcpTool(
        socket,
        message.requestId,
        message.payload.call.toolName,
        message.payload.call.args,
        callBrowserTool,
        authorizeTool,
        executionBroker,
        connectionId,
        boundSessionId,
        message.deadlineAt,
        message.idempotencyKey,
        artifactStore,
        true,
        stateStore,
        "mcp_adapter",
        message.payload.taskContext,
        additionalMcpBackend,
      );
      break;
    case WS_COMMANDS.STATE_GET:
      try {
        if (!isDirectMcpStateResource(message.payload.key)) {
          throw new ExecutionBrokerError(
            "APPROVAL_REQUIRED",
            `Sensitive state resource ${message.payload.key} is not directly readable; use its approval-gated MCP tool.`,
          );
        }
        if (
          boundSessionId &&
          message.payload.sessionId &&
          message.payload.sessionId !== boundSessionId
        ) {
          throw new ExecutionBrokerError(
            "ROLE_FORBIDDEN",
            "A session-bound MCP adapter cannot override its browser session in STATE_GET.",
          );
        }
        sendStateGetResult(socket, message.requestId, {
          ok: true,
          key: message.payload.key,
          data: readBrowserStateResource(
            message.payload.key,
            boundSessionId ?? message.payload.sessionId,
          ),
        });
      } catch (error) {
        sendStateGetResult(socket, message.requestId, {
          ok: false,
          key: message.payload.key,
          error:
            error instanceof Error ? error.message : "Failed to read daemon state.",
        });
      }
      break;
    case WS_COMMANDS.ARTIFACT_GET: {
      try {
        if (!boundSessionId) {
          throw new Error(
            "Artifact reads require AI_DEVTOOLS_SESSION_ID so resources cannot follow the global active-session fallback.",
          );
        }
        const artifact = await artifactStore.read(
          message.payload.artifactId,
          boundSessionId,
        );
        if (!artifact) {
          sendArtifactGetResult(socket, message.requestId, {
            ok: false,
            artifactId: message.payload.artifactId,
            error: "Artifact was not found, expired, or belongs to another browser session.",
          });
          break;
        }
        const artifactPayload: ArtifactGetResultPayload = {
          ok: true,
          artifact: artifact.metadata,
          dataBase64: Buffer.from(artifact.bytes).toString("base64"),
        };
        await recordToolAuditBestEffort(
          stateStore,
          message.requestId,
          boundSessionId,
          "artifact.read",
          { artifactId: message.payload.artifactId },
          "sensitive_read",
          browserStateHub.snapshot(boundSessionId).revision,
          "completed",
          undefined,
          {
            egressClass:
              artifact.metadata.kind === "screenshot"
                ? "screenshot_artifact"
                : "payload_artifact",
            egressBytes: serializedEgressPayloadBytes(artifactPayload),
            egressDestination: "mcp_adapter",
          },
        );
        sendArtifactGetResult(socket, message.requestId, artifactPayload);
      } catch (error) {
        sendArtifactGetResult(socket, message.requestId, {
          ok: false,
          artifactId: message.payload.artifactId,
          error:
            error instanceof Error ? error.message : "Failed to read artifact.",
        });
      }
      break;
    }
    case WS_COMMANDS.BROWSER_TOOL_CALL:
      sendBrowserToolResult(socket, message.requestId, {
        ok: false,
        error: "MCP adapters must invoke registered MCP tools, not raw browser tools.",
      });
      break;
    default:
      break;
  }
}

async function handleCollaborationTool(
  socket: WebSocket,
  requestId: string,
  toolName: string,
  args: Record<string, unknown>,
  boundSessionId: string | undefined,
  broadcastToObservers: (message: ValidPluginToMcpMessage) => void,
  context: {
    actor: "extension_agent" | "mcp_agent";
    clientId: string;
    executionBroker: ExecutionBroker;
    connectionId: string;
  },
): Promise<void> {
  try {
    if (!isCollaborationToolName(toolName)) {
      throw new ExecutionBrokerError(
        "ROLE_FORBIDDEN",
        "Unknown local collaboration tool.",
      );
    }
    if (!boundSessionId) {
      throw new ExecutionBrokerError(
        "STALE_CONTEXT",
        "Call browser_list_sessions and browser_set_session before publishing collaboration context.",
      );
    }
    let data: unknown;
    let mutation:
      | ReturnType<typeof browserStateHub.upsertCollaborationItem>
      | undefined;

    if (toolName === COLLABORATION_TOOL_NAMES.PUBLISH_ITEM) {
      const parsed = parsePublishCollaborationItemArgs(args);
      const { scope, ...itemInput } = parsed;
      const currentTab = browserStateHub.snapshot(boundSessionId).currentTab;
      if (scope === "target" && !currentTab) {
        throw new ExecutionBrokerError(
          "STALE_CONTEXT",
          "The selected Chrome Profile has no current page target for a target-scoped collaboration item.",
        );
      }
      mutation = browserStateHub.upsertCollaborationItem(
        {
          ...itemInput,
          ...(scope === "target" ? { target: currentTab } : {}),
        },
        {
          actor: context.actor,
          clientId: context.clientId,
        },
        boundSessionId,
      );
      data = {
        workspaceRevision: mutation.workspace.revision,
        item: mutation.item,
      };
    } else if (toolName === COLLABORATION_TOOL_NAMES.DELEGATE_TASK) {
      assertCollaborationActor(context.actor, "mcp_agent", toolName);
      const result = delegateCollaborationTask(
        parseDelegateCollaborationTaskArgs(args),
        boundSessionId,
        context.clientId,
      );
      data = result.data;
      mutation = result.mutation;
    } else if (toolName === COLLABORATION_TOOL_NAMES.WAIT_FOR_TASK_RESULT) {
      assertCollaborationActor(context.actor, "mcp_agent", toolName);
      const parsed = parseWaitForCollaborationResultArgs(args);
      data = await context.executionBroker.waitForInput({
        connectionId: context.connectionId,
        requestId,
        run: (signal) =>
          waitForCollaborationTaskResult(
            parsed.taskId,
            boundSessionId,
            signal,
          ),
      });
    } else if (toolName === COLLABORATION_TOOL_NAMES.UPDATE_TASK) {
      const result = updateCollaborationTask(
        parseUpdateCollaborationTaskArgs(args),
        boundSessionId,
        context.clientId,
        context.actor,
      );
      data = result.data;
      mutation = result.mutation;
    } else if (toolName === COLLABORATION_TOOL_NAMES.CANCEL_TASK) {
      assertCollaborationActor(context.actor, "mcp_agent", toolName);
      const result = cancelCollaborationTask(
        parseCancelCollaborationTaskArgs(args),
        boundSessionId,
        context.clientId,
      );
      data = result.data;
      mutation = result.mutation;
    } else if (toolName === COLLABORATION_TOOL_NAMES.CLAIM_TASK) {
      assertCollaborationActor(context.actor, "extension_agent", toolName);
      const result = claimCollaborationTask(
        parseClaimCollaborationTaskArgs(args),
        boundSessionId,
        context.clientId,
      );
      data = result.data;
      mutation = result.mutation;
    } else {
      assertCollaborationActor(context.actor, "extension_agent", toolName);
      const result = completeCollaborationTask(
        parseCompleteCollaborationTaskArgs(args),
        boundSessionId,
        context.clientId,
      );
      data = result.data;
      mutation = result.mutation;
    }

    if (mutation) {
      broadcastToObservers({
        requestId: createMessageId(),
        command: WS_COMMANDS.COLLABORATION_WORKSPACE_UPDATED,
        sentAt: new Date().toISOString(),
        payload: mutation,
      });
    }
    sendMcpToolResult(socket, requestId, {
      ok: true,
      toolName,
      data,
    });
  } catch (error) {
    sendMcpToolResult(socket, requestId, {
      ok: false,
      toolName,
      errorCode: protocolErrorCode(error),
      error:
        error instanceof Error
          ? error.message
          : "Failed to publish local collaboration context.",
    });
  }
}

function assertCollaborationActor(
  actual: "extension_agent" | "mcp_agent",
  expected: "extension_agent" | "mcp_agent",
  toolName: string,
): void {
  if (actual !== expected) {
    throw new ExecutionBrokerError(
      "ROLE_FORBIDDEN",
      `${toolName} is available only to ${expected}.`,
    );
  }
}

async function handleAdapterRoutingTool(
  socket: WebSocket,
  requestId: string,
  toolName: string,
  args: Record<string, unknown>,
  boundSessionId: string | undefined,
  setBoundSessionId: ((sessionId: string) => void) | undefined,
): Promise<void> {
  try {
    if (!isAdapterRoutingToolName(toolName) || !setBoundSessionId) {
      throw new ExecutionBrokerError(
        "ROLE_FORBIDDEN",
        "Adapter session routing tools are available only to MCP adapter connections.",
      );
    }
    const parsedArgs = parseAdapterRoutingToolArgs(toolName, args);
    let selectedSessionId = boundSessionId;
    if (toolName === ADAPTER_ROUTING_TOOL_NAMES.SET_SESSION) {
      const requestedSessionId = parsedArgs.sessionId as string;
      if (!browserStateHub.hasSession(requestedSessionId)) {
        throw new ExecutionBrokerError(
          "STALE_CONTEXT",
          `Unknown browser session: ${requestedSessionId}. Call browser_list_sessions and select a current sessionId.`,
        );
      }
      setBoundSessionId(requestedSessionId);
      selectedSessionId = requestedSessionId;
    }
    sendMcpToolResult(socket, requestId, {
      ok: true,
      toolName,
      data: {
        selectionMode: selectedSessionId ? "explicit" : "active_fallback",
        selectedSessionId: selectedSessionId ?? null,
        sessions: browserStateHub.listSessionSummaries(selectedSessionId),
      },
    });
  } catch (error) {
    sendMcpToolResult(socket, requestId, {
      ok: false,
      toolName,
      errorCode: protocolErrorCode(error),
      error:
        error instanceof Error ? error.message : "Adapter session routing failed.",
    });
  }
}

function handleClientHello(
  socket: WebSocket,
  payload: ClientHelloPayload,
  clientRoles: Map<WebSocket, WsClientRole | "unknown">,
  clientSessionIds: Map<WebSocket, string>,
  registerPluginSocket: () => void,
  registerBrowserSocket: (sessionId?: string) => void,
  replayStateToObserver: () => void,
  connectionId: string,
  assignedRole: WsClientRole | undefined,
): void {
  if (!assignedRole) {
    throw new Error("AUTH_INVALID: daemon did not assign a client role.");
  }
  clientRoles.set(socket, assignedRole);
  if (payload.sessionId) {
    clientSessionIds.set(socket, payload.sessionId);
  }

  if (assignedRole === "plugin") {
    registerPluginSocket();
    sendServerWelcome(socket, connectionId, payload, assignedRole);
    return;
  }

  if (assignedRole === "browser") {
    registerBrowserSocket(payload.sessionId);
    sendServerWelcome(socket, connectionId, payload, assignedRole);
    return;
  }

  if (assignedRole === "ui" || assignedRole === "observer") {
    browserStateHub.connect("ui", payload.sessionId);
    replayStateToObserver();
  }
  sendServerWelcome(socket, connectionId, payload, assignedRole);
}

async function handlePluginRequestedMcpTool(
  socket: WebSocket,
  requestId: string,
  toolName: string,
  args: Record<string, unknown>,
  callBrowserTool: BrowserToolCaller,
  authorizeTool: ToolAuthorizer,
  executionBroker: ExecutionBroker,
  connectionId: string,
  boundSessionId: string | undefined,
  deadlineAt: string | undefined,
  idempotencyKey: string | undefined,
  artifactStore: ArtifactStore,
  externalizeLargeResults: boolean,
  stateStore: DaemonStateStore | undefined,
  egressDestination: EgressDestination,
  taskContext?: ToolTaskContext,
  additionalMcpBackend?: AdditionalMcpToolBackend,
): Promise<void> {
  const normalizedToolName = normalizeMcpToolName(toolName);
  const lifecycleStartedAt = Date.now();
  let approvalWaitMs = 0;
  let queueWaitMs = 0;
  let executionStartedAt = lifecycleStartedAt;
  let transportMs = 0;
  try {
    if (isAdapterRoutingToolName(toolName)) {
      throw new ExecutionBrokerError(
        "ROLE_FORBIDDEN",
        "Adapter session routing tools are available only to MCP adapter connections.",
      );
    }
    if (normalizedToolName && !isExposedMcpToolName(normalizedToolName)) {
      throw new Error(`MCP tool is disabled by daemon policy: ${normalizedToolName}`);
    }
    const validatedArgs = normalizedToolName
      ? parseMcpToolArgs(normalizedToolName, args)
      : args;
    const effectiveToolName = normalizedToolName ?? toolName;
    const sessionId =
      boundSessionId ?? browserStateHub.getActiveSession().sessionId;
    const policy = resolveMcpToolPolicy(
      additionalMcpBackend,
      effectiveToolName,
      validatedArgs,
    );
    const authorizationStartedAt = Date.now();
    const authorization = await executionBroker.waitForInput({
      connectionId,
      requestId,
      run: (signal) =>
        authorizeTool(socket, effectiveToolName, validatedArgs, {
          signal,
          requestId,
          taskContext,
        }),
    });
    approvalWaitMs = Date.now() - authorizationStartedAt;
    const executionDeadlineAt = authorization.approvalRequired
      ? new Date(Date.now() + PROTOCOL_LIMITS.maxRequestDeadlineMs).toISOString()
      : deadlineAt;
    const targetId = authorization.target?.targetId ??
      (authorization.target?.tabId !== undefined
        ? String(authorization.target.tabId)
        : "active");
    executionStartedAt = Date.now();
    const data = await executionBroker.execute({
      connectionId,
      requestId,
      sessionId,
      targetKey: `${sessionId}:${targetId}`,
      toolName: effectiveToolName,
      args: validatedArgs,
      deadlineAt: executionDeadlineAt,
      idempotencyKey,
      mutates: policy.mutatesBrowser,
      onStarted: (observedQueueWaitMs) => {
        queueWaitMs = observedQueueWaitMs;
        executionStartedAt = Date.now();
      },
      run: async (signal) => {
        if (normalizedToolName) {
          return browserStateHub.runWithTaskTarget(
            sessionId,
            authorization.target,
            () =>
              executeMcpToolData(
                normalizedToolName,
                validatedArgs,
                {
                  close: async () => undefined,
                  ready: async () => ({ host: "127.0.0.1", port: 17321 }),
                  connectedClients: () => 1,
                  connectedPluginClients: () => 1,
                  callBrowserTool: (call, options) =>
                    callBrowserTool(call, {
                      ...options,
                      signal,
                      deadlineAt: executionDeadlineAt,
                      idempotencyKey,
                      authorization,
                    }),
                },
                {
                  sessionId,
                  storeJsonArtifact: (value) =>
                    artifactStore.putBytes(
                      sessionId,
                      "payload",
                      "application/json",
                      Buffer.from(JSON.stringify(value), "utf8"),
                    ),
                  readJsonArtifact: async (artifactId) => {
                    const artifact = await artifactStore.read(
                      artifactId,
                      sessionId,
                    );
                    if (!artifact) {
                      throw new Error(
                        "RECIPE_NOT_FOUND: artifact was not found, expired, or belongs to another browser session.",
                      );
                    }
                    if (artifact.metadata.mimeType !== "application/json") {
                      throw new Error(
                        "RECIPE_INVALID: artifact MIME type is not application/json.",
                      );
                    }
                    return JSON.parse(
                      Buffer.from(artifact.bytes).toString("utf8"),
                    );
                  },
                  ...(stateStore
                    ? { listAuditEvents: () => stateStore.listAuditEvents() }
                    : {}),
                },
              ),
          );
        }
        if (additionalMcpBackend) {
          return additionalMcpBackend.callTool(toolName, validatedArgs, {
            signal,
          });
        }
        throw new Error(`Unsupported MCP tool: ${toolName}`);
      },
    });
    const executionFinishedAt = Date.now();
    const responseData = externalizeLargeResults
      ? await externalizeLargeJsonResult(data, sessionId, artifactStore)
      : data;
    const resultPayload: McpToolResultPayload = {
      ok: true,
      toolName: effectiveToolName,
      data: normalizeBrowserToolResultData(responseData),
    };
    const serializedResult = JSON.stringify(resultPayload);
    transportMs = authorization.timing.transportMs;
    const lifecycleMetrics = {
      approvalWaitMs: Math.max(0, Math.round(approvalWaitMs)),
      queueWaitMs: Math.max(0, Math.round(queueWaitMs)),
      executorMs: Math.max(0, executionFinishedAt - executionStartedAt),
      transportMs: Math.max(0, Math.round(transportMs)),
      totalMs: Math.max(0, Date.now() - lifecycleStartedAt),
      resultChars: serializedResult.length,
      payloadBytes: Buffer.byteLength(serializedResult, "utf8"),
    };
    const egress = policy.sensitive
      ? {
          egressClass: classifySensitiveEgress(effectiveToolName),
          egressBytes: serializedEgressPayloadBytes(resultPayload),
          egressDestination,
        }
      : undefined;
    await recordToolAuditBestEffort(
      stateStore,
      requestId,
      sessionId,
      effectiveToolName,
      args,
      policy.policyClass,
      browserStateHub.snapshot(sessionId).revision,
      "completed",
      undefined,
      egress,
      lifecycleMetrics,
    );
    sendMcpToolResult(socket, requestId, resultPayload);
  } catch (error) {
    const failedSessionId =
      boundSessionId ?? browserStateHub.getActiveSession().sessionId;
    const failedToolName = normalizedToolName ?? toolName;
    const failedPolicy = resolveMcpToolPolicy(
      additionalMcpBackend,
      failedToolName,
      args,
    );
    await recordToolAuditBestEffort(
      stateStore,
      requestId,
      failedSessionId,
      failedToolName,
      args,
      failedPolicy.policyClass,
      browserStateHub.snapshot(failedSessionId).revision,
      "failed",
      protocolErrorCode(error),
      undefined,
      {
        approvalWaitMs: Math.max(0, Math.round(approvalWaitMs)),
        queueWaitMs: Math.max(0, Math.round(queueWaitMs)),
        executorMs: Math.max(0, Date.now() - executionStartedAt),
        transportMs: Math.max(0, Math.round(transportMs)),
        totalMs: Math.max(0, Date.now() - lifecycleStartedAt),
        resultChars: 0,
        payloadBytes: 0,
      },
    );
    sendMcpToolResult(socket, requestId, {
      ok: false,
      toolName: normalizedToolName ?? toolName,
      errorCode: protocolErrorCode(error),
      error: error instanceof Error ? error.message : "MCP tool failed.",
    });
  }
}

async function handleExternalMcpManagement(
  socket: WebSocket,
  message: ValidPluginToMcpMessage,
  backend?: AdditionalMcpToolBackend,
): Promise<void> {
  if (!backend?.listServers) {
    sendExternalMcpResult(socket, message.requestId, {
      ok: false,
      servers: [],
      error: "当前 daemon 未启用外部 MCP 管理器。",
    });
    return;
  }
  try {
    let servers: ExternalMcpServerSummary[];
    switch (message.command) {
      case WS_COMMANDS.EXTERNAL_MCP_LIST:
        servers = backend.listServers();
        break;
      case WS_COMMANDS.EXTERNAL_MCP_UPSERT:
        if (!backend.upsertServer) throw new Error("MCP 配置写入不可用。");
        servers = await backend.upsertServer(message.payload.server);
        break;
      case WS_COMMANDS.EXTERNAL_MCP_REMOVE:
        if (!backend.removeServer) throw new Error("MCP 配置删除不可用。");
        servers = await backend.removeServer(message.payload.serverId);
        break;
      case WS_COMMANDS.EXTERNAL_MCP_SET_ENABLED:
        if (!backend.setServerEnabled) throw new Error("MCP 启停不可用。");
        servers = await backend.setServerEnabled(
          message.payload.serverId,
          message.payload.enabled,
        );
        break;
      case WS_COMMANDS.EXTERNAL_MCP_SET_READ_ONLY_TRUST:
        if (!backend.setServerReadOnlyTrust) {
          throw new Error("MCP 只读信任设置不可用。");
        }
        servers = await backend.setServerReadOnlyTrust(
          message.payload.serverId,
          message.payload.trusted,
        );
        break;
      case WS_COMMANDS.EXTERNAL_MCP_SET_AUTO_APPROVE:
        if (!backend.setServerAutoApprove) {
          throw new Error("MCP 自动运行设置不可用。");
        }
        servers = await backend.setServerAutoApprove(
          message.payload.serverId,
          message.payload.enabled,
        );
        break;
      case WS_COMMANDS.EXTERNAL_MCP_SET_TOOL_POLICY:
        if (!backend.setToolPolicy) {
          throw new Error("MCP 工具策略设置不可用。");
        }
        servers = await backend.setToolPolicy(
          message.payload.serverId,
          message.payload.toolName,
          {
            ...(message.payload.enabled !== undefined
              ? { enabled: message.payload.enabled }
              : {}),
            ...(message.payload.approval
              ? { approval: message.payload.approval }
              : {}),
          },
        );
        break;
      case WS_COMMANDS.EXTERNAL_MCP_TEST:
        if (!backend.testServer) throw new Error("MCP 连接测试不可用。");
        servers = await backend.testServer(message.payload.serverId);
        break;
      default:
        return;
    }
    sendExternalMcpResult(socket, message.requestId, { ok: true, servers });
  } catch (error) {
    sendExternalMcpResult(socket, message.requestId, {
      ok: false,
      servers: backend.listServers(),
      error: error instanceof Error ? error.message : "外部 MCP 操作失败。",
    });
  }
}

function resolveMcpToolPolicy(
  backend: AdditionalMcpToolBackend | undefined,
  toolName: string,
  args: Record<string, unknown>,
): ToolPolicy {
  return backend?.getToolPolicy?.(toolName, args) ?? getToolPolicy(toolName, args);
}

function sendExternalMcpResult(
  socket: WebSocket,
  requestId: string,
  payload: ExternalMcpResultPayload,
): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  const message: McpToPluginMessage = {
    requestId,
    command: WS_COMMANDS.EXTERNAL_MCP_RESULT,
    sentAt: new Date().toISOString(),
    payload,
  };
  socket.send(JSON.stringify(message));
}

async function handlePluginRequestedMcpToolList(
  socket: WebSocket,
  requestId: string,
  includeLocal: boolean,
  includeExternal: boolean,
  additionalMcpBackend?: AdditionalMcpToolBackend,
  connectionLocalTools: readonly McpAvailableTool[] = [],
  externalServerIds?: string[],
): Promise<void> {
  try {
    const localTools = includeLocal ? listRuntimeMcpTools() : [];
    const externalTools = includeExternal && additionalMcpBackend
      ? await additionalMcpBackend.listTools({ serverIds: externalServerIds })
      : [];
    const deduped = new Map<string, McpAvailableTool>();

    for (const tool of [
      ...externalTools,
      ...localTools,
      ...(includeLocal ? connectionLocalTools : []),
    ]) {
      deduped.set(tool.name, tool);
    }

    sendMcpToolListResult(socket, requestId, {
      ok: true,
      tools: Array.from(deduped.values()),
    });
  } catch (error) {
    sendMcpToolListResult(socket, requestId, {
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to list MCP tools.",
    });
  }
}

async function resolveBrowserToolResult(
  socket: WebSocket,
  requestId: string,
  payload: BrowserToolResultPayload,
  pendingToolRequests: Map<string, PendingBrowserToolRequest>,
  artifactStore: ArtifactStore,
): Promise<void> {
  const pending = pendingToolRequests.get(requestId);
  if (!pending) {
    return;
  }
  if (pending.browserSocket !== socket) {
    return;
  }

  pendingToolRequests.delete(requestId);
  clearTimeout(pending.timeout);
  pending.cleanup?.();
  pending.markTransportComplete();

  if (payload.ok) {
    if (isScreenshotCaptureResult(payload.data)) {
      try {
        pending.resolve(
          await persistScreenshotArtifact(
            payload.data,
            pending.sessionId ?? "default",
            artifactStore,
          ),
        );
      } catch (error) {
        pending.reject(
          error instanceof Error
            ? error
            : new Error("Failed to persist screenshot artifact."),
        );
      }
      return;
    }
    pending.resolve(payload.data);
    return;
  }

  pending.reject(
    payload.errorCode
      ? new ExecutionBrokerError(payload.errorCode, payload.error)
      : new Error(payload.error),
  );
}

async function persistScreenshotArtifact(
  screenshot: ScreenshotCaptureResult,
  sessionId: string,
  artifactStore: ArtifactStore,
): Promise<ScreenshotCaptureResult> {
  if (
    screenshot.dataUrl === `data:${screenshot.mimeType};base64,`
  ) {
    return screenshot;
  }
  const artifact = await artifactStore.putDataUrl(
    sessionId,
    "screenshot",
    screenshot.dataUrl,
  );
  return { ...screenshot, artifact };
}

function stripScreenshotBytes(
  screenshot: ScreenshotCaptureResult,
): ScreenshotCaptureResult {
  return {
    ...screenshot,
    dataUrl: `data:${screenshot.mimeType};base64,`,
  };
}

function isScreenshotCaptureResult(
  value: unknown,
): value is ScreenshotCaptureResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      "capturedAt" in value &&
      typeof value.capturedAt === "string" &&
      "mimeType" in value &&
      (value.mimeType === "image/png" || value.mimeType === "image/jpeg") &&
      "dataUrl" in value &&
      typeof value.dataUrl === "string",
  );
}

function sendBrowserToolResult(
  socket: WebSocket,
  requestId: string,
  payload: BrowserToolResultPayload,
): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }

  const message: McpToPluginMessage = {
    requestId,
    command: WS_COMMANDS.BROWSER_TOOL_RESULT,
    sentAt: new Date().toISOString(),
    payload,
  };
  socket.send(JSON.stringify(message));
}

let localUpdateInFlight = false;

async function handleLocalUpdateCheck(
  socket: WebSocket,
  requestId: string,
): Promise<void> {
  try {
    const result = await checkLocalUpdate(resolveProjectRootFromDaemon());
    sendLocalUpdateCheckResult(socket, requestId, result);
  } catch (error) {
    sendLocalUpdateCheckResult(socket, requestId, {
      ok: false,
      error: error instanceof Error ? error.message : "LOCAL_UPDATE_CHECK failed.",
    });
  }
}

async function handleLocalUpdateRun(
  socket: WebSocket,
  requestId: string,
): Promise<void> {
  if (localUpdateInFlight) {
    sendLocalUpdateResult(socket, requestId, {
      ok: false,
      error: "已有本地更新正在执行，请稍后再试。",
      projectRoot: resolveProjectRootFromDaemon(),
      restartScheduled: false,
    });
    return;
  }
  localUpdateInFlight = true;
  try {
    const result = await runLocalUpdate(resolveProjectRootFromDaemon(), {
      noRestart: true,
    });
    sendLocalUpdateResult(socket, requestId, {
      ...result,
      needsExtensionReload: result.ok,
      restartScheduled: result.ok,
    });
    if (result.ok) {
      scheduleDaemonRestartAfterUpdate();
    }
  } catch (error) {
    sendLocalUpdateResult(socket, requestId, {
      ok: false,
      error: error instanceof Error ? error.message : "LOCAL_UPDATE failed.",
      projectRoot: resolveProjectRootFromDaemon(),
      restartScheduled: false,
    });
  } finally {
    localUpdateInFlight = false;
  }
}

function scheduleDaemonRestartAfterUpdate(): void {
  // Give the websocket response time to flush before LaunchAgent/process exit.
  setTimeout(() => {
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
    if (process.platform === "darwin" && uid !== undefined) {
      const label = "com.ai-devtools-assistant.daemon";
      const printed = spawnSync(
        "/bin/launchctl",
        ["print", `gui/${uid}/${label}`],
        { encoding: "utf8" },
      );
      if (printed.status === 0) {
        const restarted = spawnSync(
          "/bin/launchctl",
          ["kickstart", "-k", `gui/${uid}/${label}`],
          { encoding: "utf8" },
        );
        if (restarted.status === 0) {
          return;
        }
      }
    }
    const projectRoot = resolveProjectRootFromDaemon();
    const helperCandidates = [
      join(projectRoot, "runtime", "restart-daemon.mjs"),
      join(projectRoot, "scripts", "restart-daemon.mjs"),
    ];
    const helperPath = helperCandidates.find((candidate) => existsSync(candidate));
    const serverPath = process.argv[1] ? resolve(process.argv[1]) : "";
    if (!helperPath || !serverPath.endsWith(".js")) {
      console.error(
        "[ai-devtools-daemon] update installed, but automatic restart helper is unavailable; restart the daemon manually.",
      );
      return;
    }
    const restartHelper = spawn(
      process.execPath,
      [
        helperPath,
        "--wait-pid",
        String(process.pid),
        "--server-path",
        serverPath,
        "--cwd",
        projectRoot,
        "--pid-path",
        join(projectRoot, "daemon.pid"),
      ],
      {
        cwd: projectRoot,
        detached: true,
        stdio: "ignore",
        env: process.env,
      },
    );
    restartHelper.unref();
    setTimeout(() => process.exit(0), 250);
  }, 1_500);
}

function sendLocalUpdateCheckResult(
  socket: WebSocket,
  requestId: string,
  payload: import("../shared/wsProtocol").LocalUpdateCheckResultPayload,
): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  const message: McpToPluginMessage = {
    requestId,
    command: WS_COMMANDS.LOCAL_UPDATE_CHECK_RESULT,
    sentAt: new Date().toISOString(),
    payload,
  };
  socket.send(JSON.stringify(message));
}

function sendLocalUpdateResult(
  socket: WebSocket,
  requestId: string,
  payload: import("../shared/wsProtocol").LocalUpdateResultPayload,
): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  const message: McpToPluginMessage = {
    requestId,
    command: WS_COMMANDS.LOCAL_UPDATE_RESULT,
    sentAt: new Date().toISOString(),
    payload,
  };
  socket.send(JSON.stringify(message));
}

async function handleLocalServiceStatus(
  socket: WebSocket,
  requestId: string,
): Promise<void> {
  try {
    const result = await getLocalServiceStatus(resolveProjectRootFromDaemon());
    sendLocalServiceStatusResult(socket, requestId, result);
  } catch (error) {
    sendLocalServiceStatusResult(socket, requestId, {
      ok: false,
      error:
        error instanceof Error ? error.message : "LOCAL_SERVICE_STATUS failed.",
    });
  }
}

async function handleLocalServiceSet(
  socket: WebSocket,
  requestId: string,
  enabled: boolean,
): Promise<void> {
  try {
    const result = await setLocalServiceAutostart(
      enabled,
      resolveProjectRootFromDaemon(),
    );
    sendLocalServiceSetResult(socket, requestId, result);
  } catch (error) {
    sendLocalServiceSetResult(socket, requestId, {
      ok: false,
      error: error instanceof Error ? error.message : "LOCAL_SERVICE_SET failed.",
    });
  }
}

function sendLocalServiceStatusResult(
  socket: WebSocket,
  requestId: string,
  payload: import("../shared/wsProtocol").LocalServiceStatusResultPayload,
): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  const message: McpToPluginMessage = {
    requestId,
    command: WS_COMMANDS.LOCAL_SERVICE_STATUS_RESULT,
    sentAt: new Date().toISOString(),
    payload,
  };
  socket.send(JSON.stringify(message));
}

function sendLocalServiceSetResult(
  socket: WebSocket,
  requestId: string,
  payload: import("../shared/wsProtocol").LocalServiceSetResultPayload,
): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  const message: McpToPluginMessage = {
    requestId,
    command: WS_COMMANDS.LOCAL_SERVICE_SET_RESULT,
    sentAt: new Date().toISOString(),
    payload,
  };
  socket.send(JSON.stringify(message));
}

function sendMcpToolResult(
  socket: WebSocket,
  requestId: string,
  payload: McpToolResultPayload,
): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }

  const message: McpToPluginMessage = {
    requestId,
    command: WS_COMMANDS.MCP_TOOL_RESULT,
    sentAt: new Date().toISOString(),
    payload,
  };
  socket.send(JSON.stringify(message));
}

function sendMcpToolListResult(
  socket: WebSocket,
  requestId: string,
  payload: McpListToolsResultPayload,
): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }

  const message: McpToPluginMessage = {
    requestId,
    command: WS_COMMANDS.MCP_LIST_TOOLS_RESULT,
    sentAt: new Date().toISOString(),
    payload,
  };
  socket.send(JSON.stringify(message));
}

function sendStateGetResult(
  socket: WebSocket,
  requestId: string,
  payload: StateGetResultPayload,
): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }

  const message: McpToPluginMessage = {
    requestId,
    command: WS_COMMANDS.STATE_GET_RESULT,
    sentAt: new Date().toISOString(),
    payload,
  };
  socket.send(JSON.stringify(message));
}

function sendArtifactGetResult(
  socket: WebSocket,
  requestId: string,
  payload: ArtifactGetResultPayload,
): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  const message: McpToPluginMessage = {
    requestId,
    command: WS_COMMANDS.ARTIFACT_GET_RESULT,
    sentAt: new Date().toISOString(),
    payload,
  };
  socket.send(JSON.stringify(message));
}

function sendRequestCancel(
  socket: WebSocket,
  targetRequestId: string,
  reason: string,
): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  const message: McpToPluginMessage = {
    requestId: createMessageId(),
    command: WS_COMMANDS.REQUEST_CANCEL,
    sentAt: new Date().toISOString(),
    payload: { targetRequestId, reason },
  };
  socket.send(JSON.stringify(message));
}

function sendServerWelcome(
  socket: WebSocket,
  connectionId: string,
  hello: ClientHelloPayload,
  assignedRole: WsClientRole,
): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  const message: McpToPluginMessage = {
    requestId: createMessageId(),
    command: WS_COMMANDS.SERVER_WELCOME,
    sentAt: new Date().toISOString(),
    payload: {
      protocolVersion: WS_PROTOCOL_VERSION,
      buildId: RUNTIME_BUILD_ID,
      schemaHash: RUNTIME_SCHEMA_HASH,
      connectionId,
      assignedRole,
      ...(hello.sessionId ? { sessionId: hello.sessionId } : {}),
      limits: PROTOCOL_LIMITS,
    },
  };
  socket.send(JSON.stringify(message));
}

function sendRawMessage(socket: WebSocket, message: unknown): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function rejectAllPendingToolRequests(
  pendingToolRequests: Map<string, PendingBrowserToolRequest>,
  reason: string,
  browserSocket?: WebSocket,
): void {
  for (const [requestId, pending] of pendingToolRequests.entries()) {
    if (browserSocket && pending.browserSocket !== browserSocket) {
      continue;
    }
    clearTimeout(pending.timeout);
    pending.cleanup?.();
    pending.reject(new Error(reason));
    pendingToolRequests.delete(requestId);
  }
}

function rejectAllPendingApprovals(
  pendingApprovals: Map<string, PendingApproval>,
  reason: string,
): void {
  for (const [approvalId, pending] of pendingApprovals) {
    pending.cleanup?.();
    notifyApprovalCancelled(approvalId, pending, reason);
    pending.reject(new Error(reason));
    pendingApprovals.delete(approvalId);
  }
}

function notifyApprovalCancelled(
  approvalId: string,
  pending: PendingApproval,
  reason: string,
  excludedSocket?: WebSocket,
): void {
  const message: McpToPluginMessage = {
    requestId: createMessageId(),
    command: WS_COMMANDS.APPROVAL_CANCELLED,
    sentAt: new Date().toISOString(),
    payload: { approvalId, reason },
  };
  for (const socket of pending.allowedSockets) {
    if (socket === excludedSocket) {
      continue;
    }
    sendRawMessage(socket, message);
  }
}

function sendAck(socket: WebSocket, ack: McpWsAck): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(ack));
  }
}

function consumeConnectionMessage(
  connectionRates: Map<
    WebSocket,
    { windowStartedAt: number; messages: number }
  >,
  socket: WebSocket,
  now = Date.now(),
): boolean {
  const current = connectionRates.get(socket);
  if (!current || now - current.windowStartedAt >= 60_000) {
    connectionRates.set(socket, { windowStartedAt: now, messages: 1 });
    return true;
  }
  current.messages += 1;
  return current.messages <= PROTOCOL_LIMITS.maxMessagesPerMinute;
}

function safeJsonParse(
  raw: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return {
      ok: true,
      value: JSON.parse(raw) as unknown,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid JSON.",
    };
  }
}

function browserTimeoutMs(deadlineAt: string | undefined): number {
  if (!deadlineAt) {
    return 90_000;
  }
  const deadline = Date.parse(deadlineAt);
  if (!Number.isFinite(deadline) || deadline <= Date.now()) {
    throw new ExecutionBrokerError(
      "REQUEST_DEADLINE_EXCEEDED",
      "browser request deadline has already passed or is invalid.",
    );
  }
  return Math.min(90_000, Math.max(1, deadline - Date.now()));
}

function throwIfExecutionAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortReason(signal);
  }
}

function abortReason(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new ExecutionBrokerError("REQUEST_CANCELLED", "request cancelled.");
}

function raceWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortReason(signal));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

async function recordAuditEvent(
  stateStore: DaemonStateStore | undefined,
  event: RedactedAuditEvent,
): Promise<void> {
  if (!stateStore) {
    return;
  }
  await stateStore.appendAudit(event);
  await stateStore.flush();
}

async function recordToolAuditBestEffort(
  stateStore: DaemonStateStore | undefined,
  requestId: string,
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
  policyClass: string,
  revision: number,
  outcome: "completed" | "failed",
  errorCode?: string,
  egress?: Pick<
    RedactedAuditEvent,
    "egressClass" | "egressBytes" | "egressDestination"
  >,
  metrics?: Pick<
    RedactedAuditEvent,
    | "approvalWaitMs"
    | "queueWaitMs"
    | "executorMs"
    | "transportMs"
    | "totalMs"
    | "resultChars"
    | "payloadBytes"
  >,
): Promise<void> {
  try {
    if (!stateStore) {
      return;
    }
    await stateStore.appendAudit({
      id: createMessageId(),
      eventType: outcome === "completed" ? "tool.completed" : "tool.failed",
      timestamp: new Date().toISOString(),
      requestId,
      sessionId,
      toolName,
      policyClass,
      argumentsSha256: hashAuditArguments(args),
      revision,
      outcome,
      ...(errorCode ? { errorCode } : {}),
      ...(egress ?? {}),
      ...(metrics ?? {}),
    });
  } catch (error) {
    console.error(
      `[ai-devtools-daemon] audit persistence failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function hashAuditArguments(args: Record<string, unknown>): string {
  return createHash("sha256")
    .update(stableAuditStringify(args))
    .digest("hex");
}

function authorizationExpiry(now: Date): Date {
  return new Date(now.getTime() + PROTOCOL_LIMITS.maxRequestDeadlineMs);
}

function executionGrantExpiry(
  now: Date,
  authorizationExpiresAt: string,
  deadlineAt?: string,
): Date {
  const candidates = [
    now.getTime() + 30_000,
    Date.parse(authorizationExpiresAt),
    deadlineAt ? Date.parse(deadlineAt) : Number.POSITIVE_INFINITY,
  ].filter(Number.isFinite);
  return new Date(Math.min(...candidates));
}

function executionGrantTarget(
  target: ActiveTabSnapshot | undefined,
): ExecutionGrantClaims["target"] {
  if (!target) {
    return {};
  }
  return {
    targetId: target.targetId,
    tabId: target.tabId,
    windowId: target.windowId,
    frameId: target.frameId,
    documentId: target.documentId,
    navigationId: target.navigationId,
    revision: target.revision,
  };
}

function authorizationTargetMismatchFields(
  expected: ActiveTabSnapshot | undefined,
  current: ActiveTabSnapshot | undefined,
): string[] {
  if (!expected) {
    return [];
  }
  if (!current) {
    return ["currentTarget"];
  }
  const mismatches: string[] = [];
  if (expected.url !== current.url) {
    mismatches.push("url");
  }
  const fields = [
    "targetId",
    "tabId",
    "windowId",
    "frameId",
    "documentId",
    "navigationId",
  ] as const;
  for (const field of fields) {
    if (
      expected[field] !== undefined &&
      expected[field] !== current[field]
    ) {
      mismatches.push(field);
    }
  }
  return mismatches;
}

export function sameAuthorizedTopLevelTarget(
  expected: ActiveTabSnapshot | undefined,
  current: ActiveTabSnapshot | undefined,
): boolean {
  if (
    expected?.tabId === undefined ||
    current?.tabId === undefined ||
    expected.tabId !== current.tabId
  ) {
    return false;
  }
  const stableFields = ["targetId", "windowId"] as const;
  return stableFields.every(
    (field) =>
      expected[field] === undefined || expected[field] === current[field],
  );
}

export function canFollowAuthorizedPageEffectForRead(
  pageEffectDispatchAttempted: boolean,
  mutationScope: InternalMutationScope | undefined,
  expected: ActiveTabSnapshot | undefined,
  current: ActiveTabSnapshot | undefined,
): boolean {
  return (
    pageEffectDispatchAttempted &&
    mutationScope === "none" &&
    sameAuthorizedTopLevelTarget(expected, current)
  );
}

function requesterRole(
  role: WsClientRole | "unknown" | undefined,
): WsClientRole {
  return role && role !== "unknown" ? role : "mcp";
}

function defaultTaskEgressDestinations(
  role: WsClientRole,
  clientName: string,
): string[] {
  return role === "mcp"
    ? ["MCP 客户端：后续模型或数据出站目标由该客户端配置"]
    : [`Extension AI: ${clientName}`];
}

function standardTaskCapabilities(): ToolCapability[] {
  return [
    "page.observe.visual",
    "page.observe.network_digest",
    "page.observe.console_sanitized",
    "page.interact.low_risk",
    "page.interact.pointer",
    "page.style.temporary",
  ];
}

function cleanupExpiredTaskGrants(
  grants: Map<string, TaskCapabilityGrant>,
  now: number,
): void {
  for (const [grantId, grant] of grants) {
    if (grant.revokedAt || Date.parse(grant.expiresAt) <= now) {
      grants.delete(grantId);
    }
  }
}

function revokeTaskGrants(
  grants: Map<string, TaskCapabilityGrant>,
  sessionId: string,
  taskId: string,
  reason: string,
  now: number,
): number {
  let revoked = 0;
  for (const grant of grants.values()) {
    if (
      !grant.revokedAt &&
      grant.sessionId === sessionId &&
      grant.taskId === taskId
    ) {
      grant.revision += 1;
      grant.revokedAt = new Date(now).toISOString();
      grant.revokeReason = reason;
      revoked += 1;
    }
  }
  return revoked;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function buildApprovalPreview(
  toolName: string,
  args: Record<string, unknown>,
  policy: ReturnType<typeof getToolPolicy>,
): {
  summary: string;
  egress: string[];
  sideEffects: string[];
} {
  const egress: string[] = [];
  const sideEffects: string[] = [];
  if (policy.sensitive) {
    egress.push(
      "批准后，结果可能包含敏感浏览器数据并返回给发起请求的 Agent。",
    );
  }
  if (args.includeValues === true) {
    egress.push("本次请求明确要求读取 Cookie 或 Storage 的值。");
  }
  if (policy.mutatesBrowser) {
    sideEffects.push("该调用可能改变当前页面或浏览器状态。");
  }
  if (policy.destructive) {
    sideEffects.push("该操作可能导航、删除、关闭或持久化页面状态。");
  }
  return {
    summary: `${toolName} (${policy.policyClass})`,
    egress,
    sideEffects,
  };
}

function stableAuditStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableAuditStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${stableAuditStringify(entry)}`,
      );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

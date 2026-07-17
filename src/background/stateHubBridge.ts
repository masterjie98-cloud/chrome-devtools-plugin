import { executeToolCall } from "./toolDispatcher";
import {
  getSelectedContentFrameSnapshot,
  queryActiveTab,
} from "./chromeApi";
import { getTargetNavigationState } from "./targetNavigation";
import type { PageSnapshot, ScreenshotCaptureResult } from "../shared/dom";
import { createMessageId } from "../shared/messaging";
import { getInstallationId } from "../shared/extensionIdentity";
import {
  getBridgeToken,
  subscribeBridgeTokenChanges,
} from "../shared/bridgeCredentials";
import { TOOL_NAMES, type AnyToolCall } from "../shared/tools";
import { getReconnectDelayMs } from "../shared/reconnectBackoff";
import {
  isSignedExecutionGrant,
  verifyExecutionGrant,
  ExecutionGrantReplayCache,
  type SignedExecutionGrant,
} from "../shared/executionGrant";
import { assertMcpExecutorBoundary } from "../shared/mcpExecutionPolicy";
import {
  MCP_WS_URL,
  WS_COMMANDS,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_PROTOCOL_VERSION,
  normalizeBrowserToolResultData,
  sanitizeActiveTabForMcp,
  sanitizeElementForMcp,
  sanitizePageSnapshotForMcp,
  sanitizeScreenshotForMcp,
  type ActiveTabSnapshot,
  type BrowserToolResultPayload,
  type ElementSelectedPayload,
  type PluginToMcpMessage,
  type ScreenshotSnapshot,
  type ServerWelcomePayload,
} from "../shared/wsProtocol";
import { WS_CLIENT_IDENTITIES } from "../shared/wsClientIdentity";


class BackgroundStateHubBridge {
  private socket: WebSocket | null = null;
  private authenticatedSocket: WebSocket | null = null;
  private queue: PluginToMcpMessage[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly activeToolRequests = new Map<string, AbortController>();
  private readonly consumedExecutionGrants = new ExecutionGrantReplayCache();
  private latestActiveTab: ActiveTabSnapshot | undefined;

  constructor() {
    subscribeBridgeTokenChanges(() => {
      const previousSocket = this.socket;
      this.socket = null;
      this.authenticatedSocket = null;
      this.consumedExecutionGrants.clear();
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

    try {
      this.socket = new WebSocket(MCP_WS_URL);
      this.authenticatedSocket = null;
    } catch {
      this.scheduleReconnect();
      return;
    }

    const socket = this.socket;
    socket.addEventListener("open", () => {
      void this.handleOpen(socket);
    });

    socket.addEventListener("message", (event) => {
      void this.handleMessage(event.data, socket).catch((error) => {
        const requestId = browserToolRequestId(event.data);
        if (!requestId) {
          return;
        }
        this.sendBrowserToolResult(requestId, {
          ok: false,
          errorCode: "TOOL_FAILED",
          error: `Browser executor failed before returning a result: ${
            error instanceof Error ? error.message : "unknown executor error"
          }`,
        });
      });
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket) {
        return;
      }
      this.stopHeartbeat();
      this.authenticatedSocket = null;
      this.socket = null;
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (this.socket !== socket) {
        return;
      }
      this.stopHeartbeat();
      this.scheduleReconnect();
    });
  }

  private async handleOpen(socket: WebSocket): Promise<void> {
    try {
      const [installationId, bridgeToken] = await Promise.all([
        getInstallationId(),
        getBridgeToken(),
      ]);
      if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      const hello: PluginToMcpMessage = {
        requestId: createMessageId(),
        command: WS_COMMANDS.CLIENT_HELLO,
        sentAt: new Date().toISOString(),
        payload: {
          protocolVersion: WS_PROTOCOL_VERSION,
          clientRole: "browser",
          clientName: WS_CLIENT_IDENTITIES.CHROME_BACKGROUND.clientName,
          installationId,
          sessionId: installationId,
          bridgeToken,
        },
      };
      socket.send(JSON.stringify(hello));
    } catch {
      this.socket?.close();
      this.scheduleReconnect();
    }
  }

  sendActiveTab(activeTab: ActiveTabSnapshot): void {
    const sanitized = sanitizeActiveTabForMcp(activeTab);
    this.latestActiveTab = sanitized;
    this.send({
      requestId: createMessageId(),
      command: WS_COMMANDS.ACTIVE_TAB_UPDATED,
      sentAt: new Date().toISOString(),
      payload: {
        activeTab: sanitized,
      },
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

  sendPageContext(activeTab: ActiveTabSnapshot, pageContext: PageSnapshot): void {
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

  private async handleMessage(raw: unknown, socket: WebSocket): Promise<void> {
    const message = this.parseMessage(raw);
    if (!message) {
      return;
    }
    if (message.command === WS_COMMANDS.SERVER_WELCOME) {
      if (
        this.socket !== socket ||
        message.payload.protocolVersion !== WS_PROTOCOL_VERSION ||
        message.payload.assignedRole !== "browser" ||
        !message.payload.sessionId
      ) {
        socket.close(1002, "PROTOCOL_NEGOTIATION_FAILED");
        return;
      }
      this.reconnectAttempt = 0;
      this.authenticatedSocket = socket;
      this.startHeartbeat(message.payload.sessionId);
      this.flushQueue();
      const activeTarget = await readActiveTargetSnapshot();
      if (activeTarget) {
        this.sendActiveTab(activeTarget);
      }
      return;
    }
    if (message.command === WS_COMMANDS.REQUEST_CANCEL) {
      this.activeToolRequests
        .get(message.payload.targetRequestId)
        ?.abort(new Error(message.payload.reason ?? "REQUEST_CANCELLED"));
      return;
    }

    if (this.activeToolRequests.has(message.requestId)) {
      this.sendBrowserToolResult(message.requestId, {
        ok: false,
        errorCode: "IDEMPOTENCY_CONFLICT",
        error: `Browser request is already active: ${message.requestId}`,
      });
      return;
    }
    const grantVerification = await this.verifyAndConsumeExecutionGrant(
      message.requestId,
      message.payload.call,
      message.payload.executionGrant,
    );
    if (!grantVerification.ok) {
      this.sendBrowserToolResult(message.requestId, {
        ok: false,
        errorCode: "EXECUTION_GRANT_INVALID",
        error: `Executor rejected browser call: ${grantVerification.reason}.`,
      });
      return;
    }
    const controller = new AbortController();
    this.activeToolRequests.set(message.requestId, controller);

    try {
      const result = await raceWithAbort(
        executeToolCall(message.payload.call, {
          approvalRequired:
            message.payload.executionGrant.claims.approvalRequired,
        }),
        controller.signal,
      );
      await this.syncToolResult(message.payload.call, result.data);
      this.sendBrowserToolResult(message.requestId, {
        ok: true,
        toolName: result.toolName,
        data: normalizeBrowserToolResultData(result.data),
      });
    } catch (error) {
      const cancelled = controller.signal.aborted;
      this.sendBrowserToolResult(message.requestId, {
        ok: false,
        errorCode: cancelled ? "REQUEST_CANCELLED" : "TOOL_FAILED",
        error: error instanceof Error ? error.message : "Browser tool failed.",
      });
    } finally {
      this.activeToolRequests.delete(message.requestId);
    }
  }

  private async syncToolResult(call: AnyToolCall, data: unknown): Promise<void> {
    if (
      call.toolName === TOOL_NAMES.BROWSER_SET_TARGET_TAB ||
      call.toolName === TOOL_NAMES.BROWSER_SET_TARGET_FRAME
    ) {
      const activeTarget = await readActiveTargetSnapshot();
      if (activeTarget) {
        this.sendActiveTab(activeTarget);
      }
    }
    if (call.toolName === TOOL_NAMES.DOM_GET_PAGE_INFO && isPageSnapshot(data)) {
      this.sendPageContext(
        data.provenance?.target ?? { url: data.url, title: data.title },
        data,
      );
      return;
    }

    if (
      call.toolName === TOOL_NAMES.BROWSER_TAKE_SCREENSHOT &&
      isScreenshotCaptureResult(data)
    ) {
      this.sendScreenshot(data);
    }
  }

  private async verifyAndConsumeExecutionGrant(
    browserRequestId: string,
    call: AnyToolCall,
    grant: SignedExecutionGrant,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const [installationId, bridgeToken, activeTarget] = await Promise.all([
      getInstallationId(),
      getBridgeToken(),
      readActiveTargetSnapshot(),
    ]);
    if (!activeTarget) {
      return { ok: false, reason: "no executable browser target is available" };
    }
    // The daemon can restart with persisted target state while this background
    // worker keeps an unchanged local cache. Republish the browser-authoritative
    // target before every grant check; local equality cannot prove daemon sync.
    this.sendActiveTab(activeTarget);
    const verification = await verifyExecutionGrant(bridgeToken, grant, {
      browserRequestId,
      sessionId: installationId,
      toolName: call.toolName,
      args: call.args,
      target: activeTarget,
    });
    if (!verification.ok) {
      return verification;
    }
    const targetAfterVerification = await readActiveTargetSnapshot();
    if (!sameActiveTarget(activeTarget, targetAfterVerification)) {
      if (targetAfterVerification) {
        this.sendActiveTab(targetAfterVerification);
      }
      return {
        ok: false,
        reason: "browser target changed while the execution grant was being verified",
      };
    }
    try {
      assertMcpExecutorBoundary(
        grant.claims.sourceMcpToolName,
        call.toolName,
        grant.claims.mutatesBrowser,
      );
    } catch (error) {
      return {
        ok: false,
        reason:
          error instanceof Error
            ? error.message
            : "execution grant violates MCP executor policy",
      };
    }
    if (!this.consumedExecutionGrants.consume(
      grant.claims.grantId,
      grant.claims.expiresAt,
    )) {
      return { ok: false, reason: "execution grant was already consumed" };
    }
    return { ok: true };
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

  private send(message: PluginToMcpMessage): void {
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      this.authenticatedSocket === this.socket
    ) {
      this.socket.send(JSON.stringify(message));
      return;
    }

    this.queue.push(message);
    this.queue = this.queue.slice(-100);
    this.connect();
  }

  private flushQueue(): void {
    const queued = [...this.queue];
    this.queue = [];
    for (const message of queued) {
      this.send(message);
    }
  }

  private startHeartbeat(sessionId: string): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({
        requestId: createMessageId(),
        command: WS_COMMANDS.HEARTBEAT,
        sentAt: new Date().toISOString(),
        payload: {
          sessionId,
        },
      });
    }, WS_HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }
    const delayMs = getReconnectDelayMs(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private parseMessage(raw: unknown):
    | {
        requestId: string;
        command: typeof WS_COMMANDS.SERVER_WELCOME;
        payload: ServerWelcomePayload;
      }
    | {
        requestId: string;
        command: typeof WS_COMMANDS.BROWSER_TOOL_CALL;
        payload: { call: AnyToolCall; executionGrant: SignedExecutionGrant };
      }
    | {
        requestId: string;
        command: typeof WS_COMMANDS.REQUEST_CANCEL;
        payload: { targetRequestId: string; reason?: string };
      }
    | null {
    try {
      const text = typeof raw === "string" ? raw : String(raw);
      const parsed = JSON.parse(text) as {
        requestId?: unknown;
        command?: unknown;
        payload?: {
          protocolVersion?: unknown;
          assignedRole?: unknown;
          sessionId?: unknown;
          connectionId?: unknown;
          limits?: unknown;
          call?: AnyToolCall;
          executionGrant?: unknown;
          targetRequestId?: unknown;
          reason?: unknown;
        };
      };
      if (
        typeof parsed.requestId === "string" &&
        parsed.command === WS_COMMANDS.SERVER_WELCOME &&
        typeof parsed.payload?.protocolVersion === "number" &&
        typeof parsed.payload.assignedRole === "string" &&
        typeof parsed.payload.connectionId === "string" &&
        parsed.payload.limits &&
        typeof parsed.payload.limits === "object"
      ) {
        return {
          requestId: parsed.requestId,
          command: WS_COMMANDS.SERVER_WELCOME,
          payload: parsed.payload as ServerWelcomePayload,
        };
      }
      if (
        typeof parsed.requestId === "string" &&
        parsed.command === WS_COMMANDS.BROWSER_TOOL_CALL &&
        parsed.payload?.call &&
        isSignedExecutionGrant(parsed.payload.executionGrant)
      ) {
        return {
          requestId: parsed.requestId,
          command: WS_COMMANDS.BROWSER_TOOL_CALL,
          payload: {
            call: parsed.payload.call,
            executionGrant: parsed.payload.executionGrant,
          },
        };
      }
      if (
        typeof parsed.requestId === "string" &&
        parsed.command === WS_COMMANDS.REQUEST_CANCEL &&
        typeof parsed.payload?.targetRequestId === "string"
      ) {
        return {
          requestId: parsed.requestId,
          command: WS_COMMANDS.REQUEST_CANCEL,
          payload: {
            targetRequestId: parsed.payload.targetRequestId,
            reason:
              typeof parsed.payload.reason === "string"
                ? parsed.payload.reason
                : undefined,
          },
        };
      }
      return null;
    } catch {
      return null;
    }
  }
}

async function readActiveTargetSnapshot(): Promise<ActiveTabSnapshot | undefined> {
  const tab = await queryActiveTab();
  if (tab?.id === undefined || !tab.url) {
    return undefined;
  }
  const navigation = getTargetNavigationState(tab.id, false);
  const selectedFrame = getSelectedContentFrameSnapshot(tab.id);
  return {
    url: selectedFrame?.url || tab.url,
    title: selectedFrame?.title || tab.title || "",
    targetId: String(tab.id),
    tabId: tab.id,
    windowId: tab.windowId,
    frameId: selectedFrame?.frameId ?? 0,
    documentId: selectedFrame?.documentId,
    navigationId: navigation.navigationId,
    revision: navigation.revision,
  };
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
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

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("REQUEST_CANCELLED: browser tool cancelled.");
}

function isPageSnapshot(value: unknown): value is PageSnapshot {
  return (
    typeof value === "object" &&
    value !== null &&
    "url" in value &&
    typeof (value as PageSnapshot).url === "string" &&
    "title" in value &&
    typeof (value as PageSnapshot).title === "string" &&
    Array.isArray((value as PageSnapshot).domSummary)
  );
}

function isScreenshotCaptureResult(
  value: unknown,
): value is ScreenshotCaptureResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "dataUrl" in value &&
    typeof (value as ScreenshotCaptureResult).dataUrl === "string" &&
    "mimeType" in value &&
    typeof (value as ScreenshotCaptureResult).mimeType === "string"
  );
}

function browserToolRequestId(raw: unknown): string | undefined {
  try {
    const parsed = JSON.parse(typeof raw === "string" ? raw : String(raw)) as {
      requestId?: unknown;
      command?: unknown;
    };
    return parsed.command === WS_COMMANDS.BROWSER_TOOL_CALL &&
      typeof parsed.requestId === "string"
      ? parsed.requestId
      : undefined;
  } catch {
    return undefined;
  }
}

function sameActiveTarget(
  left: ActiveTabSnapshot | undefined,
  right: ActiveTabSnapshot | undefined,
): boolean {
  if (!left || !right || left.url !== right.url) {
    return false;
  }
  const fields = [
    "targetId",
    "tabId",
    "windowId",
    "frameId",
    "documentId",
    "navigationId",
  ] as const;
  return fields.every((field) => left[field] === right[field]);
}

export const stateHubBridge = new BackgroundStateHubBridge();

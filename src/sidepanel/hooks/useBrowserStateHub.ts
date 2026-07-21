import { useEffect, useState } from "react";
import type { AgentSessionSnapshot } from "../../shared/agentSession";
import type { CollaborationWorkspaceSnapshot } from "../../shared/collaborationWorkspace";
import type { DomElementInfo, PageSnapshot, ScreenshotCaptureResult } from "../../shared/dom";
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
  type ActiveTabSnapshot,
} from "../../shared/wsProtocol";
import { WS_CLIENT_IDENTITIES } from "../../shared/wsClientIdentity";

interface BrowserStateHubState {
  connected: boolean;
  sessionId?: string;
  activeTab?: ActiveTabSnapshot;
  selectedElement?: DomElementInfo;
  pageContext?: PageSnapshot;
  lastScreenshot?: ScreenshotCaptureResult;
  activeAgentSession?: AgentSessionSnapshot;
  collaborationWorkspace?: CollaborationWorkspaceSnapshot;
}

export function useBrowserStateHub(): BrowserStateHubState {
  const [state, setState] = useState<BrowserStateHubState>({
    connected: false,
  });

  useEffect(() => {
    if (typeof WebSocket === "undefined") {
      return undefined;
    }

    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let heartbeatTimer: number | undefined;
    let reconnectAttempt = 0;

    const connect = () => {
      if (closed) {
        return;
      }

      socket = new WebSocket(MCP_WS_URL);
      socket.addEventListener("open", () => {
        void Promise.all([getInstallationId(), getBridgeToken()]).then(
          ([installationId, bridgeToken]) => {
          if (closed || socket?.readyState !== WebSocket.OPEN) {
            return;
          }
        send({
          requestId: createMessageId(),
          command: WS_COMMANDS.CLIENT_HELLO,
          sentAt: new Date().toISOString(),
          payload: {
            protocolVersion: WS_PROTOCOL_VERSION,
            clientRole:
              WS_CLIENT_IDENTITIES.CHROME_SIDEPANEL_OBSERVER.assignedRole,
            clientName:
              WS_CLIENT_IDENTITIES.CHROME_SIDEPANEL_OBSERVER.clientName,
            installationId,
            sessionId: installationId,
            bridgeToken,
          },
        });
          },
        ).catch(() => socket?.close());
      });

      socket.addEventListener("message", (event) => {
        handleMessage(event.data);
      });

      socket.addEventListener("close", () => {
        setState((current) => ({ ...current, connected: false }));
        if (heartbeatTimer !== undefined) {
          window.clearInterval(heartbeatTimer);
        }
        if (!closed) {
          const delayMs = getReconnectDelayMs(reconnectAttempt);
          reconnectAttempt += 1;
          reconnectTimer = window.setTimeout(connect, delayMs);
        }
      });

      socket.addEventListener("error", () => {
        setState((current) => ({ ...current, connected: false }));
      });
    };

    const send = (message: unknown) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    };

    const handleMessage = (raw: unknown) => {
      let parsed: {
        command?: string;
        payload?: Record<string, unknown>;
      };
      try {
        parsed = JSON.parse(String(raw)) as typeof parsed;
      } catch {
        return;
      }

      switch (parsed.command) {
        case WS_COMMANDS.SERVER_WELCOME: {
          if (
            parsed.payload?.protocolVersion !== WS_PROTOCOL_VERSION ||
            parsed.payload.assignedRole !== "observer" ||
            typeof parsed.payload.sessionId !== "string"
          ) {
            socket?.close(1002, "PROTOCOL_NEGOTIATION_FAILED");
            break;
          }
          reconnectAttempt = 0;
          setState((current) => ({
            ...current,
            connected: true,
            sessionId: parsed.payload?.sessionId as string,
          }));
          if (heartbeatTimer !== undefined) {
            window.clearInterval(heartbeatTimer);
          }
          const sessionId = parsed.payload.sessionId;
          heartbeatTimer = window.setInterval(() => {
            send({
              requestId: createMessageId(),
              command: WS_COMMANDS.HEARTBEAT,
              sentAt: new Date().toISOString(),
              payload: { sessionId },
            });
          }, WS_HEARTBEAT_INTERVAL_MS);
          break;
        }
        case WS_COMMANDS.ACTIVE_TAB_UPDATED:
          setState((current) => ({
            ...current,
            activeTab: parsed.payload?.activeTab as ActiveTabSnapshot,
          }));
          break;
        case WS_COMMANDS.ELEMENT_SELECTED:
          setState((current) => ({
            ...current,
            activeTab: parsed.payload?.activeTab as ActiveTabSnapshot,
            selectedElement: parsed.payload?.selectedElement as DomElementInfo,
          }));
          break;
        case WS_COMMANDS.PAGE_CONTEXT_UPDATED:
          setState((current) => ({
            ...current,
            activeTab: parsed.payload?.activeTab as ActiveTabSnapshot,
            pageContext: parsed.payload?.pageContext as PageSnapshot,
          }));
          break;
        case WS_COMMANDS.SCREENSHOT_CAPTURED:
          setState((current) => ({
            ...current,
            lastScreenshot: parsed.payload
              ?.screenshot as ScreenshotCaptureResult,
          }));
          break;
        case WS_COMMANDS.AGENT_SESSION_SYNC:
          setState((current) => ({
            ...current,
            activeAgentSession: parsed.payload
              ?.session as AgentSessionSnapshot,
          }));
          break;
        case WS_COMMANDS.COLLABORATION_WORKSPACE_UPDATED:
          setState((current) => ({
            ...current,
            collaborationWorkspace: parsed.payload
              ?.workspace as CollaborationWorkspaceSnapshot,
          }));
          break;
        default:
          break;
      }
    };

    connect();
    const unsubscribeTokenChanges = subscribeBridgeTokenChanges(() => {
      socket?.close();
    });

    return () => {
      closed = true;
      if (heartbeatTimer !== undefined) {
        window.clearInterval(heartbeatTimer);
      }
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
      unsubscribeTokenChanges();
    };
  }, []);

  return state;
}
